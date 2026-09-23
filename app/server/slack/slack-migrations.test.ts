import { describe, expect, it } from 'vitest';
import { LATER_MIGRATIONS } from '../lib/migrations';

describe('Slack append-only migrations', () => {
  it('appends the state and settings tables after v47', () => {
    const state = LATER_MIGRATIONS.find((migration) => migration.version === 48);
    const settings = LATER_MIGRATIONS.find((migration) => migration.version === 49);
    expect(state?.name).toBe('slack state adapter');
    expect(settings?.name).toBe('slack operational settings');
    expect(LATER_MIGRATIONS.find((migration) => migration.version === 50)?.name).toBe('slack render delivery state');
    const ddl = state?.statements.join('\n') ?? '';
    for (const table of [
      'slack_installations',
      'slack_user_links',
      'slack_conversation_bindings',
      'slack_event_dedup',
      'slack_deliveries',
    ]) {
      expect(ddl).toContain(`CREATE TABLE IF NOT EXISTS player_insights.${table}`);
    }
  });

  it('adds reconstructible links and pre-run delivery state only in v50', () => {
    const v48 = LATER_MIGRATIONS.find((migration) => migration.version === 48)?.statements.join('\n') ?? '';
    const v50 = LATER_MIGRATIONS.find((migration) => migration.version === 50)?.statements.join('\n') ?? '';
    expect(v48).not.toContain('token_ref_provider');
    for (const column of [
      'token_ref_provider',
      'token_ref_fingerprint',
      'databricks_subject_fingerprint',
      'databricks_workspace',
      'databricks_audience',
      'delivery_kind',
      'delivery_state',
    ]) {
      expect(v50).toContain(column);
    }
    expect(v50).toMatch(/ALTER COLUMN run_id DROP NOT NULL/);
    expect(v50).not.toMatch(/\b(email|prompt|raw_token|slack_user_id)\b/i);
  });

  it('stores credential references, scope evidence, and no credential values or content', () => {
    const ddl = LATER_MIGRATIONS.filter((migration) => migration.version >= 48)
      .flatMap((migration) => migration.statements)
      .join('\n')
      .toLowerCase();
    expect(ddl).not.toMatch(/\b(prompt|answer|payload|authorization|oauth_code|code_verifier|raw_token)\b/);
    expect(ddl).toContain('workspace_hash');
    expect(ddl).toContain('safe_error_class');
    for (const column of [
      'bot_token_ref',
      'app_token_ref',
      'client_secret_ref',
      'signing_secret_ref',
      'granted_scopes',
      'granted_scopes_hash',
    ]) {
      expect(ddl).toContain(column);
    }
    expect(ddl).not.toMatch(/\b(bot_token|app_token|client_secret|signing_secret)\s+text\b/);
  });

  it('separates channel/thread bindings and bounds dedup retention', () => {
    const ddl = LATER_MIGRATIONS.find((migration) => migration.version === 48)?.statements.join('\n') ?? '';
    expect(ddl).toContain('UNIQUE (environment, workspace_hash, channel_hash, thread_hash)');
    expect(ddl).not.toContain('conversation_hash');
    expect(ddl).toContain("DEFAULT (now() + interval '24 hours')");
    expect(ddl).toContain("expires_at <= claimed_at + interval '7 days'");
    expect(ddl).toContain('slack_event_dedup_expires_idx');
  });
});
