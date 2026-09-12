import { describe, expect, it, vi } from 'vitest';

import { configurationForSettings } from './release-configuration';
import {
  MissingReleaseEnvironmentSnapshot,
  RELEASE_ENVIRONMENT_DECISION,
  recordReleaseEnvironment,
  recoveredReleaseEnvironment,
  releaseEnvironmentSnapshot,
  restoreReleaseEnvironment,
  type ReleaseEnvironmentKey,
} from './release-environment';
import type { DecisionStore } from './deployment-decisions';

function readingStore(value: string | null): DecisionStore {
  return {
    query: vi.fn().mockResolvedValue({
      rows: value === null ? [] : [{ value }],
    }),
  };
}

describe('release runtime configuration persistence', () => {
  it('records only allowlisted target values, including scope and MLflow identity', async () => {
    const calls: { params: unknown[] }[] = [];
    const store: DecisionStore = {
      query: vi.fn((_text: string, params: unknown[] = []) => {
        calls.push({ params });
        return Promise.resolve({ rows: [] });
      }),
    };
    const env = {
      PLAYER_INSIGHTS_TARGET: 'customer',
      LAKEBASE_ENDPOINT: 'projects/example/branches/production',
      PLAYER_INSIGHTS_CATALOG: 'example_catalog',
      PLAYER_INSIGHTS_SCHEMA: 'adapt_data',
      PLAYER_INSIGHTS_WATCHLIST_TABLE: 'example_catalog.adapt_data.sales',
      PLAYER_INSIGHTS_DATA_GENIE_ID: 'data-space',
      PLAYER_INSIGHTS_EXPERIMENT_ID: 'target-experiment-id',
      PLAYER_INSIGHTS_BUILD_SHA: 'new-build',
      PLAYER_INSIGHTS_ADMIN_EMAILS: 'admin@example.test',
    };

    expect(await recordReleaseEnvironment(store, env)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.params[0]).toBe(RELEASE_ENVIRONMENT_DECISION);
    const recorded = JSON.parse(String(calls[0]?.params[1])) as Record<string, string>;
    expect(recorded).toMatchObject({
      PLAYER_INSIGHTS_CATALOG: 'example_catalog',
      PLAYER_INSIGHTS_SCHEMA: 'adapt_data',
      PLAYER_INSIGHTS_WATCHLIST_TABLE: 'example_catalog.adapt_data.sales',
      PLAYER_INSIGHTS_DATA_GENIE_ID: 'data-space',
      PLAYER_INSIGHTS_EXPERIMENT_ID: 'target-experiment-id',
    });
    expect(recorded).not.toHaveProperty('PLAYER_INSIGHTS_TARGET');
    expect(recorded).not.toHaveProperty('PLAYER_INSIGHTS_BUILD_SHA');
    expect(recorded).not.toHaveProperty('PLAYER_INSIGHTS_ADMIN_EMAILS');
  });

  it('hydrates a target-neutral Git manifest before Connections derives scope', async () => {
    const persisted: Partial<Record<ReleaseEnvironmentKey, string>> = {
      PLAYER_INSIGHTS_CATALOG: 'example_catalog',
      PLAYER_INSIGHTS_SCHEMA: 'adapt_data',
      PLAYER_INSIGHTS_WATCHLIST_TABLE: 'example_catalog.adapt_data.sales',
      PLAYER_INSIGHTS_EXPERIMENT_ID: 'target-experiment-id',
      PLAYER_INSIGHTS_EXPERIMENT_PATH: '/Shared/adapt-customer',
      PLAYER_INSIGHTS_DATA_GENIE_ID: 'data-space',
      PLAYER_INSIGHTS_APP_CATALOG: 'example_catalog',
      PLAYER_INSIGHTS_LLM_ENDPOINT: 'databricks-claude-sonnet-4-6',
      PLAYER_INSIGHTS_USER_API_SCOPES: 'sql,dashboards.genie,catalog.tables:read',
      PLAYER_INSIGHTS_APP_SCHEMA: 'adapt_data',
      PLAYER_INSIGHTS_SHARED_CONVERSATION_RAIL: 'false',
      ADAPT_ADMIN_GROUP: 'customer-admins',
      ADAPT_USER_GROUP: 'customer-users',
      ADAPT_ADMIN_GROUP_LABEL: 'Customer administrators',
      ADAPT_USER_GROUP_LABEL: 'Customer users',
    };
    const env: Record<string, string | undefined> = {
      PLAYER_INSIGHTS_TARGET: '',
      LAKEBASE_ENDPOINT: 'projects/example/branches/production',
      PLAYER_INSIGHTS_CATALOG: '',
      PLAYER_INSIGHTS_SCHEMA: '',
      PLAYER_INSIGHTS_WATCHLIST_TABLE: '',
      PLAYER_INSIGHTS_EXPERIMENT_ID: '',
      PLAYER_INSIGHTS_EXPERIMENT_PATH: '/Shared/adapt-genie',
      PLAYER_INSIGHTS_DATA_GENIE_ID: '',
      PLAYER_INSIGHTS_USER_API_SCOPES: 'sql',
      PLAYER_INSIGHTS_BUILD_SHA: 'new-git-build',
    };

    expect(await restoreReleaseEnvironment(readingStore(JSON.stringify(persisted)), env)).toBe(15);
    const configuration = configurationForSettings(env, []);
    expect(configuration.find((entry) => entry.key === 'catalog')?.value).toBe('example_catalog');
    expect(configuration.find((entry) => entry.key === 'schema')?.value).toBe('adapt_data');
    expect(configuration.find((entry) => entry.key === 'data_genie_space_id')?.value).toBe('data-space');
    expect(env.PLAYER_INSIGHTS_WATCHLIST_TABLE).toBe('example_catalog.adapt_data.sales');
    expect(env.PLAYER_INSIGHTS_EXPERIMENT_ID).toBe('target-experiment-id');
    expect(env.PLAYER_INSIGHTS_EXPERIMENT_PATH).toBe('/Shared/adapt-customer');
    expect(env.PLAYER_INSIGHTS_BUILD_SHA).toBe('new-git-build');
    expect(env.PLAYER_INSIGHTS_TARGET).toBe('');
  });

  it('never records a Git placeholder or restores an invalid snapshot', async () => {
    const env: Record<string, string | undefined> = {
      PLAYER_INSIGHTS_TARGET: '',
      LAKEBASE_ENDPOINT: 'projects/example/branches/production',
      PLAYER_INSIGHTS_CATALOG: '',
    };
    const store = readingStore('{not-json');

    expect(await recordReleaseEnvironment(store, env)).toBe(false);
    expect(releaseEnvironmentSnapshot(env)).toEqual({});
    await expect(restoreReleaseEnvironment(store, env, () => Promise.resolve({}))).rejects.toBeInstanceOf(
      MissingReleaseEnvironmentSnapshot
    );
    expect(env.PLAYER_INSIGHTS_CATALOG).toBe('');
  });

  it('self-migrates an existing app from its durable model, ACL and Lakebase values', async () => {
    let recorded: Record<string, string> | null = null;
    const store: DecisionStore = {
      query: vi.fn((text: string, params: unknown[] = []) => {
        if (text.startsWith('SELECT value')) return Promise.resolve({ rows: [] });
        recorded = JSON.parse(String(params[1])) as Record<string, string>;
        return Promise.resolve({ rows: [] });
      }),
    };
    const env: Record<string, string | undefined> = {
      PLAYER_INSIGHTS_TARGET: '',
      LAKEBASE_ENDPOINT: 'projects/example/branches/production',
      PLAYER_INSIGHTS_USER_API_SCOPES: 'sql,dashboards.genie,catalog.tables:read',
      PLAYER_INSIGHTS_SHARED_CONVERSATION_RAIL: 'false',
    };
    const recovered: Partial<Record<ReleaseEnvironmentKey, string>> = {
      PLAYER_INSIGHTS_CATALOG: 'customer_catalog',
      PLAYER_INSIGHTS_SCHEMA: 'sales',
      PLAYER_INSIGHTS_WATCHLIST_TABLE: 'customer_catalog.sales.txn_steam_sales_with_analytics',
      PLAYER_INSIGHTS_DATA_GENIE_ID: 'genie-space-123',
      PLAYER_INSIGHTS_LLM_ENDPOINT: 'databricks-claude-sonnet-4-6',
      PLAYER_INSIGHTS_APP_SCHEMA: 'adapt_customer',
      ADAPT_ADMIN_GROUP: 'customer-admins',
      ADAPT_USER_GROUP: 'customer-users',
      ADAPT_ADMIN_GROUP_LABEL: 'customer-admins',
      ADAPT_USER_GROUP_LABEL: 'customer-users',
    };

    expect(await restoreReleaseEnvironment(store, env, () => Promise.resolve(recovered))).toBe(12);
    expect(env).toMatchObject({
      ...recovered,
      PLAYER_INSIGHTS_USER_API_SCOPES: 'sql,dashboards.genie,catalog.tables:read',
    });
    expect(recorded).toMatchObject(recovered);
    const saved: Partial<Record<ReleaseEnvironmentKey, string>> = recorded ?? {};
    expect(saved.PLAYER_INSIGHTS_SHARED_CONVERSATION_RAIL).toBe('false');
  });

  it('recovers the exact App ACL groups and Watchlist table without customer defaults', () => {
    const recovered = recoveredReleaseEnvironment({
      baked: [
        { key: 'catalog', value: 'customer_catalog' },
        { key: 'schema', value: 'sales' },
        { key: 'data_genie_space_id', value: 'genie-space-123' },
        { key: 'llm_endpoint', value: 'databricks-claude-sonnet-4-6' },
        {
          key: 'declared_manifest',
          value: ['customer_catalog.sales.other_table', 'customer_catalog.sales.txn_steam_sales_with_analytics'],
        },
      ],
      groups: [
        {
          kind: 'group',
          name: 'another-admin-group',
          directPermission: 'CAN_MANAGE',
          inherited: false,
        },
        {
          kind: 'group',
          name: 'another-user-group',
          directPermission: 'CAN_USE',
          inherited: false,
        },
        { kind: 'user', name: 'owner@example.test', directPermission: 'CAN_MANAGE', inherited: false },
      ],
      appSchema: 'adapt_customer',
      sharedRail: 'false',
      env: { PLAYER_INSIGHTS_USER_API_SCOPES: 'sql,dashboards.genie' },
      confirmedAuthoredGroups: {
        admin: 'S_TK2_Databricks_adapt_genie_admins',
        user: 'S_TK2_Databricks_adapt_genie_users',
      },
    });

    expect(recovered).toMatchObject({
      PLAYER_INSIGHTS_CATALOG: 'customer_catalog',
      PLAYER_INSIGHTS_SCHEMA: 'sales',
      PLAYER_INSIGHTS_WATCHLIST_TABLE: 'customer_catalog.sales.txn_steam_sales_with_analytics',
      PLAYER_INSIGHTS_DATA_GENIE_ID: 'genie-space-123',
      PLAYER_INSIGHTS_LLM_ENDPOINT: 'databricks-claude-sonnet-4-6',
      PLAYER_INSIGHTS_APP_SCHEMA: 'adapt_customer',
      ADAPT_ADMIN_GROUP: 'S_TK2_Databricks_adapt_genie_admins',
      ADAPT_USER_GROUP: 'S_TK2_Databricks_adapt_genie_users',
    });
  });

  it('does not persist authored group names unless the existing workspace confirms them', async () => {
    const env: Record<string, string | undefined> = {
      PLAYER_INSIGHTS_TARGET: '',
      LAKEBASE_ENDPOINT: 'projects/example/branches/production',
      PLAYER_INSIGHTS_USER_API_SCOPES: 'sql',
      PLAYER_INSIGHTS_SHARED_CONVERSATION_RAIL: 'false',
      ADAPT_ADMIN_GROUP: 'unverified-admins',
      ADAPT_USER_GROUP: 'unverified-users',
      ADAPT_ADMIN_GROUP_LABEL: 'unverified-admins',
      ADAPT_USER_GROUP_LABEL: 'unverified-users',
    };
    const recovered = {
      PLAYER_INSIGHTS_CATALOG: 'customer_catalog',
      PLAYER_INSIGHTS_SCHEMA: 'sales',
      PLAYER_INSIGHTS_WATCHLIST_TABLE: 'customer_catalog.sales.txn_steam_sales_with_analytics',
      PLAYER_INSIGHTS_DATA_GENIE_ID: 'genie-space-123',
      PLAYER_INSIGHTS_LLM_ENDPOINT: 'databricks-claude-sonnet-4-6',
      PLAYER_INSIGHTS_APP_SCHEMA: 'adapt_customer',
    };

    const failure: unknown = await restoreReleaseEnvironment(readingStore(null), env, () =>
      Promise.resolve(recovered)
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MissingReleaseEnvironmentSnapshot);
    if (!(failure instanceof MissingReleaseEnvironmentSnapshot)) throw new Error('Expected recovery refusal.');
    expect(failure.missing).toEqual([
      'ADAPT_ADMIN_GROUP',
      'ADAPT_USER_GROUP',
      'ADAPT_ADMIN_GROUP_LABEL',
      'ADAPT_USER_GROUP_LABEL',
    ]);
  });

  it('keeps direct App grants when the same group also has inherited access', () => {
    const recovered = recoveredReleaseEnvironment({
      baked: [],
      groups: [
        { kind: 'group', name: 'direct-admins', directPermission: 'CAN_MANAGE', inherited: true },
        { kind: 'group', name: 'direct-users', directPermission: 'CAN_USE', inherited: true },
      ],
      appSchema: 'adapt',
      sharedRail: null,
      env: {},
    });

    expect(recovered).toMatchObject({
      ADAPT_ADMIN_GROUP: 'direct-admins',
      ADAPT_USER_GROUP: 'direct-users',
    });
  });

  it('round-trips every ADAPT deployment value through a blank Deploy-from-Git manifest', async () => {
    let persisted: string | null = null;
    const store: DecisionStore = {
      query: vi.fn((text: string, params: unknown[] = []) => {
        if (text.startsWith('SELECT value')) {
          return Promise.resolve({ rows: persisted === null ? [] : [{ value: persisted }] });
        }
        persisted = String(params[1]);
        return Promise.resolve({ rows: [] });
      }),
    };
    const expected = {
      PLAYER_INSIGHTS_EXPERIMENT_ID: 'experiment-123',
      PLAYER_INSIGHTS_EXPERIMENT_PATH: '/Shared/customer-adapt',
      PLAYER_INSIGHTS_CATALOG: 'customer_catalog',
      PLAYER_INSIGHTS_SCHEMA: 'sales',
      PLAYER_INSIGHTS_APP_CATALOG: 'customer_catalog',
      PLAYER_INSIGHTS_WATCHLIST_TABLE: 'customer_catalog.sales.analytics',
      PLAYER_INSIGHTS_DATA_GENIE_ID: 'genie-space-123',
      PLAYER_INSIGHTS_LLM_ENDPOINT: 'databricks-claude-sonnet-4-6',
      PLAYER_INSIGHTS_TELEMETRY_SCHEMA: 'customer_catalog.adapt_telemetry',
      PLAYER_INSIGHTS_USER_API_SCOPES: 'sql,dashboards.genie,catalog.tables:read',
      PLAYER_INSIGHTS_APP_SCHEMA: 'adapt_customer',
      PLAYER_INSIGHTS_SHARED_CONVERSATION_RAIL: 'true',
      ADAPT_ADMIN_GROUP: 'S_TK2_Databricks_adapt_genie_admins',
      ADAPT_USER_GROUP: 'S_TK2_Databricks_adapt_genie_users',
      ADAPT_ADMIN_GROUP_LABEL: 'ADAPT administrators',
      ADAPT_USER_GROUP_LABEL: 'ADAPT users',
    };
    const releaseEnv: Record<string, string | undefined> = {
      PLAYER_INSIGHTS_TARGET: 'customer',
      LAKEBASE_ENDPOINT: 'projects/example/branches/production',
      ...expected,
    };

    expect(await recordReleaseEnvironment(store, releaseEnv)).toBe(true);
    const recorded = persisted;
    const gitEnv: Record<string, string | undefined> = {
      PLAYER_INSIGHTS_TARGET: '',
      LAKEBASE_ENDPOINT: releaseEnv.LAKEBASE_ENDPOINT,
      ...Object.fromEntries(Object.keys(expected).map((key) => [key, ''])),
    };

    expect(await recordReleaseEnvironment(store, gitEnv)).toBe(false);
    expect(persisted).toBe(recorded);
    expect(await restoreReleaseEnvironment(store, gitEnv)).toBe(Object.keys(expected).length);
    expect(gitEnv).toMatchObject(expected);
  });
});
