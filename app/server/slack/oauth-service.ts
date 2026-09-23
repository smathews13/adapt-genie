import { inspect } from 'node:util';
import type { SlackLinkIntentMetadata, TokenReference } from '../../shared/channel/delegated-identity';
import {
  createSlackLinkIntent,
  slackLinkUrl,
  type CreateLinkIntentInput,
  type LinkIntentStore,
  type RuntimePkceVerifier,
} from '../lib/slack-link-intent';
import { SLACK_DATABRICKS_OAUTH_SCOPES, type SlackRuntimeConfig } from './config';

export interface DurableSlackLinkIntentStore extends LinkIntentStore {
  readByState(state: string): Promise<SlackLinkIntentMetadata | null>;
  takeByState(state: string): Promise<SlackLinkIntentMetadata | null>;
}

export interface DurablePkceVerifierStore {
  put(verifier: RuntimePkceVerifier, expiresAt: string): Promise<void>;
  take(reference: TokenReference): Promise<RuntimePkceVerifier | null>;
}

/** OAuth codes are runtime-only and redact themselves from JSON and inspection. */
export class RuntimeAuthorizationCode {
  readonly #value: string;

  constructor(value: string) {
    if (!value.trim()) throw new Error('OAuth authorization code is empty.');
    this.#value = value;
  }

  value(): string {
    return this.#value;
  }

  toJSON(): { kind: 'oauth-authorization-code' } {
    return { kind: 'oauth-authorization-code' };
  }

  [inspect.custom](): string {
    return 'RuntimeAuthorizationCode <redacted>';
  }
}

export interface SlackOAuthExchangeMetadata {
  ownerHash: string;
  delegatedIdentityRef: string;
  tokenReference: TokenReference;
  databricksSubjectFingerprint: string;
  expiresAt: string | null;
}

export interface SlackOAuthExchangeProof {
  issuerVerified: boolean;
  issuer: string;
  subjectVerified: boolean;
  audience: string;
  clientId: string;
  workspace: string;
  nonce: string;
}

export type SlackOAuthExchangeResult =
  | { ok: true; metadata: SlackOAuthExchangeMetadata; proof?: SlackOAuthExchangeProof }
  | { ok: false; reason: 'broker_unavailable' | 'exchange_refused' | 'subject_unverified' };

export interface SlackOAuthTokenBroker {
  exchangeAndStore(input: {
    authorizationCode: RuntimeAuthorizationCode;
    verifier: RuntimePkceVerifier;
    intent: SlackLinkIntentMetadata;
    clientId: string;
    tokenBrokerRef: string;
    expectedAudience: string;
    expectedClientId: string;
    expectedWorkspace: string;
    expectedNonce: string;
  }): Promise<SlackOAuthExchangeResult>;
}

export interface SlackLinkWriter {
  write: (input: {
    actor: { kind: 'broker-proven'; ownerHash: string };
    linkReference: string;
    intent: SlackLinkIntentMetadata;
    exchange: SlackOAuthExchangeMetadata;
  }) => Promise<void>;
  status: (input: {
    actor: string;
    linkReference: string;
  }) => Promise<'linked' | 'unlinked' | 'revoked' | 'uninstalled'>;
  revoke: (input: { actor: string; linkReference: string }) => Promise<'revoked' | 'not_linked'>;
  uninstall: (input: {
    environment: SlackRuntimeConfig['environment'];
    registrationId: string;
    workspaceHash: string;
  }) => Promise<'uninstalled' | 'not_installed'>;
}

export interface SlackOAuthDependencies {
  intentStore?: DurableSlackLinkIntentStore;
  verifierStore?: DurablePkceVerifierStore;
  broker?: SlackOAuthTokenBroker;
  linkWriter?: SlackLinkWriter;
  linkReferenceForActor?: (actor: string) => Promise<string | null>;
}

export type SlackOAuthBlockedReason =
  | 'config_invalid'
  | 'store_unavailable'
  | 'broker_unavailable'
  | 'link_out_unavailable'
  | 'intent_not_found'
  | 'state_mismatch'
  | 'nonce_mismatch'
  | 'intent_expired'
  | 'redirect_mismatch'
  | 'workspace_mismatch'
  | 'audience_mismatch'
  | 'verifier_unavailable'
  | 'exchange_refused'
  | 'subject_unverified';

function canonical(value: string): string | null {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function intentMatchesConfig(
  intent: SlackLinkIntentMetadata,
  config: SlackRuntimeConfig
): SlackOAuthBlockedReason | null {
  if (intent.redirectUri !== config.oauthCallbackUrl) return 'redirect_mismatch';
  if (canonical(intent.databricksWorkspace) !== canonical(config.databricksWorkspaceHost)) return 'workspace_mismatch';
  if (intent.databricksAudience !== config.oauthExpectedAudience) return 'audience_mismatch';
  if (intent.slackTeamId !== config.allowedTeamId) return 'state_mismatch';
  return null;
}

export async function createSlackOAuthLinkOut(
  input: Omit<CreateLinkIntentInput, 'databricksWorkspace' | 'databricksAudience' | 'redirectUri'>,
  config: SlackRuntimeConfig,
  dependencies: SlackOAuthDependencies
): Promise<{ ok: true; url: string } | { ok: false; reason: SlackOAuthBlockedReason }> {
  if (!dependencies.intentStore || !dependencies.verifierStore) {
    return { ok: false, reason: 'store_unavailable' };
  }
  if (!dependencies.broker || !dependencies.linkWriter) {
    return { ok: false, reason: 'broker_unavailable' };
  }
  try {
    const created = await createSlackLinkIntent(
      {
        ...input,
        databricksWorkspace: config.databricksWorkspaceHost,
        databricksAudience: config.oauthExpectedAudience,
        redirectUri: config.oauthCallbackUrl,
      },
      dependencies.intentStore
    );
    await dependencies.verifierStore.put(created.verifier, created.metadata.expiresAt);
    return { ok: true, url: slackLinkUrl(config.publicBaseUrl, created.metadata) };
  } catch {
    return { ok: false, reason: 'link_out_unavailable' };
  }
}

export async function beginSlackOAuth(
  state: string,
  config: SlackRuntimeConfig,
  dependencies: SlackOAuthDependencies
): Promise<{ ok: true; redirect: string } | { ok: false; reason: SlackOAuthBlockedReason }> {
  if (!dependencies.intentStore || !dependencies.verifierStore) {
    return { ok: false, reason: 'store_unavailable' };
  }
  if (!dependencies.broker || !dependencies.linkWriter) return { ok: false, reason: 'broker_unavailable' };
  const intent = await dependencies.intentStore.readByState(state).catch(() => null);
  if (!intent) return { ok: false, reason: 'intent_not_found' };
  if (intent.state !== state) return { ok: false, reason: 'state_mismatch' };
  if (Date.parse(intent.expiresAt) <= Date.now()) return { ok: false, reason: 'intent_expired' };
  const mismatch = intentMatchesConfig(intent, config);
  if (mismatch) return { ok: false, reason: mismatch };
  const url = new URL('/oidc/v1/authorize', config.databricksWorkspaceHost);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.oauthClientId);
  url.searchParams.set('redirect_uri', config.oauthCallbackUrl);
  url.searchParams.set('scope', SLACK_DATABRICKS_OAUTH_SCOPES);
  url.searchParams.set('state', intent.state);
  url.searchParams.set('nonce', intent.nonce);
  url.searchParams.set('code_challenge', intent.verifierReference.fingerprint);
  url.searchParams.set('code_challenge_method', 'S256');
  return { ok: true, redirect: url.toString() };
}

export async function completeSlackOAuth(
  input: { state: string; code: string },
  config: SlackRuntimeConfig,
  dependencies: SlackOAuthDependencies
): Promise<{ ok: true } | { ok: false; reason: SlackOAuthBlockedReason }> {
  if (!dependencies.intentStore || !dependencies.verifierStore) {
    return { ok: false, reason: 'store_unavailable' };
  }
  if (!dependencies.broker || !dependencies.linkWriter) return { ok: false, reason: 'broker_unavailable' };
  const intent = await dependencies.intentStore.takeByState(input.state).catch(() => null);
  if (!intent) return { ok: false, reason: 'intent_not_found' };
  if (intent.state !== input.state) return { ok: false, reason: 'state_mismatch' };
  if (Date.parse(intent.expiresAt) <= Date.now()) return { ok: false, reason: 'intent_expired' };
  const mismatch = intentMatchesConfig(intent, config);
  if (mismatch) return { ok: false, reason: mismatch };
  const verifier = await dependencies.verifierStore.take(intent.verifierReference).catch(() => null);
  if (!verifier) return { ok: false, reason: 'verifier_unavailable' };
  const exchange = await dependencies.broker
    .exchangeAndStore({
      authorizationCode: new RuntimeAuthorizationCode(input.code),
      verifier,
      intent,
      clientId: config.oauthClientId,
      tokenBrokerRef: config.tokenBrokerRef,
      expectedAudience: config.oauthExpectedAudience,
      expectedClientId: config.oauthClientId,
      expectedWorkspace: config.databricksWorkspaceHost,
      expectedNonce: intent.nonce,
    })
    .catch(() => ({ ok: false as const, reason: 'broker_unavailable' as const }));
  if (!exchange.ok) return { ok: false, reason: exchange.reason };
  if (
    !exchange.proof ||
    !exchange.proof.issuerVerified ||
    !exchange.proof.issuer.trim() ||
    !exchange.proof.subjectVerified
  ) {
    return { ok: false, reason: 'subject_unverified' };
  }
  if (exchange.proof.audience !== config.oauthExpectedAudience || exchange.proof.clientId !== config.oauthClientId) {
    return { ok: false, reason: 'audience_mismatch' };
  }
  if (canonical(exchange.proof.workspace) !== canonical(config.databricksWorkspaceHost)) {
    return { ok: false, reason: 'workspace_mismatch' };
  }
  if (exchange.proof.nonce !== intent.nonce) return { ok: false, reason: 'nonce_mismatch' };
  try {
    await dependencies.linkWriter.write({
      actor: { kind: 'broker-proven', ownerHash: exchange.metadata.ownerHash },
      linkReference: intent.id,
      intent,
      exchange: exchange.metadata,
    });
  } catch {
    return { ok: false, reason: 'broker_unavailable' };
  }
  return { ok: true };
}
