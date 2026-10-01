import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SlackLinkIntentMetadata, TokenReference } from '../../shared/channel/delegated-identity';
import { RuntimePkceVerifier } from '../lib/slack-link-intent';
import {
  RuntimeDatabricksSecret,
  type DatabricksSecretManager,
  type DatabricksSecretRecord,
} from './databricks-secret-manager';
import { DatabricksOAuthTokenBroker } from './databricks-oauth-token-broker';
import { RuntimeAuthorizationCode } from './oauth-service';

const WORKSPACE = 'https://dbc-test.cloud.databricks.com';
const CLIENT_ID = 'adapt-oauth-client';
const AUDIENCE = 'databricks';
const NONCE = 'nonce-value';
const CODE = 'authorization-code-secret';
const VERIFIER = 'pkce-verifier-secret';
const ACCESS_TOKEN = 'dapi-access-token-secret';
const REFRESH_TOKEN = 'refresh-token-secret';
const ROTATED_ACCESS_TOKEN = 'dapi-rotated-access-token-secret';
const ROTATED_REFRESH_TOKEN = 'rotated-refresh-token-secret';
const SUBJECT = 'databricks-subject-123';
const EMAIL = 'person@example.com';
const NOW = new Date('2026-10-01T10:00:00.000Z');
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'key-1', alg: 'RS256', use: 'sig' };
let priorClientSecret: string | undefined;
let priorClientSecretRef: string | undefined;
let priorReferencedSecret: string | undefined;

beforeEach(() => {
  priorClientSecret = process.env.SLACK_ADAPTER_OAUTH_CLIENT_SECRET;
  priorClientSecretRef = process.env.SLACK_ADAPTER_OAUTH_CLIENT_SECRET_REF;
  priorReferencedSecret = process.env.TEST_DATABRICKS_OAUTH_SECRET;
  delete process.env.SLACK_ADAPTER_OAUTH_CLIENT_SECRET;
  process.env.SLACK_ADAPTER_OAUTH_CLIENT_SECRET_REF = 'TEST_DATABRICKS_OAUTH_SECRET';
  process.env.TEST_DATABRICKS_OAUTH_SECRET = 'oauth-client-secret';
});

afterEach(() => {
  if (priorClientSecret === undefined) delete process.env.SLACK_ADAPTER_OAUTH_CLIENT_SECRET;
  else process.env.SLACK_ADAPTER_OAUTH_CLIENT_SECRET = priorClientSecret;
  if (priorClientSecretRef === undefined) delete process.env.SLACK_ADAPTER_OAUTH_CLIENT_SECRET_REF;
  else process.env.SLACK_ADAPTER_OAUTH_CLIENT_SECRET_REF = priorClientSecretRef;
  if (priorReferencedSecret === undefined) delete process.env.TEST_DATABRICKS_OAUTH_SECRET;
  else process.env.TEST_DATABRICKS_OAUTH_SECRET = priorReferencedSecret;
});

const verifierReference: TokenReference = {
  id: 'pkce-1',
  provider: 'oauth-link-secret-store',
  fingerprint: createHash('sha256').update(VERIFIER).digest('base64url'),
};

const intent: SlackLinkIntentMetadata = {
  id: 'intent-1',
  state: 'state-1',
  nonce: NONCE,
  slackTeamId: 'T123',
  slackUserId: 'U123',
  databricksWorkspace: WORKSPACE,
  databricksAudience: AUDIENCE,
  redirectUri: 'https://adapt.example.com/api/slack/oauth/callback',
  verifierReference,
  createdAt: NOW.toISOString(),
  expiresAt: '2026-10-01T10:10:00.000Z',
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function jwt(overrides: Record<string, unknown> = {}, signingKey = privateKey): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'key-1' })).toString('base64url');
  const claims = Buffer.from(
    JSON.stringify({
      iss: `${WORKSPACE}/oidc`,
      aud: CLIENT_ID,
      sub: SUBJECT,
      email: EMAIL,
      nonce: NONCE,
      iat: Math.floor(NOW.getTime() / 1000),
      exp: Math.floor(NOW.getTime() / 1000) + 600,
      ...overrides,
    })
  ).toString('base64url');
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), signingKey).toString('base64url');
  return `${header}.${claims}.${signature}`;
}

function secretManager() {
  const records = new Map<string, DatabricksSecretRecord>();
  const putSecret = vi.fn((key: string, secret: RuntimeDatabricksSecret, expiresAt: string | null): Promise<void> => {
    records.set(key, { secret, expiresAt });
    return Promise.resolve();
  });
  const readSecret = vi.fn(
    (key: string): Promise<DatabricksSecretRecord | null> => Promise.resolve(records.get(key) ?? null)
  );
  const takeSecret = vi.fn((key: string): Promise<DatabricksSecretRecord | null> => {
    const record = records.get(key) ?? null;
    records.delete(key);
    return Promise.resolve(record);
  });
  const deleteSecret = vi.fn((key: string): Promise<void> => {
    records.delete(key);
    return Promise.resolve();
  });
  const manager: DatabricksSecretManager = {
    putSecret,
    readSecret,
    takeSecret,
    deleteSecret,
  };
  return { manager, records, putSecret, deleteSecret };
}

function discovery() {
  return {
    issuer: `${WORKSPACE}/oidc`,
    token_endpoint: `${WORKSPACE}/oidc/v1/token`,
    jwks_uri: `${WORKSPACE}/oidc/v1/keys`,
    userinfo_endpoint: `${WORKSPACE}/oidc/v1/userinfo`,
  };
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
}

function standardFetch(
  options: {
    idToken?: string;
    tokenExpiresIn?: number;
    refreshSubject?: string;
    refreshEmail?: string;
  } = {}
) {
  return vi.fn<typeof fetch>((input, init) => {
    const url = requestUrl(input);
    if (url.endsWith('/.well-known/openid-configuration')) return Promise.resolve(json(discovery()));
    if (url.endsWith('/oidc/v1/keys')) return Promise.resolve(json({ keys: [publicJwk] }));
    if (url.endsWith('/oidc/v1/userinfo')) {
      expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${ROTATED_ACCESS_TOKEN}`);
      return Promise.resolve(json({ sub: options.refreshSubject ?? SUBJECT, email: options.refreshEmail ?? EMAIL }));
    }
    if (url.endsWith('/oidc/v1/token')) {
      const body = init?.body;
      if (!(body instanceof URLSearchParams)) throw new Error('expected form body');
      if (body.get('grant_type') === 'refresh_token') {
        expect(body.get('client_secret')).toBe('oauth-client-secret');
        return Promise.resolve(
          json({
            access_token: ROTATED_ACCESS_TOKEN,
            refresh_token: ROTATED_REFRESH_TOKEN,
            token_type: 'Bearer',
            expires_in: 3600,
          })
        );
      }
      expect(body.get('code')).toBe(CODE);
      expect(body.get('code_verifier')).toBe(VERIFIER);
      expect(body.get('client_id')).toBe(CLIENT_ID);
      expect(body.get('client_secret')).toBe('oauth-client-secret');
      expect(body.get('redirect_uri')).toBe(intent.redirectUri);
      return Promise.resolve(
        json({
          access_token: ACCESS_TOKEN,
          refresh_token: REFRESH_TOKEN,
          id_token: options.idToken ?? jwt(),
          token_type: 'Bearer',
          expires_in: options.tokenExpiresIn ?? 3600,
        })
      );
    }
    return Promise.reject(new Error(`unexpected test URL: ${url}`));
  });
}

function exchangeInput() {
  return {
    authorizationCode: new RuntimeAuthorizationCode(CODE),
    verifier: new RuntimePkceVerifier(VERIFIER, verifierReference),
    intent,
    clientId: CLIENT_ID,
    tokenBrokerRef: 'databricks-secret-manager',
    expectedAudience: AUDIENCE,
    expectedClientId: CLIENT_ID,
    expectedWorkspace: WORKSPACE,
    expectedNonce: NONCE,
  };
}

describe('DatabricksOAuthTokenBroker', () => {
  it('exchanges code+PKCE, verifies RS256 OIDC identity, and stores only through secret manager', async () => {
    const secrets = secretManager();
    const fetchImpl = standardFetch();
    const broker = new DatabricksOAuthTokenBroker({
      secretManager: secrets.manager,
      fetchImpl,
      now: () => NOW,
      randomId: () => 'credential-1',
    });

    const result = await broker.exchangeAndStore(exchangeInput());

    expect(result).toMatchObject({
      ok: true,
      metadata: {
        delegatedIdentityRef: 'obo-credential-1',
        tokenReference: {
          id: 'obo-credential-1',
          provider: 'databricks-secret-manager',
        },
        expiresAt: null,
      },
      proof: {
        issuerVerified: true,
        issuer: `${WORKSPACE}/oidc`,
        subjectVerified: true,
        audience: AUDIENCE,
        clientId: CLIENT_ID,
        workspace: WORKSPACE,
        nonce: NONCE,
      },
    });
    expect(secrets.putSecret).toHaveBeenCalledTimes(4);
    expect([...secrets.records.keys()].every((key) => key.startsWith('slack-obo/tokens/'))).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      new RegExp([CODE, VERIFIER, ACCESS_TOKEN, REFRESH_TOKEN, EMAIL].join('|'))
    );
    expect(inspect(result)).not.toMatch(new RegExp([CODE, VERIFIER, ACCESS_TOKEN, REFRESH_TOKEN, EMAIL].join('|')));
  });

  it.each([
    ['wrong audience', { aud: 'other-client' }],
    ['wrong nonce', { nonce: 'other-nonce' }],
    ['missing subject', { sub: '' }],
    ['missing email', { email: '' }],
    ['expired token', { exp: Math.floor(NOW.getTime() / 1000) - 1 }],
    ['wrong issuer host', { iss: 'https://evil.example/oidc' }],
  ])('fails closed for a signed ID token with %s', async (_label, claims) => {
    const secrets = secretManager();
    const broker = new DatabricksOAuthTokenBroker({
      secretManager: secrets.manager,
      fetchImpl: standardFetch({ idToken: jwt(claims) }),
      now: () => NOW,
    });

    await expect(broker.exchangeAndStore(exchangeInput())).resolves.toEqual({
      ok: false,
      reason: 'subject_unverified',
    });
    expect(secrets.putSecret).not.toHaveBeenCalled();
  });

  it('rejects an invalid RS256 signature and cross-host discovery endpoints', async () => {
    const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const secrets = secretManager();
    const invalidSignature = new DatabricksOAuthTokenBroker({
      secretManager: secrets.manager,
      fetchImpl: standardFetch({ idToken: jwt({}, otherKey) }),
      now: () => NOW,
    });
    await expect(invalidSignature.exchangeAndStore(exchangeInput())).resolves.toEqual({
      ok: false,
      reason: 'subject_unverified',
    });

    const crossHostFetch = vi.fn<typeof fetch>((input) => {
      if (requestUrl(input).endsWith('/.well-known/openid-configuration')) {
        return Promise.resolve(json({ ...discovery(), jwks_uri: 'https://evil.example/keys' }));
      }
      return Promise.reject(new Error('must not follow untrusted endpoint'));
    });
    const crossHost = new DatabricksOAuthTokenBroker({
      secretManager: secrets.manager,
      fetchImpl: crossHostFetch,
      now: () => NOW,
    });
    await expect(crossHost.exchangeAndStore(exchangeInput())).resolves.toEqual({
      ok: false,
      reason: 'subject_unverified',
    });
    expect(crossHostFetch).toHaveBeenCalledOnce();
  });

  it('resolves an unexpired opaque reference without exposing stored material', async () => {
    const secrets = secretManager();
    const broker = new DatabricksOAuthTokenBroker({
      secretManager: secrets.manager,
      fetchImpl: standardFetch(),
      now: () => NOW,
      randomId: () => 'credential-2',
    });
    const exchange = await broker.exchangeAndStore(exchangeInput());
    if (!exchange.ok) throw new Error('exchange fixture failed');
    const beforeResolveCalls = secrets.putSecret.mock.calls.length;

    const result = await broker.broker({
      tokenReference: exchange.metadata.tokenReference,
      workspace: WORKSPACE,
      audience: AUDIENCE,
    });

    expect(result).toMatchObject({
      ok: true,
      credential: {
        metadata: {
          tokenReference: exchange.metadata.tokenReference,
          workspace: WORKSPACE,
          audience: AUDIENCE,
          issuerBackedSubjectVerified: true,
        },
      },
    });
    if (!result.ok) return;
    expect(result.credential.accessToken()).toBe(ACCESS_TOKEN);
    expect(result.credential.verifiedSubjectEmail()).toBe(EMAIL);
    expect(JSON.stringify(result)).not.toMatch(new RegExp(`${ACCESS_TOKEN}|${EMAIL}`));
    expect(secrets.putSecret.mock.calls.length).toBe(beforeResolveCalls);
  });

  it('refreshes an expired credential, verifies userinfo identity, and rotates secrets', async () => {
    const secrets = secretManager();
    let clock = NOW;
    const fetchImpl = standardFetch({ tokenExpiresIn: 60 });
    const broker = new DatabricksOAuthTokenBroker({
      secretManager: secrets.manager,
      fetchImpl,
      now: () => clock,
      randomId: () => 'credential-3',
    });
    const exchange = await broker.exchangeAndStore(exchangeInput());
    if (!exchange.ok) throw new Error('exchange fixture failed');
    clock = new Date('2026-10-01T10:02:00.000Z');

    const result = await broker.broker({
      tokenReference: exchange.metadata.tokenReference,
      workspace: WORKSPACE,
      audience: AUDIENCE,
    });

    expect(result).toMatchObject({
      ok: true,
      credential: {
        metadata: {
          tokenStatus: { expiresAt: '2026-10-01T11:02:00.000Z' },
        },
      },
    });
    if (!result.ok) return;
    expect(result.credential.accessToken()).toBe(ROTATED_ACCESS_TOKEN);
    const storedValues = [...secrets.records.values()].map((record) => record.secret.value());
    expect(storedValues).toContain(ROTATED_ACCESS_TOKEN);
    expect(storedValues).toContain(ROTATED_REFRESH_TOKEN);
    expect(storedValues).not.toContain(ACCESS_TOKEN);
    expect(storedValues).not.toContain(REFRESH_TOKEN);
    expect(fetchImpl.mock.calls.some(([input]) => requestUrl(input).endsWith('/oidc/v1/userinfo'))).toBe(true);
  });

  it('fails refreshed identity closed when userinfo subject changes', async () => {
    const secrets = secretManager();
    let clock = NOW;
    const broker = new DatabricksOAuthTokenBroker({
      secretManager: secrets.manager,
      fetchImpl: standardFetch({ tokenExpiresIn: 60, refreshSubject: 'different-subject' }),
      now: () => clock,
      randomId: () => 'credential-4',
    });
    const exchange = await broker.exchangeAndStore(exchangeInput());
    if (!exchange.ok) throw new Error('exchange fixture failed');
    clock = new Date('2026-10-01T10:02:00.000Z');

    const result = await broker.broker({
      tokenReference: exchange.metadata.tokenReference,
      workspace: WORKSPACE,
      audience: AUDIENCE,
    });

    expect(result).toEqual({
      ok: false,
      reason: 'subject_unverified',
      message: 'The delegated credential identity could not be verified.',
    });
    expect(JSON.stringify(result)).not.toMatch(new RegExp(`${ROTATED_ACCESS_TOKEN}|${REFRESH_TOKEN}`));
  });

  it('rejects mismatched references, workspace, and audience before returning a credential', async () => {
    const secrets = secretManager();
    const broker = new DatabricksOAuthTokenBroker({
      secretManager: secrets.manager,
      fetchImpl: standardFetch(),
      now: () => NOW,
      randomId: () => 'credential-5',
    });
    const exchange = await broker.exchangeAndStore(exchangeInput());
    if (!exchange.ok) throw new Error('exchange fixture failed');

    await expect(
      broker.broker({
        tokenReference: { ...exchange.metadata.tokenReference, fingerprint: 'forged' },
        workspace: WORKSPACE,
        audience: AUDIENCE,
      })
    ).resolves.toMatchObject({ ok: false, reason: 'token_reference_mismatch' });
    await expect(
      broker.broker({
        tokenReference: exchange.metadata.tokenReference,
        workspace: 'https://other.cloud.databricks.com',
        audience: AUDIENCE,
      })
    ).resolves.toMatchObject({ ok: false, reason: 'target_workspace_mismatch' });
    await expect(
      broker.broker({
        tokenReference: exchange.metadata.tokenReference,
        workspace: WORKSPACE,
        audience: 'other-audience',
      })
    ).resolves.toMatchObject({ ok: false, reason: 'audience_mismatch' });
  });

  it('redacts secret-derived manager and network failures', async () => {
    const secrets = secretManager();
    secrets.putSecret.mockRejectedValueOnce(new Error(`failed storing ${ACCESS_TOKEN}`));
    const broker = new DatabricksOAuthTokenBroker({
      secretManager: secrets.manager,
      fetchImpl: standardFetch(),
      now: () => NOW,
    });

    const result = await broker.exchangeAndStore(exchangeInput());

    expect(result).toEqual({ ok: false, reason: 'broker_unavailable' });
    expect(JSON.stringify(result)).not.toContain(ACCESS_TOKEN);
    expect(secrets.deleteSecret).toHaveBeenCalledTimes(4);
  });
});
