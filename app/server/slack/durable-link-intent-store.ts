import { SlackLinkIntentMetadataSchema, type SlackLinkIntentMetadata } from '../../shared/channel/delegated-identity';
import type { DurableSlackLinkIntentStore } from './oauth-service';
import { SLACK_LINK_INTENTS_TABLE } from './schema';

export interface SlackLinkIntentDatabase {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

const QUALIFIED_POSTGRES_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)*$/;

function safeTableName(tableName: string): string {
  const value = tableName.trim();
  if (!QUALIFIED_POSTGRES_IDENTIFIER.test(value)) {
    throw new Error('Slack link-intent table name is invalid.');
  }
  return value;
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : '';
}

function intentFromRow(row: Record<string, unknown>): SlackLinkIntentMetadata {
  return SlackLinkIntentMetadataSchema.parse({
    id: text(row, 'intent_id'),
    state: text(row, 'state'),
    nonce: text(row, 'nonce'),
    slackTeamId: text(row, 'slack_team_id'),
    slackUserId: text(row, 'slack_user_id'),
    databricksWorkspace: text(row, 'databricks_workspace'),
    databricksAudience: text(row, 'databricks_audience'),
    redirectUri: text(row, 'redirect_uri'),
    verifierReference: {
      id: text(row, 'verifier_ref_id'),
      provider: text(row, 'verifier_ref_provider'),
      fingerprint: text(row, 'verifier_ref_fingerprint'),
    },
    createdAt: text(row, 'created_at'),
    expiresAt: text(row, 'expires_at'),
  });
}

const RETURNING_COLUMNS = `intent_id, state, nonce, slack_team_id, slack_user_id,
       databricks_workspace, databricks_audience, redirect_uri,
       verifier_ref_id, verifier_ref_provider, verifier_ref_fingerprint,
       created_at, expires_at`;

/**
 * Lakebase-backed one-time intent storage.
 *
 * Only non-secret OAuth metadata is written. Both take methods use one
 * DELETE ... RETURNING statement, so concurrent callback consumers cannot
 * receive the same intent.
 */
export class LakebaseDurableSlackLinkIntentStore implements DurableSlackLinkIntentStore {
  readonly #database: SlackLinkIntentDatabase;
  readonly #tableName: string;

  constructor(database: SlackLinkIntentDatabase, tableName = SLACK_LINK_INTENTS_TABLE) {
    this.#database = database;
    this.#tableName = safeTableName(tableName);
  }

  async put(intent: SlackLinkIntentMetadata): Promise<void> {
    const value = SlackLinkIntentMetadataSchema.parse(intent);
    const result = await this.#database.query(
      `INSERT INTO ${this.#tableName}
         (intent_id, state, nonce, slack_team_id, slack_user_id,
          databricks_workspace, databricks_audience, redirect_uri,
          verifier_ref_id, verifier_ref_provider, verifier_ref_fingerprint,
          created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT DO NOTHING
       RETURNING intent_id`,
      [
        value.id,
        value.state,
        value.nonce,
        value.slackTeamId,
        value.slackUserId,
        value.databricksWorkspace,
        value.databricksAudience,
        value.redirectUri,
        value.verifierReference.id,
        value.verifierReference.provider,
        value.verifierReference.fingerprint,
        value.createdAt,
        value.expiresAt,
      ]
    );
    if (result.rows.length !== 1) {
      throw new Error('Slack link intent could not be stored.');
    }
  }

  async readByState(state: string): Promise<SlackLinkIntentMetadata | null> {
    if (!state.trim()) return null;
    const result = await this.#database.query(
      `SELECT ${RETURNING_COLUMNS}
         FROM ${this.#tableName}
        WHERE state = $1
        LIMIT 1`,
      [state]
    );
    return result.rows[0] ? intentFromRow(result.rows[0]) : null;
  }

  async take(id: string): Promise<SlackLinkIntentMetadata | null> {
    if (!id.trim()) return null;
    const result = await this.#database.query(
      `DELETE FROM ${this.#tableName}
        WHERE intent_id = $1
        RETURNING ${RETURNING_COLUMNS}`,
      [id]
    );
    return result.rows[0] ? intentFromRow(result.rows[0]) : null;
  }

  async takeByState(state: string): Promise<SlackLinkIntentMetadata | null> {
    if (!state.trim()) return null;
    const result = await this.#database.query(
      `DELETE FROM ${this.#tableName}
        WHERE state = $1
        RETURNING ${RETURNING_COLUMNS}`,
      [state]
    );
    return result.rows[0] ? intentFromRow(result.rows[0]) : null;
  }
}
