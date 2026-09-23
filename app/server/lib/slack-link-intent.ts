import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { inspect } from 'node:util';

import {
  SlackLinkIntentMetadataSchema,
  type SlackLinkIntentMetadata,
  type TokenReference,
} from '../../shared/channel/delegated-identity';

export const DEFAULT_LINK_INTENT_TTL_MS = 10 * 60 * 1000;

export type LinkIntentBlockedReason =
  | 'intent_not_found'
  | 'state_mismatch'
  | 'intent_expired'
  | 'redirect_mismatch'
  | 'workspace_mismatch'
  | 'audience_mismatch';

export interface CreateLinkIntentInput {
  slackTeamId: string;
  slackUserId: string;
  databricksWorkspace: string;
  databricksAudience: string;
  redirectUri: string;
  now?: Date;
  ttlMs?: number;
}

export interface ConsumeLinkIntentInput {
  intentId: string;
  state: string;
  redirectUri: string;
  databricksWorkspace: string;
  databricksAudience: string;
  now?: Date;
}

export interface LinkIntentStore {
  put(intent: SlackLinkIntentMetadata): Promise<void>;
  take(id: string): Promise<SlackLinkIntentMetadata | null>;
}

/** Test-only process-memory implementation. Production must inject durable storage. */
export class InMemoryLinkIntentStore implements LinkIntentStore {
  readonly #intents = new Map<string, SlackLinkIntentMetadata>();

  put(intent: SlackLinkIntentMetadata): Promise<void> {
    this.#intents.set(intent.id, SlackLinkIntentMetadataSchema.parse(intent));
    return Promise.resolve();
  }

  take(id: string): Promise<SlackLinkIntentMetadata | null> {
    const intent = this.#intents.get(id) ?? null;
    this.#intents.delete(id);
    return Promise.resolve(intent);
  }
}

/** The verifier is secret runtime material and never part of intent metadata. */
export class RuntimePkceVerifier {
  readonly reference: TokenReference;
  readonly #value: string;

  constructor(value: string, reference: TokenReference) {
    this.#value = value;
    this.reference = reference;
  }

  value(): string {
    return this.#value;
  }

  toJSON(): TokenReference {
    return this.reference;
  }

  [inspect.custom](): string {
    return `RuntimePkceVerifier ${inspect(this.reference)}`;
  }
}

export interface CreatedLinkIntent {
  metadata: SlackLinkIntentMetadata;
  verifier: RuntimePkceVerifier;
  codeChallenge: string;
}

export type ConsumeLinkIntentResult =
  | { ok: true; intent: SlackLinkIntentMetadata }
  | { ok: false; reason: LinkIntentBlockedReason; message: string };

function randomBase64Url(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

function canonicalWorkspace(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host}`;
}

export async function createSlackLinkIntent(
  input: CreateLinkIntentInput,
  store: LinkIntentStore
): Promise<CreatedLinkIntent> {
  const now = input.now ?? new Date();
  const verifierValue = randomBase64Url(64);
  const verifierReference: TokenReference = {
    id: `pkce-${randomUUID()}`,
    provider: 'oauth-link-secret-store',
    fingerprint: createHash('sha256').update(verifierValue).digest('base64url'),
  };
  const metadata = SlackLinkIntentMetadataSchema.parse({
    id: `link-${randomUUID()}`,
    state: randomBase64Url(),
    nonce: randomBase64Url(),
    slackTeamId: input.slackTeamId,
    slackUserId: input.slackUserId,
    databricksWorkspace: canonicalWorkspace(input.databricksWorkspace),
    databricksAudience: input.databricksAudience,
    redirectUri: input.redirectUri,
    verifierReference,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + (input.ttlMs ?? DEFAULT_LINK_INTENT_TTL_MS)).toISOString(),
  });
  await store.put(metadata);
  return {
    metadata,
    verifier: new RuntimePkceVerifier(verifierValue, verifierReference),
    codeChallenge: createHash('sha256').update(verifierValue).digest('base64url'),
  };
}

export async function consumeSlackLinkIntent(
  input: ConsumeLinkIntentInput,
  store: LinkIntentStore
): Promise<ConsumeLinkIntentResult> {
  const intent = await store.take(input.intentId);
  if (!intent) return { ok: false, reason: 'intent_not_found', message: 'The link intent is missing or already used.' };
  const now = input.now ?? new Date();
  if (intent.state !== input.state) {
    return { ok: false, reason: 'state_mismatch', message: 'The OAuth state did not match the one-time link intent.' };
  }
  if (Date.parse(intent.expiresAt) <= now.getTime()) {
    return { ok: false, reason: 'intent_expired', message: 'The one-time link intent has expired.' };
  }
  if (intent.redirectUri !== input.redirectUri) {
    return { ok: false, reason: 'redirect_mismatch', message: 'The OAuth redirect does not match the link intent.' };
  }
  if (canonicalWorkspace(intent.databricksWorkspace) !== canonicalWorkspace(input.databricksWorkspace)) {
    return {
      ok: false,
      reason: 'workspace_mismatch',
      message: 'The Databricks workspace does not match the link intent.',
    };
  }
  if (intent.databricksAudience !== input.databricksAudience) {
    return {
      ok: false,
      reason: 'audience_mismatch',
      message: 'The Databricks audience does not match the link intent.',
    };
  }
  return { ok: true, intent };
}

/**
 * Build the pre-exchange link-out URL. The URL carries one opaque state value;
 * Slack/team/user ids and credential references remain only in one-time intent
 * storage.
 */
export function slackLinkUrl(baseUrl: string, intent: Pick<SlackLinkIntentMetadata, 'state'>): string {
  const url = new URL('/api/slack/link', baseUrl);
  url.search = '';
  url.searchParams.set('state', intent.state);
  return url.toString();
}
