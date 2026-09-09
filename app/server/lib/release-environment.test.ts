import { describe, expect, it, vi } from 'vitest';

import { configurationForSettings } from './release-configuration';
import {
  RELEASE_ENVIRONMENT_DECISION,
  recordReleaseEnvironment,
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
      PLAYER_INSIGHTS_USER_API_SCOPES: 'sql,dashboards.genie,catalog.tables:read',
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

    expect(await restoreReleaseEnvironment(readingStore(JSON.stringify(persisted)), env)).toBe(7);
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
    expect(await restoreReleaseEnvironment(store, env)).toBe(0);
    expect(env.PLAYER_INSIGHTS_CATALOG).toBe('');
  });
});
