import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('a Lakebase-bound Deploy-from-Git process', () => {
  it('creates and probes ADAPT storage instead of the legacy schema', async () => {
    vi.stubEnv('LAKEBASE_ENDPOINT', 'projects/example/branches/production');
    vi.stubEnv('PLAYER_INSIGHTS_TARGET', '');
    vi.stubEnv('PLAYER_INSIGHTS_APP_SCHEMA', 'player_insights');
    vi.resetModules();

    const { APP_SCHEMA } = await import('../../shared/app-schema');
    const { schemaStatements } = await import('../routes/insights-routes');
    const { WATCHDOG_PROBE_SQL } = await import('./lakebase-store');

    expect(APP_SCHEMA).toBe('adapt');
    expect(schemaStatements[0]).toBe('CREATE SCHEMA IF NOT EXISTS adapt');
    expect(WATCHDOG_PROBE_SQL).toContain('adapt.conversations');
    expect(WATCHDOG_PROBE_SQL).not.toContain('player_insights.');
  });
});
