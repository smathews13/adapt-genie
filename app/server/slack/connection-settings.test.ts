import { describe, expect, it, vi } from 'vitest';

import { SlackConnectionSchema, type SlackConnection } from '../../shared/slack-connection';
import type { DecisionStore } from '../lib/deployment-decisions';
import { RELEASE_ENVIRONMENT_KEYS } from '../lib/release-environment';
import { readSlackRuntimeConfig, resolveSlackSecrets } from './config';
import {
  SLACK_CONNECTION_ENV_KEYS,
  hydrateSlackSecrets,
  readStoredSlackSnapshot,
  slackConnectionEnv,
  slackConnectionFromEnv,
  writeSlackConnection,
} from './connection-settings';

const CONNECTION: SlackConnection = SlackConnectionSchema.parse({
  environment: 'test',
  allowedTeamId: 'T046S6QDTQ9',
  databricksWorkspaceHost: 'https://example-workspace.cloud.databricks.com/',
  publicBaseUrl: 'https://adapt-genie-1234.aws.databricksapps.com/',
  oauthClientId: 'client-id-1',
  secretScope: 'adapt-app',
});

function memoryStore(initial: string | null): { store: DecisionStore; writes: string[] } {
  let value = initial;
  const writes: string[] = [];
  const store: DecisionStore = {
    query: vi.fn((text: string, params: unknown[] = []) => {
      if (text.startsWith('SELECT')) return Promise.resolve({ rows: value === null ? [] : [{ value }] });
      value = String(params[1]);
      writes.push(value);
      return Promise.resolve({ rows: [] });
    }),
  };
  return { store, writes };
}

describe('Slack connection settings', () => {
  it('normalises addresses to origins and rejects Enterprise IDs', () => {
    expect(CONNECTION.databricksWorkspaceHost).toBe('https://example-workspace.cloud.databricks.com');
    expect(CONNECTION.publicBaseUrl).toBe('https://adapt-genie-1234.aws.databricksapps.com');
    expect(SlackConnectionSchema.safeParse({ ...CONNECTION, allowedTeamId: 'E046DCJ2MMZ' }).success).toBe(false);
    expect(SlackConnectionSchema.safeParse({ ...CONNECTION, publicBaseUrl: 'http://insecure.test' }).success).toBe(
      false
    );
  });

  it('produces an environment the adapter accepts, with Slack still gated by operational settings', () => {
    const env = slackConnectionEnv(CONNECTION);
    const result = readSlackRuntimeConfig({
      ...env,
      SLACK_ADAPTER_OAUTH_SCOPES: 'all-apis offline_access openid profile email',
    });
    expect(result.ready).toBe(true);
    if (!result.ready) return;
    expect(result.config.allowedTeamId).toBe('T046S6QDTQ9');
    expect(result.config.oauthCallbackUrl).toBe(
      'https://adapt-genie-1234.aws.databricksapps.com/api/slack/oauth/callback'
    );
    expect(result.config.registrationId).toBe('adapt-slack-test');
    expect(result.config.oauthExpectedAudience).toBe('https://example-workspace.cloud.databricks.com');
  });

  it('round-trips through the environment and every key is restorable on a Git deploy', () => {
    const env = slackConnectionEnv(CONNECTION);
    expect(slackConnectionFromEnv(env)).toEqual(CONNECTION);
    const restorable = new Set<string>(RELEASE_ENVIRONMENT_KEYS);
    for (const key of SLACK_CONNECTION_ENV_KEYS) expect(restorable.has(key)).toBe(true);
    for (const key of Object.keys(env)) expect(restorable.has(key)).toBe(true);
  });

  it('merges into the existing snapshot without dropping other recorded values', async () => {
    const { store, writes } = memoryStore(JSON.stringify({ PLAYER_INSIGHTS_CATALOG: 'kept_catalog' }));
    expect(await writeSlackConnection(store, CONNECTION, 'admin@example.test')).toBe(true);
    const saved = JSON.parse(writes[0] ?? '{}') as Record<string, string>;
    expect(saved.PLAYER_INSIGHTS_CATALOG).toBe('kept_catalog');
    expect(saved.SLACK_ADAPTER_ALLOWED_TEAM_ID).toBe('T046S6QDTQ9');
    expect(slackConnectionFromEnv(await readStoredSlackSnapshot(store))).toEqual(CONNECTION);
  });

  it('never stores secret values in the snapshot', async () => {
    const { store, writes } = memoryStore(null);
    await writeSlackConnection(store, CONNECTION, 'admin@example.test');
    expect(writes[0]).not.toMatch(/xapp-|xoxb-/);
  });
});

describe('Slack secret hydration', () => {
  const base = { ...slackConnectionEnv(CONNECTION) };

  it('reads each secret from the configured scope and makes the adapter secrets resolvable', async () => {
    const env: Record<string, string | undefined> = { ...base };
    const read = vi.fn((_scope: string, key: string) =>
      Promise.resolve(
        {
          'adapt-slack-app-token': 'xapp-example',
          'adapt-slack-bot-oauth-token': 'xoxb-example',
          'adapt-slack-oauth-client-secret': 'client-secret',
          'adapt-slack-broker-key': 'a2V5',
        }[key] ?? null
      )
    );
    const result = await hydrateSlackSecrets(env, read);
    expect(result.loaded).toHaveLength(4);
    expect(read).toHaveBeenCalledWith('adapt-app', 'adapt-slack-app-token');
    const config = readSlackRuntimeConfig({
      ...env,
      SLACK_ADAPTER_OAUTH_SCOPES: 'all-apis offline_access openid profile email',
    });
    expect(config.ready).toBe(true);
    if (config.ready) expect(resolveSlackSecrets(config.config, env).ready).toBe(true);
  });

  it('leaves a value that an app resource already supplied untouched', async () => {
    const env: Record<string, string | undefined> = { ...base, SLACK_ADAPTER_APP_TOKEN: 'xapp-from-resource' };
    const read = vi.fn().mockResolvedValue('xapp-from-scope');
    await hydrateSlackSecrets(env, read);
    expect(env.SLACK_ADAPTER_APP_TOKEN).toBe('xapp-from-resource');
    expect(read).not.toHaveBeenCalledWith('adapt-app', 'adapt-slack-app-token');
  });

  it('does nothing without a scope and survives an unreadable secret', async () => {
    const read = vi.fn();
    expect(await hydrateSlackSecrets({}, read)).toEqual({ loaded: [], missing: [] });
    expect(read).not.toHaveBeenCalled();
    const env: Record<string, string | undefined> = { ...base };
    const result = await hydrateSlackSecrets(env, () => Promise.reject(new Error('denied')));
    expect(result.missing).toHaveLength(4);
    expect(env.SLACK_ADAPTER_APP_TOKEN).toBeUndefined();
  });
});
