import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('Deploy-from-Git schema continuity', () => {
  it('keeps the existing schema owned by the unchanged app role', async () => {
    vi.stubEnv('LAKEBASE_ENDPOINT', 'projects/example/branches/production');
    vi.stubEnv('PLAYER_INSIGHTS_TARGET', '');
    vi.stubEnv('PLAYER_INSIGHTS_APP_SCHEMA', 'player_insights');
    vi.resetModules();

    const { preserveOwnedAppSchema } = await import('./app-schema-bootstrap');
    const schema = await preserveOwnedAppSchema({
      query: vi.fn().mockResolvedValue({
        rows: [{ nspname: 'compatibility_store' }, { nspname: 'adapt' }],
      }),
    });
    const { APP_SCHEMA } = await import('../../shared/app-schema');

    expect(schema).toBe('compatibility_store');
    expect(APP_SCHEMA).toBe('compatibility_store');
  });

  it('does not mistake the public adapt default for an intentional schema override', async () => {
    vi.stubEnv('LAKEBASE_ENDPOINT', 'projects/example/branches/production');
    vi.stubEnv('PLAYER_INSIGHTS_TARGET', '');
    vi.stubEnv('PLAYER_INSIGHTS_APP_SCHEMA', 'adapt');
    vi.resetModules();

    const { preserveOwnedAppSchema } = await import('./app-schema-bootstrap');
    const query = vi.fn().mockResolvedValue({
      rows: [{ nspname: 'adapt_genie' }, { nspname: 'adapt' }],
    });

    expect(await preserveOwnedAppSchema({ query })).toBe('adapt_genie');
    expect(query).toHaveBeenCalledOnce();
  });

  it('uses adapt for a new Git app with no existing owned store', async () => {
    vi.stubEnv('LAKEBASE_ENDPOINT', 'projects/example/branches/production');
    vi.stubEnv('PLAYER_INSIGHTS_TARGET', '');
    vi.stubEnv('PLAYER_INSIGHTS_APP_SCHEMA', 'player_insights');
    vi.resetModules();

    const { preserveOwnedAppSchema } = await import('./app-schema-bootstrap');
    const schema = await preserveOwnedAppSchema({
      query: vi.fn().mockResolvedValue({ rows: [] }),
    });

    expect(schema).toBe('adapt');
  });
});
