import { createHash, createPublicKey, randomUUID, verify as verifySignature, type JsonWebKey } from 'node:crypto';

import {
  TokenReferenceSchema,
  type BlockedIdentityReason,
  type TokenReference,
} from '../../shared/channel/delegated-identity';
import {
  RuntimeBrokeredCredential,
  type BrokerCredentialRequest,
  type BrokeredCredentialResult,
  type DatabricksTokenBroker,
} from '../lib/databricks-token-broker';
import type { RuntimePkceVerifier } from '../lib/slack-link-intent';
import {
  RuntimeDatabricksSecret,
  secretKeyForReference,
  type DatabricksSecretManager,
} from './databricks-secret-manager';
import type { RuntimeAuthorizationCode, SlackOAuthExchangeResult, SlackOAuthTokenBroker } from './oauth-service';

type JsonObject = Record<string, unknown>;

interface OidcDiscovery {
  issuer: string;
  tokenEndpoint: string;
  jwksUri: string;
  userinfoEndpoint: string;
}

interface VerifiedIdentity {
  issuer: string;
  subject: string;
  email: string;
}

interface StoredCredentialManifest {
  version: 1;
  workspace: string;
  audience: string;
  clientId: string;
  issuer: string;
  subjectFingerprint: string;
  expiresAt: string | null;
}

interface OAuthTokenResponse {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  expiresAt: string | null;
}

class SafeBrokerFailure extends Error {
  readonly exchangeReason: 'broker_unavailable' | 'exchange_refused' | 'subject_unverified';
  readonly brokerReason: BlockedIdentityReason;

  constructor(
    exchangeReason: SafeBrokerFailure['exchangeReason'],
    brokerReason: BlockedIdentityReason = 'broker_unavailable'
  ) {
    super('Databricks delegated credential operation failed.');
    this.exchangeReason = exchangeReason;
    this.brokerReason = brokerReason;
  }
}

const SAFE_BROKER_MESSAGES: Partial<Record<BlockedIdentityReason, string>> = {
  broker_unavailable: 'Delegated Databricks credentials are unavailable.',
  token_missing: 'No delegated Databricks credential is available.',
  token_expired: 'The delegated Databricks credential has expired.',
  token_reference_mismatch: 'The delegated credential reference did not match.',
  target_workspace_mismatch: 'The delegated credential targets a different workspace.',
  audience_mismatch: 'The delegated credential has a different audience.',
  subject_unverified: 'The delegated credential identity could not be verified.',
};

function blocked(reason: BlockedIdentityReason): BrokeredCredentialResult {
  return {
    ok: false,
    reason,
    message: SAFE_BROKER_MESSAGES[reason] ?? 'The delegated Databricks credential could not be used.',
  };
}

function object(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : null;
}

function nonempty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function canonicalWorkspace(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new SafeBrokerFailure('exchange_refused', 'target_workspace_mismatch');
  }
  return url.origin;
}

function trustedEndpoint(value: string, workspace: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== workspace || url.username || url.password) {
    throw new SafeBrokerFailure('subject_unverified', 'subject_unverified');
  }
  return url.toString();
}

async function responseJson(response: Response): Promise<JsonObject> {
  if (!response.ok) throw new SafeBrokerFailure('exchange_refused', 'token_expired');
  const parsed = object(await response.json());
  if (!parsed) throw new SafeBrokerFailure('exchange_refused', 'broker_unavailable');
  return parsed;
}

function expirationFrom(payload: JsonObject, now: Date): string | null {
  if (payload.expires_in === undefined) return null;
  const seconds = Number(payload.expires_in);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 31_536_000) {
    throw new SafeBrokerFailure('exchange_refused', 'token_expired');
  }
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

function tokenResponse(payload: JsonObject, now: Date): OAuthTokenResponse {
  const accessToken = nonempty(payload.access_token);
  if (!accessToken) throw new SafeBrokerFailure('exchange_refused', 'token_missing');
  return {
    accessToken,
    refreshToken: nonempty(payload.refresh_token),
    idToken: nonempty(payload.id_token),
    expiresAt: expirationFrom(payload, now),
  };
}

function decodeJwtPart(part: string): JsonObject {
  if (!part || part.length > 64_000) throw new SafeBrokerFailure('subject_unverified', 'subject_unverified');
  try {
    const parsed = object(JSON.parse(Buffer.from(part, 'base64url').toString('utf8')));
    if (!parsed) throw new Error('not an object');
    return parsed;
  } catch {
    throw new SafeBrokerFailure('subject_unverified', 'subject_unverified');
  }
}

function audienceContains(value: unknown, clientId: string): boolean {
  return value === clientId || (Array.isArray(value) && value.some((entry) => entry === clientId));
}

function numericClaim(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function fingerprint(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('base64url');
}

function referenceFingerprint(reference: Pick<TokenReference, 'id' | 'provider'>): string {
  return fingerprint('databricks-oauth-reference-v1', reference.provider, reference.id);
}

async function discover(fetchImpl: typeof fetch, workspaceInput: string): Promise<OidcDiscovery> {
  const workspace = canonicalWorkspace(workspaceInput);
  let response: Response;
  try {
    response = await fetchImpl(`${workspace}/oidc/.well-known/openid-configuration`, {
      headers: { accept: 'application/json' },
    });
  } catch {
    throw new SafeBrokerFailure('broker_unavailable');
  }
  const payload = await responseJson(response);
  const issuerValue = nonempty(payload.issuer);
  const tokenEndpointValue = nonempty(payload.token_endpoint);
  const jwksUriValue = nonempty(payload.jwks_uri);
  const userinfoEndpointValue = nonempty(payload.userinfo_endpoint);
  if (!issuerValue || !tokenEndpointValue || !jwksUriValue || !userinfoEndpointValue) {
    throw new SafeBrokerFailure('subject_unverified', 'subject_unverified');
  }
  const issuer = trustedEndpoint(issuerValue, workspace);
  return {
    issuer,
    tokenEndpoint: trustedEndpoint(tokenEndpointValue, workspace),
    jwksUri: trustedEndpoint(jwksUriValue, workspace),
    userinfoEndpoint: trustedEndpoint(userinfoEndpointValue, workspace),
  };
}

async function verifyIdToken(
  fetchImpl: typeof fetch,
  idToken: string,
  discovery: OidcDiscovery,
  expectedClientId: string,
  expectedNonce: string,
  now: Date
): Promise<VerifiedIdentity> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new SafeBrokerFailure('subject_unverified', 'subject_unverified');
  const [encodedHeader = '', encodedClaims = '', encodedSignature = ''] = parts;
  const header = decodeJwtPart(encodedHeader);
  const claims = decodeJwtPart(encodedClaims);
  const keyId = nonempty(header.kid);
  if (header.alg !== 'RS256' || !keyId) {
    throw new SafeBrokerFailure('subject_unverified', 'subject_unverified');
  }

  let response: Response;
  try {
    response = await fetchImpl(discovery.jwksUri, { headers: { accept: 'application/json' } });
  } catch {
    throw new SafeBrokerFailure('broker_unavailable');
  }
  const jwks = await responseJson(response);
  const keys = Array.isArray(jwks.keys) ? jwks.keys : [];
  const jwk = keys
    .map(object)
    .find((candidate) => candidate?.kid === keyId && candidate.kty === 'RSA' && candidate.use !== 'enc');
  if (!jwk || (jwk.alg !== undefined && jwk.alg !== 'RS256')) {
    throw new SafeBrokerFailure('subject_unverified', 'subject_unverified');
  }

  let verified = false;
  try {
    const key = createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' });
    verified = verifySignature(
      'RSA-SHA256',
      Buffer.from(`${encodedHeader}.${encodedClaims}`),
      key,
      Buffer.from(encodedSignature, 'base64url')
    );
  } catch {
    throw new SafeBrokerFailure('subject_unverified', 'subject_unverified');
  }
  if (!verified) throw new SafeBrokerFailure('subject_unverified', 'subject_unverified');

  const issuer = nonempty(claims.iss);
  const subject = nonempty(claims.sub);
  const email = nonempty(claims.email)?.toLowerCase() ?? null;
  const expiresAt = numericClaim(claims.exp);
  const notBefore = numericClaim(claims.nbf);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (
    issuer !== discovery.issuer ||
    !audienceContains(claims.aud, expectedClientId) ||
    (claims.azp !== undefined && claims.azp !== expectedClientId) ||
    claims.nonce !== expectedNonce ||
    !subject ||
    !email ||
    !email.includes('@') ||
    expiresAt === null ||
    expiresAt <= nowSeconds ||
    (notBefore !== null && notBefore > nowSeconds + 60)
  ) {
    throw new SafeBrokerFailure('subject_unverified', 'subject_unverified');
  }
  return { issuer, subject, email };
}

async function verifyUserinfo(
  fetchImpl: typeof fetch,
  endpoint: string,
  accessToken: string,
  expected: { issuer: string; subjectFingerprint: string; email: string }
): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    throw new SafeBrokerFailure('broker_unavailable');
  }
  const payload = await responseJson(response);
  const subject = nonempty(payload.sub);
  const email = nonempty(payload.email)?.toLowerCase() ?? null;
  if (
    !subject ||
    !email ||
    !email.includes('@') ||
    fingerprint('databricks-oidc-subject-v1', expected.issuer, subject) !== expected.subjectFingerprint ||
    email !== expected.email.toLowerCase()
  ) {
    throw new SafeBrokerFailure('subject_unverified', 'subject_unverified');
  }
}

function manifestFrom(value: string): StoredCredentialManifest {
  try {
    const parsed = object(JSON.parse(value));
    const workspace = parsed ? nonempty(parsed.workspace) : null;
    const audience = parsed ? nonempty(parsed.audience) : null;
    const clientId = parsed ? nonempty(parsed.clientId) : null;
    const issuer = parsed ? nonempty(parsed.issuer) : null;
    const subjectFingerprint = parsed ? nonempty(parsed.subjectFingerprint) : null;
    const expiresAt = parsed?.expiresAt === null ? null : nonempty(parsed?.expiresAt);
    if (
      !parsed ||
      parsed.version !== 1 ||
      !workspace ||
      !audience ||
      !clientId ||
      !issuer ||
      !subjectFingerprint ||
      (parsed.expiresAt !== null && !expiresAt)
    ) {
      throw new Error('invalid manifest');
    }
    return {
      version: 1,
      workspace,
      audience,
      clientId,
      issuer,
      subjectFingerprint,
      expiresAt,
    };
  } catch {
    throw new SafeBrokerFailure('broker_unavailable');
  }
}

export interface DatabricksOAuthTokenBrokerOptions {
  secretManager: DatabricksSecretManager;
  fetchImpl?: typeof fetch;
  clientSecret?: () => RuntimeDatabricksSecret | null;
  now?: () => Date;
  randomId?: () => string;
  secretNamespace?: string;
}

/**
 * Production ADAPT Slack OBO broker.
 *
 * OAuth credentials and verified subject email are persisted only behind the
 * injected Databricks secret-manager boundary. Lakebase receives only the
 * opaque TokenReference returned in exchange metadata.
 */
export class DatabricksOAuthTokenBroker implements SlackOAuthTokenBroker, DatabricksTokenBroker {
  readonly #secretManager: DatabricksSecretManager;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  readonly #randomId: () => string;
  readonly #secretNamespace: string;
  readonly #clientSecret: () => RuntimeDatabricksSecret | null;

  constructor(options: DatabricksOAuthTokenBrokerOptions) {
    this.#secretManager = options.secretManager;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? (() => new Date());
    this.#randomId = options.randomId ?? randomUUID;
    this.#secretNamespace = options.secretNamespace ?? 'slack-obo/tokens';
    this.#clientSecret =
      options.clientSecret ??
      (() => {
        const reference = process.env.SLACK_ADAPTER_OAUTH_CLIENT_SECRET_REF?.trim();
        const value = (reference ? process.env[reference] : process.env.SLACK_ADAPTER_OAUTH_CLIENT_SECRET)?.trim();
        return value ? new RuntimeDatabricksSecret(value) : null;
      });
    // Validate once rather than after an OAuth exchange has succeeded.
    secretKeyForReference(
      this.#secretNamespace,
      { id: 'validation', provider: 'validation', fingerprint: 'validation' },
      'manifest'
    );
  }

  async exchangeAndStore(input: {
    authorizationCode: RuntimeAuthorizationCode;
    verifier: RuntimePkceVerifier;
    intent: {
      databricksWorkspace: string;
      databricksAudience: string;
      redirectUri: string;
      nonce: string;
    };
    clientId: string;
    tokenBrokerRef: string;
    expectedAudience: string;
    expectedClientId: string;
    expectedWorkspace: string;
    expectedNonce: string;
  }): Promise<SlackOAuthExchangeResult> {
    try {
      const workspace = canonicalWorkspace(input.expectedWorkspace);
      const provider = input.tokenBrokerRef.trim();
      if (
        canonicalWorkspace(input.intent.databricksWorkspace) !== workspace ||
        input.intent.databricksAudience !== input.expectedAudience ||
        input.clientId !== input.expectedClientId ||
        input.intent.nonce !== input.expectedNonce ||
        !input.expectedClientId.trim() ||
        !input.expectedAudience.trim() ||
        !provider
      ) {
        throw new SafeBrokerFailure('exchange_refused');
      }

      const configuration = await discover(this.#fetch, workspace);
      const clientSecret = this.#clientSecret();
      if (!clientSecret) throw new SafeBrokerFailure('broker_unavailable');
      let response: Response;
      try {
        response = await this.#fetch(configuration.tokenEndpoint, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: input.authorizationCode.value(),
            client_id: input.clientId,
            client_secret: clientSecret.value(),
            scope: 'all-apis offline_access openid profile email',
            redirect_uri: input.intent.redirectUri,
            code_verifier: input.verifier.value(),
          }),
        });
      } catch {
        throw new SafeBrokerFailure('broker_unavailable');
      }
      const tokens = tokenResponse(await responseJson(response), this.#now());
      if (!tokens.idToken || !tokens.refreshToken) {
        throw new SafeBrokerFailure('exchange_refused');
      }
      const identity = await verifyIdToken(
        this.#fetch,
        tokens.idToken,
        configuration,
        input.expectedClientId,
        input.expectedNonce,
        this.#now()
      );

      const referenceId = `obo-${this.#randomId()}`;
      const tokenReference = TokenReferenceSchema.parse({
        id: referenceId,
        provider,
        fingerprint: referenceFingerprint({ id: referenceId, provider }),
      });
      const subjectFingerprint = fingerprint('databricks-oidc-subject-v1', identity.issuer, identity.subject);
      const manifest: StoredCredentialManifest = {
        version: 1,
        workspace,
        audience: input.expectedAudience,
        clientId: input.expectedClientId,
        issuer: identity.issuer,
        subjectFingerprint,
        expiresAt: tokens.expiresAt,
      };
      await this.#storeCredential(tokenReference, manifest, identity.email, tokens.accessToken, tokens.refreshToken);

      return {
        ok: true,
        metadata: {
          ownerHash: createHash('sha256').update(identity.email.toLowerCase(), 'utf8').digest('hex'),
          delegatedIdentityRef: tokenReference.id,
          tokenReference,
          databricksSubjectFingerprint: subjectFingerprint,
          // Access-token expiry belongs to the broker manifest. The user link
          // remains active while its refresh credential remains valid.
          expiresAt: null,
        },
        proof: {
          issuerVerified: true,
          issuer: identity.issuer,
          subjectVerified: true,
          audience: input.expectedAudience,
          clientId: input.expectedClientId,
          workspace,
          nonce: input.expectedNonce,
        },
      };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof SafeBrokerFailure ? error.exchangeReason : 'broker_unavailable',
      };
    }
  }

  async broker(request: BrokerCredentialRequest): Promise<BrokeredCredentialResult> {
    try {
      const reference = TokenReferenceSchema.parse(request.tokenReference);
      if (reference.fingerprint !== referenceFingerprint(reference)) {
        return blocked('token_reference_mismatch');
      }
      const manifestRecord = await this.#secretManager.readSecret(this.#key(reference, 'manifest'));
      const emailRecord = await this.#secretManager.readSecret(this.#key(reference, 'subject-email'));
      if (!manifestRecord || !emailRecord) return blocked('token_missing');
      const manifest = manifestFrom(manifestRecord.secret.value());
      const email = emailRecord.secret.value().trim().toLowerCase();
      if (!email || !email.includes('@')) return blocked('subject_unverified');

      const workspace = canonicalWorkspace(request.workspace);
      if (workspace !== manifest.workspace) return blocked('target_workspace_mismatch');
      if (request.audience !== manifest.audience) return blocked('audience_mismatch');

      const now = this.#now();
      const expiresAtMs = manifest.expiresAt === null ? null : Date.parse(manifest.expiresAt);
      const accessRecord = await this.#secretManager.readSecret(this.#key(reference, 'access-token'));
      if (accessRecord && (expiresAtMs === null || expiresAtMs > now.getTime() + 30_000)) {
        return this.#credential(reference, manifest, email, accessRecord.secret.value(), now);
      }
      if (expiresAtMs === null) return blocked('token_missing');

      const refreshRecord = await this.#secretManager.readSecret(this.#key(reference, 'refresh-token'));
      if (!refreshRecord) return blocked('token_expired');
      return await this.#refresh(reference, manifest, email, refreshRecord.secret.value(), now);
    } catch (error) {
      return blocked(error instanceof SafeBrokerFailure ? error.brokerReason : 'broker_unavailable');
    }
  }

  async revoke(referenceInput: TokenReference): Promise<void> {
    const reference = TokenReferenceSchema.parse(referenceInput);
    if (reference.fingerprint !== referenceFingerprint(reference)) {
      throw new Error('Delegated credential reference did not match.');
    }
    await Promise.all([
      this.#secretManager.deleteSecret(this.#key(reference, 'manifest')),
      this.#secretManager.deleteSecret(this.#key(reference, 'subject-email')),
      this.#secretManager.deleteSecret(this.#key(reference, 'access-token')),
      this.#secretManager.deleteSecret(this.#key(reference, 'refresh-token')),
    ]);
  }

  async #storeCredential(
    reference: TokenReference,
    manifest: StoredCredentialManifest,
    email: string,
    accessToken: string,
    refreshToken: string
  ): Promise<void> {
    const keys = [
      this.#key(reference, 'manifest'),
      this.#key(reference, 'subject-email'),
      this.#key(reference, 'access-token'),
      this.#key(reference, 'refresh-token'),
    ];
    try {
      await this.#secretManager.putSecret(keys[0] ?? '', new RuntimeDatabricksSecret(JSON.stringify(manifest)), null);
      await this.#secretManager.putSecret(keys[1] ?? '', new RuntimeDatabricksSecret(email), null);
      await this.#secretManager.putSecret(keys[2] ?? '', new RuntimeDatabricksSecret(accessToken), manifest.expiresAt);
      await this.#secretManager.putSecret(keys[3] ?? '', new RuntimeDatabricksSecret(refreshToken), null);
    } catch {
      await Promise.allSettled(keys.map((key) => this.#secretManager.deleteSecret(key)));
      throw new SafeBrokerFailure('broker_unavailable');
    }
  }

  async #refresh(
    reference: TokenReference,
    manifest: StoredCredentialManifest,
    email: string,
    refreshToken: string,
    now: Date
  ): Promise<BrokeredCredentialResult> {
    const configuration = await discover(this.#fetch, manifest.workspace);
    if (configuration.issuer !== manifest.issuer)
      throw new SafeBrokerFailure('subject_unverified', 'subject_unverified');
    const clientSecret = this.#clientSecret();
    if (!clientSecret) throw new SafeBrokerFailure('broker_unavailable');

    let response: Response;
    try {
      response = await this.#fetch(configuration.tokenEndpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: manifest.clientId,
          client_secret: clientSecret.value(),
        }),
      });
    } catch {
      throw new SafeBrokerFailure('broker_unavailable');
    }
    const tokens = tokenResponse(await responseJson(response), now);
    if (tokens.expiresAt === null || !tokens.refreshToken) {
      throw new SafeBrokerFailure('exchange_refused', 'token_expired');
    }
    await verifyUserinfo(this.#fetch, configuration.userinfoEndpoint, tokens.accessToken, {
      issuer: manifest.issuer,
      subjectFingerprint: manifest.subjectFingerprint,
      email,
    });

    const updated = { ...manifest, expiresAt: tokens.expiresAt };
    await this.#secretManager.putSecret(
      this.#key(reference, 'access-token'),
      new RuntimeDatabricksSecret(tokens.accessToken),
      updated.expiresAt
    );
    await this.#secretManager.putSecret(
      this.#key(reference, 'refresh-token'),
      new RuntimeDatabricksSecret(tokens.refreshToken),
      null
    );
    await this.#secretManager.putSecret(
      this.#key(reference, 'manifest'),
      new RuntimeDatabricksSecret(JSON.stringify(updated)),
      null
    );
    return this.#credential(reference, updated, email, tokens.accessToken, now);
  }

  #credential(
    reference: TokenReference,
    manifest: StoredCredentialManifest,
    email: string,
    accessToken: string,
    checkedAt: Date
  ): BrokeredCredentialResult {
    return {
      ok: true,
      credential: new RuntimeBrokeredCredential(accessToken, email, {
        tokenReference: reference,
        tokenStatus: {
          state: 'active',
          expiresAt: manifest.expiresAt,
          revokedAt: null,
          checkedAt: checkedAt.toISOString(),
        },
        workspace: manifest.workspace,
        audience: manifest.audience,
        subjectFingerprint: manifest.subjectFingerprint,
        subjectKind: 'stable_id',
        issuerBackedSubjectVerified: true,
      }),
    };
  }

  #key(reference: TokenReference, part: string): string {
    return secretKeyForReference(this.#secretNamespace, reference, part);
  }
}
