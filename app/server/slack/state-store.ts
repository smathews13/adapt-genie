import crypto from 'node:crypto';
import type { SlackRuntimeEnvironment } from './config';
import {
  SLACK_CONVERSATION_BINDINGS_TABLE,
  SLACK_DELIVERIES_TABLE,
  SLACK_EVENT_DEDUP_TABLE,
  SLACK_INSTALLATIONS_TABLE,
  SLACK_USER_LINKS_TABLE,
} from './schema';

export interface SlackStore {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export type SlackWriteOutcome<T> =
  | { outcome: 'created' | 'updated'; value: T }
  | { outcome: 'conflict' | 'not_found' | 'environment_mismatch' | 'invalid_secret_reference' };

export interface SlackInstallation {
  installationId: string;
  environment: SlackRuntimeEnvironment;
  workspaceHash: string;
  registrationId: string;
  status: 'active' | 'revoked';
  botUserHash: string | null;
  botTokenRef: string;
  appTokenRef: string;
  clientSecretRef: string | null;
  signingSecretRef: string | null;
  grantedScopes: string[];
  grantedScopesHash: string;
  revision: number;
}

export async function readSlackInstallation(
  store: SlackStore,
  scope: { environment: SlackRuntimeEnvironment; workspaceHash: string }
): Promise<SlackInstallation | null> {
  const result = await store.query(
    `SELECT installation_id, environment, workspace_hash, registration_id, status, bot_user_hash,
            bot_token_ref, app_token_ref, client_secret_ref, signing_secret_ref,
            granted_scopes, granted_scopes_hash, revision
       FROM ${SLACK_INSTALLATIONS_TABLE}
      WHERE environment = $1 AND workspace_hash = $2 AND status = 'active'
      LIMIT 1`,
    [scope.environment, scope.workspaceHash]
  );
  return result.rows[0] ? installationFrom(result.rows[0]) : null;
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : '';
}

function nullableText(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : null;
}

function revision(row: Record<string, unknown>): number {
  return Number(row.revision);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function validSecretReference(value: string | null): boolean {
  return value === null || /^(?:[A-Z][A-Z0-9_]*|[a-z][a-z0-9+.-]*:\/\/[^\s]+)$/.test(value.trim());
}

function installationFrom(row: Record<string, unknown>): SlackInstallation {
  return {
    installationId: text(row, 'installation_id'),
    environment: text(row, 'environment') as SlackRuntimeEnvironment,
    workspaceHash: text(row, 'workspace_hash'),
    registrationId: text(row, 'registration_id'),
    status: text(row, 'status') as SlackInstallation['status'],
    botUserHash: nullableText(row, 'bot_user_hash'),
    botTokenRef: text(row, 'bot_token_ref'),
    appTokenRef: text(row, 'app_token_ref'),
    clientSecretRef: nullableText(row, 'client_secret_ref'),
    signingSecretRef: nullableText(row, 'signing_secret_ref'),
    grantedScopes: stringArray(row.granted_scopes),
    grantedScopesHash: text(row, 'granted_scopes_hash'),
    revision: revision(row),
  };
}

export async function createSlackInstallation(
  store: SlackStore,
  input: Omit<SlackInstallation, 'installationId' | 'status' | 'revision' | 'grantedScopesHash'> & {
    installationId?: string;
    expectedEnvironment: SlackRuntimeEnvironment;
    expectedRegistrationId: string;
  }
): Promise<SlackWriteOutcome<SlackInstallation>> {
  if (input.environment !== input.expectedEnvironment || input.registrationId !== input.expectedRegistrationId) {
    return { outcome: 'environment_mismatch' };
  }
  if (
    !validSecretReference(input.botTokenRef) ||
    !validSecretReference(input.appTokenRef) ||
    !validSecretReference(input.clientSecretRef) ||
    !validSecretReference(input.signingSecretRef)
  ) {
    return { outcome: 'invalid_secret_reference' };
  }
  const grantedScopes = [...new Set(input.grantedScopes.map((scope) => scope.trim()).filter(Boolean))].sort();
  const grantedScopesHash = crypto.createHash('sha256').update(grantedScopes.join('\n'), 'utf8').digest('hex');
  const result = await store.query(
    `INSERT INTO ${SLACK_INSTALLATIONS_TABLE}
       (installation_id, environment, workspace_hash, registration_id, status, bot_user_hash,
        bot_token_ref, app_token_ref, client_secret_ref, signing_secret_ref, granted_scopes, granted_scopes_hash)
     VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8, $9, $10::jsonb, $11)
     ON CONFLICT (environment, workspace_hash, registration_id) DO NOTHING
     RETURNING installation_id, environment, workspace_hash, registration_id, status, bot_user_hash,
               bot_token_ref, app_token_ref, client_secret_ref, signing_secret_ref,
               granted_scopes, granted_scopes_hash, revision`,
    [
      input.installationId ?? crypto.randomUUID(),
      input.environment,
      input.workspaceHash,
      input.registrationId,
      input.botUserHash,
      input.botTokenRef,
      input.appTokenRef,
      input.clientSecretRef,
      input.signingSecretRef,
      JSON.stringify(grantedScopes),
      grantedScopesHash,
    ]
  );
  const row = result.rows[0];
  return row ? { outcome: 'created', value: installationFrom(row) } : { outcome: 'conflict' };
}

export async function updateSlackInstallation(
  store: SlackStore,
  input: {
    installationId: string;
    environment: SlackRuntimeEnvironment;
    revision: number;
    status: 'active' | 'revoked';
    botUserHash: string | null;
  }
): Promise<SlackWriteOutcome<SlackInstallation>> {
  const result = await store.query(
    `UPDATE ${SLACK_INSTALLATIONS_TABLE}
        SET status = $4,
            bot_user_hash = $5,
            revision = revision + 1,
            updated_at = now(),
            revoked_at = CASE WHEN $4 = 'revoked' THEN now() ELSE NULL END
      WHERE installation_id = $1 AND environment = $2 AND revision = $3
      RETURNING installation_id, environment, workspace_hash, registration_id, status, bot_user_hash,
                bot_token_ref, app_token_ref, client_secret_ref, signing_secret_ref,
                granted_scopes, granted_scopes_hash, revision`,
    [input.installationId, input.environment, input.revision, input.status, input.botUserHash]
  );
  const row = result.rows[0];
  return row ? { outcome: 'updated', value: installationFrom(row) } : { outcome: 'conflict' };
}

export interface SlackUserLink {
  linkId: string;
  environment: SlackRuntimeEnvironment;
  workspaceHash: string;
  slackUserHash: string;
  ownerHash: string;
  delegatedIdentityRef: string;
  tokenRefProvider: string;
  tokenRefFingerprint: string;
  databricksSubjectFingerprint: string;
  databricksWorkspace: string;
  databricksAudience: string;
  status: 'active' | 'revoked';
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revision: number;
}

function timestamp(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return value instanceof Date ? value.toISOString() : text(row, key);
}

function linkFrom(row: Record<string, unknown>): SlackUserLink {
  return {
    linkId: text(row, 'link_id'),
    environment: text(row, 'environment') as SlackRuntimeEnvironment,
    workspaceHash: text(row, 'workspace_hash'),
    slackUserHash: text(row, 'slack_user_hash'),
    ownerHash: text(row, 'owner_hash'),
    delegatedIdentityRef: text(row, 'delegated_identity_ref'),
    tokenRefProvider: text(row, 'token_ref_provider'),
    tokenRefFingerprint: text(row, 'token_ref_fingerprint'),
    databricksSubjectFingerprint: text(row, 'databricks_subject_fingerprint'),
    databricksWorkspace: text(row, 'databricks_workspace'),
    databricksAudience: text(row, 'databricks_audience'),
    status: text(row, 'status') as SlackUserLink['status'],
    createdAt: timestamp(row, 'created_at'),
    updatedAt: timestamp(row, 'updated_at'),
    expiresAt: nullableText(row, 'expires_at'),
    revokedAt: nullableText(row, 'revoked_at'),
    revision: revision(row),
  };
}

export async function createSlackUserLink(
  store: SlackStore,
  input: Omit<SlackUserLink, 'linkId' | 'status' | 'revision' | 'createdAt' | 'updatedAt' | 'revokedAt'> & {
    linkId?: string;
  }
): Promise<SlackWriteOutcome<SlackUserLink>> {
  const result = await store.query(
    `INSERT INTO ${SLACK_USER_LINKS_TABLE}
       (link_id, environment, workspace_hash, slack_user_hash, owner_hash, delegated_identity_ref,
        token_ref_provider, token_ref_fingerprint, databricks_subject_fingerprint,
        databricks_workspace, databricks_audience, expires_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active')
     ON CONFLICT DO NOTHING
     RETURNING link_id, environment, workspace_hash, slack_user_hash, owner_hash,
               delegated_identity_ref, token_ref_provider, token_ref_fingerprint,
               databricks_subject_fingerprint, databricks_workspace, databricks_audience,
               status, created_at, updated_at, expires_at, revoked_at, revision`,
    [
      input.linkId ?? crypto.randomUUID(),
      input.environment,
      input.workspaceHash,
      input.slackUserHash,
      input.ownerHash,
      input.delegatedIdentityRef,
      input.tokenRefProvider,
      input.tokenRefFingerprint,
      input.databricksSubjectFingerprint,
      input.databricksWorkspace,
      input.databricksAudience,
      input.expiresAt,
    ]
  );
  const row = result.rows[0];
  return row ? { outcome: 'created', value: linkFrom(row) } : { outcome: 'conflict' };
}

export async function readSlackUserLink(
  store: SlackStore,
  scope: {
    environment: SlackRuntimeEnvironment;
    workspaceHash: string;
    slackUserHash: string;
    ownerHash?: string;
  }
): Promise<SlackUserLink | null> {
  const result = await store.query(
    `SELECT link_id, environment, workspace_hash, slack_user_hash, owner_hash,
            delegated_identity_ref, token_ref_provider, token_ref_fingerprint,
            databricks_subject_fingerprint, databricks_workspace, databricks_audience,
            status, created_at, updated_at, expires_at, revoked_at, revision
       FROM ${SLACK_USER_LINKS_TABLE}
      WHERE environment = $1 AND workspace_hash = $2 AND slack_user_hash = $3
        AND ($4::text IS NULL OR owner_hash = $4) AND status = 'active'`,
    [scope.environment, scope.workspaceHash, scope.slackUserHash, scope.ownerHash ?? null]
  );
  return result.rows[0] ? linkFrom(result.rows[0]) : null;
}

export async function revokeSlackUserLink(
  store: SlackStore,
  scope: {
    linkId: string;
    environment: SlackRuntimeEnvironment;
    ownerHash: string;
    revision: number;
  }
): Promise<SlackWriteOutcome<SlackUserLink>> {
  const result = await store.query(
    `UPDATE ${SLACK_USER_LINKS_TABLE}
        SET status = 'revoked', revoked_at = now(), updated_at = now(), revision = revision + 1
      WHERE link_id = $1 AND environment = $2 AND owner_hash = $3 AND revision = $4 AND status = 'active'
      RETURNING link_id, environment, workspace_hash, slack_user_hash, owner_hash,
                delegated_identity_ref, token_ref_provider, token_ref_fingerprint,
                databricks_subject_fingerprint, databricks_workspace, databricks_audience,
                status, created_at, updated_at, expires_at, revoked_at, revision`,
    [scope.linkId, scope.environment, scope.ownerHash, scope.revision]
  );
  const row = result.rows[0];
  return row ? { outcome: 'updated', value: linkFrom(row) } : { outcome: 'conflict' };
}

export interface SlackConversationBinding {
  bindingId: string;
  environment: SlackRuntimeEnvironment;
  workspaceHash: string;
  channelHash: string;
  threadHash: string;
  ownerHash: string;
  appConversationId: string;
  status: 'active' | 'revoked';
  revision: number;
}

function bindingFrom(row: Record<string, unknown>): SlackConversationBinding {
  return {
    bindingId: text(row, 'binding_id'),
    environment: text(row, 'environment') as SlackRuntimeEnvironment,
    workspaceHash: text(row, 'workspace_hash'),
    channelHash: text(row, 'channel_hash'),
    threadHash: text(row, 'thread_hash'),
    ownerHash: text(row, 'owner_hash'),
    appConversationId: text(row, 'app_conversation_id'),
    status: text(row, 'status') as SlackConversationBinding['status'],
    revision: revision(row),
  };
}

export async function createSlackConversationBinding(
  store: SlackStore,
  input: Omit<SlackConversationBinding, 'bindingId' | 'status' | 'revision'> & { bindingId?: string }
): Promise<SlackWriteOutcome<SlackConversationBinding>> {
  const result = await store.query(
    `INSERT INTO ${SLACK_CONVERSATION_BINDINGS_TABLE}
       (binding_id, environment, workspace_hash, channel_hash, thread_hash, owner_hash, app_conversation_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
     ON CONFLICT DO NOTHING
     RETURNING binding_id, environment, workspace_hash, channel_hash, thread_hash, owner_hash,
               app_conversation_id, status, revision`,
    [
      input.bindingId ?? crypto.randomUUID(),
      input.environment,
      input.workspaceHash,
      input.channelHash,
      input.threadHash,
      input.ownerHash,
      input.appConversationId,
    ]
  );
  const row = result.rows[0];
  return row ? { outcome: 'created', value: bindingFrom(row) } : { outcome: 'conflict' };
}

/**
 * Resolve or create a thread binding in one statement while preserving owner
 * isolation. A conflicting binding owned by somebody else returns conflict and
 * never leaks that binding's conversation id.
 */
export async function resolveOrCreateSlackConversationBinding(
  store: SlackStore,
  input: Omit<SlackConversationBinding, 'bindingId' | 'status' | 'revision'> & { bindingId?: string }
): Promise<SlackWriteOutcome<SlackConversationBinding>> {
  const result = await store.query(
    `INSERT INTO ${SLACK_CONVERSATION_BINDINGS_TABLE}
       (binding_id, environment, workspace_hash, channel_hash, thread_hash, owner_hash, app_conversation_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
     ON CONFLICT (environment, workspace_hash, channel_hash, thread_hash)
     DO UPDATE SET updated_at = ${SLACK_CONVERSATION_BINDINGS_TABLE}.updated_at
       WHERE ${SLACK_CONVERSATION_BINDINGS_TABLE}.owner_hash = EXCLUDED.owner_hash
         AND ${SLACK_CONVERSATION_BINDINGS_TABLE}.status = 'active'
     RETURNING binding_id, environment, workspace_hash, channel_hash, thread_hash, owner_hash,
               app_conversation_id, status, revision, (xmax = 0) AS created`,
    [
      input.bindingId ?? crypto.randomUUID(),
      input.environment,
      input.workspaceHash,
      input.channelHash,
      input.threadHash,
      input.ownerHash,
      input.appConversationId,
    ]
  );
  const row = result.rows[0];
  if (!row) return { outcome: 'conflict' };
  return {
    outcome: row.created === true || row.created === 'true' ? 'created' : 'updated',
    value: bindingFrom(row),
  };
}

export async function readSlackConversationBinding(
  store: SlackStore,
  scope: {
    environment: SlackRuntimeEnvironment;
    workspaceHash: string;
    channelHash: string;
    threadHash: string;
    ownerHash: string;
  }
): Promise<SlackConversationBinding | null> {
  const result = await store.query(
    `SELECT binding_id, environment, workspace_hash, channel_hash, thread_hash, owner_hash,
            app_conversation_id, status, revision
       FROM ${SLACK_CONVERSATION_BINDINGS_TABLE}
      WHERE environment = $1 AND workspace_hash = $2 AND channel_hash = $3
        AND thread_hash = $4 AND owner_hash = $5 AND status = 'active'`,
    [scope.environment, scope.workspaceHash, scope.channelHash, scope.threadHash, scope.ownerHash]
  );
  return result.rows[0] ? bindingFrom(result.rows[0]) : null;
}

export interface SlackDedupClaim {
  claimed: boolean;
  status: 'claimed' | 'admitted' | 'blocked' | 'completed' | 'failed';
  runId: string | null;
  deliveryId: string | null;
  expiresAt: string;
}

export const SLACK_EVENT_DEDUP_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
export const SLACK_EVENT_DEDUP_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function claimSlackEvent(
  store: SlackStore,
  input: {
    environment: SlackRuntimeEnvironment;
    workspaceHash: string;
    eventHash: string;
    eventKind: 'message.im';
    now?: Date;
    ttlMs?: number;
  }
): Promise<SlackDedupClaim> {
  const claimedAt = input.now ?? new Date();
  const ttlMs = Math.min(
    SLACK_EVENT_DEDUP_MAX_TTL_MS,
    Math.max(60_000, input.ttlMs ?? SLACK_EVENT_DEDUP_DEFAULT_TTL_MS)
  );
  const expiresAt = new Date(claimedAt.getTime() + ttlMs);
  const result = await store.query(
    `INSERT INTO ${SLACK_EVENT_DEDUP_TABLE}
       (environment, workspace_hash, event_hash, event_kind, status, claimed_at, updated_at, expires_at)
     VALUES ($1, $2, $3, $4, 'claimed', $5, $5, $6)
     ON CONFLICT (environment, workspace_hash, event_hash)
     DO UPDATE SET
       event_kind = CASE WHEN ${SLACK_EVENT_DEDUP_TABLE}.expires_at <= $5
                         THEN EXCLUDED.event_kind ELSE ${SLACK_EVENT_DEDUP_TABLE}.event_kind END,
       status = CASE WHEN ${SLACK_EVENT_DEDUP_TABLE}.expires_at <= $5
                     THEN 'claimed' ELSE ${SLACK_EVENT_DEDUP_TABLE}.status END,
       run_id = CASE WHEN ${SLACK_EVENT_DEDUP_TABLE}.expires_at <= $5
                     THEN NULL ELSE ${SLACK_EVENT_DEDUP_TABLE}.run_id END,
       delivery_id = CASE WHEN ${SLACK_EVENT_DEDUP_TABLE}.expires_at <= $5
                          THEN NULL ELSE ${SLACK_EVENT_DEDUP_TABLE}.delivery_id END,
       safe_error_class = CASE WHEN ${SLACK_EVENT_DEDUP_TABLE}.expires_at <= $5
                               THEN NULL ELSE ${SLACK_EVENT_DEDUP_TABLE}.safe_error_class END,
       claimed_at = CASE WHEN ${SLACK_EVENT_DEDUP_TABLE}.expires_at <= $5
                         THEN $5 ELSE ${SLACK_EVENT_DEDUP_TABLE}.claimed_at END,
       updated_at = CASE WHEN ${SLACK_EVENT_DEDUP_TABLE}.expires_at <= $5
                         THEN $5 ELSE ${SLACK_EVENT_DEDUP_TABLE}.updated_at END,
       expires_at = CASE WHEN ${SLACK_EVENT_DEDUP_TABLE}.expires_at <= $5
                         THEN $6 ELSE ${SLACK_EVENT_DEDUP_TABLE}.expires_at END
     RETURNING status, run_id, delivery_id, expires_at,
               ((xmax = 0) OR claimed_at = $5) AS claimed`,
    [input.environment, input.workspaceHash, input.eventHash, input.eventKind, claimedAt, expiresAt]
  );
  const row = result.rows[0];
  if (!row) throw new Error('Slack dedup claim returned no row.');
  return {
    claimed: row.claimed === true || row.claimed === 'true',
    status: text(row, 'status') as SlackDedupClaim['status'],
    runId: nullableText(row, 'run_id'),
    deliveryId: nullableText(row, 'delivery_id'),
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : text(row, 'expires_at'),
  };
}

export async function cleanupExpiredSlackEvents(
  store: SlackStore,
  input: { now?: Date; limit?: number } = {}
): Promise<number> {
  const now = input.now ?? new Date();
  const limit = Math.min(10_000, Math.max(1, Math.trunc(input.limit ?? 1_000)));
  const result = await store.query(
    `WITH expired AS (
       SELECT environment, workspace_hash, event_hash
         FROM ${SLACK_EVENT_DEDUP_TABLE}
        WHERE expires_at <= $1
        ORDER BY expires_at ASC
        LIMIT $2
     )
     DELETE FROM ${SLACK_EVENT_DEDUP_TABLE} AS target
      USING expired
      WHERE target.environment = expired.environment
        AND target.workspace_hash = expired.workspace_hash
        AND target.event_hash = expired.event_hash
     RETURNING target.event_hash`,
    [now, limit]
  );
  return result.rows.length;
}

export async function updateSlackEventClaim(
  store: SlackStore,
  input: {
    environment: SlackRuntimeEnvironment;
    workspaceHash: string;
    eventHash: string;
    status: SlackDedupClaim['status'];
    runId: string | null;
    deliveryId: string | null;
    safeErrorClass?: string | null;
  }
): Promise<boolean> {
  const result = await store.query(
    `UPDATE ${SLACK_EVENT_DEDUP_TABLE}
        SET status = $4, run_id = COALESCE(run_id, $5), delivery_id = COALESCE(delivery_id, $6),
            safe_error_class = $7, updated_at = now()
      WHERE environment = $1 AND workspace_hash = $2 AND event_hash = $3
      RETURNING event_hash`,
    [
      input.environment,
      input.workspaceHash,
      input.eventHash,
      input.status,
      input.runId,
      input.deliveryId,
      input.safeErrorClass ?? null,
    ]
  );
  return result.rows.length === 1;
}

export interface SlackDelivery {
  deliveryId: string;
  runId: string | null;
  channelHash: string;
  threadHash: string;
  status: 'pending' | 'sent' | 'failed' | 'revoked';
  deliveryKind: 'run' | 'blocked' | 'link_out';
  deliveryState: 'pending' | 'progress_sent' | 'final_sent' | 'transient_failed' | 'permanent_failed';
  safeErrorClass: string | null;
  messageId: string | null;
  attemptCount: number;
  revision: number;
}

function deliveryFrom(row: Record<string, unknown>): SlackDelivery {
  return {
    deliveryId: text(row, 'delivery_id'),
    runId: nullableText(row, 'run_id'),
    channelHash: text(row, 'channel_hash'),
    threadHash: text(row, 'thread_hash'),
    status: text(row, 'status') as SlackDelivery['status'],
    deliveryKind: text(row, 'delivery_kind') as SlackDelivery['deliveryKind'],
    deliveryState: text(row, 'delivery_state') as SlackDelivery['deliveryState'],
    safeErrorClass: nullableText(row, 'safe_error_class'),
    messageId: nullableText(row, 'message_id'),
    attemptCount: Number(row.attempt_count),
    revision: revision(row),
  };
}

export async function readSlackDeliveryForEvent(
  store: SlackStore,
  scope: { environment: SlackRuntimeEnvironment; workspaceHash: string; eventHash: string }
): Promise<SlackDelivery | null> {
  const result = await store.query(
    `SELECT delivery_id, run_id, channel_hash, thread_hash, status, delivery_kind, delivery_state,
            safe_error_class, message_id, attempt_count, revision
       FROM ${SLACK_DELIVERIES_TABLE}
      WHERE environment = $1 AND workspace_hash = $2 AND event_hash = $3`,
    [scope.environment, scope.workspaceHash, scope.eventHash]
  );
  return result.rows[0] ? deliveryFrom(result.rows[0]) : null;
}

export async function createSlackDelivery(
  store: SlackStore,
  input: {
    deliveryId?: string;
    environment: SlackRuntimeEnvironment;
    workspaceHash: string;
    eventHash: string;
    channelHash: string;
    threadHash: string;
    userHash: string;
    runId: string | null;
    deliveryKind?: SlackDelivery['deliveryKind'];
  }
): Promise<{ outcome: 'created' | 'existing'; value: SlackDelivery }> {
  const result = await store.query(
    `INSERT INTO ${SLACK_DELIVERIES_TABLE}
       (delivery_id, environment, workspace_hash, event_hash, channel_hash, thread_hash, user_hash,
        run_id, status, delivery_kind, delivery_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, 'pending')
     ON CONFLICT (environment, workspace_hash, event_hash)
     DO UPDATE SET event_hash = EXCLUDED.event_hash
     RETURNING delivery_id, run_id, channel_hash, thread_hash, status, delivery_kind, delivery_state,
               safe_error_class, message_id, attempt_count, revision, (xmax = 0) AS created`,
    [
      input.deliveryId ?? crypto.randomUUID(),
      input.environment,
      input.workspaceHash,
      input.eventHash,
      input.channelHash,
      input.threadHash,
      input.userHash,
      input.runId,
      input.deliveryKind ?? 'run',
    ]
  );
  const row = result.rows[0];
  if (!row) throw new Error('Slack delivery insert returned no row.');
  return {
    outcome: row.created === true || row.created === 'true' ? 'created' : 'existing',
    value: deliveryFrom(row),
  };
}

export async function recordSlackDeliveryAttempt(
  store: SlackStore,
  input: {
    deliveryId: string;
    runId: string | null;
    revision: number;
    status: 'sent' | 'failed' | 'revoked';
    deliveryState?: SlackDelivery['deliveryState'];
    deliveryKind?: SlackDelivery['deliveryKind'];
    messageId?: string | null;
    safeErrorClass?: string | null;
  }
): Promise<SlackWriteOutcome<SlackDelivery>> {
  const deliveryState = input.deliveryState ?? (input.status === 'sent' ? 'final_sent' : 'permanent_failed');
  const coherent =
    (input.status === 'sent' && deliveryState === 'final_sent') ||
    (input.status === 'failed' && (deliveryState === 'transient_failed' || deliveryState === 'permanent_failed')) ||
    (input.status === 'revoked' && deliveryState === 'permanent_failed');
  if (!coherent) throw new Error('Slack delivery status and delivery_state are inconsistent.');
  const result = await store.query(
    `UPDATE ${SLACK_DELIVERIES_TABLE}
        SET status = $4,
            message_id = COALESCE(message_id, $5),
            safe_error_class = $6,
            delivery_state = $7,
            delivery_kind = COALESCE($8, delivery_kind),
            attempt_count = attempt_count + 1,
            revision = revision + 1,
            updated_at = now(),
            sent_at = CASE WHEN $4 = 'sent' THEN now() ELSE sent_at END
      WHERE delivery_id = $1 AND run_id IS NOT DISTINCT FROM $2 AND revision = $3
      RETURNING delivery_id, run_id, channel_hash, thread_hash, status, delivery_kind, delivery_state,
                safe_error_class, message_id, attempt_count, revision`,
    [
      input.deliveryId,
      input.runId,
      input.revision,
      input.status,
      input.messageId ?? null,
      input.safeErrorClass ?? null,
      deliveryState,
      input.deliveryKind ?? null,
    ]
  );
  const row = result.rows[0];
  return row ? { outcome: 'updated', value: deliveryFrom(row) } : { outcome: 'conflict' };
}

export async function recordSlackDeliveryProgress(
  store: SlackStore,
  input: { deliveryId: string; runId: string; revision: number }
): Promise<SlackWriteOutcome<SlackDelivery>> {
  const result = await store.query(
    `UPDATE ${SLACK_DELIVERIES_TABLE}
        SET delivery_state = 'progress_sent', updated_at = now(), revision = revision + 1
      WHERE delivery_id = $1 AND run_id = $2 AND revision = $3 AND delivery_state = 'pending'
      RETURNING delivery_id, run_id, channel_hash, thread_hash, status, delivery_kind, delivery_state,
                safe_error_class, message_id, attempt_count, revision`,
    [input.deliveryId, input.runId, input.revision]
  );
  const row = result.rows[0];
  return row ? { outcome: 'updated', value: deliveryFrom(row) } : { outcome: 'conflict' };
}
