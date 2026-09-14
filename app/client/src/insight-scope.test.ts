import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { insightConfidence, insightTables } from './insight-scope';

describe('insightTables', () => {
  it('loads durable declarations independently of the full probe request', () => {
    const source = readFileSync(new URL('./insight-scope.ts', import.meta.url), 'utf8');
    expect(source).toContain("fetch('/api/settings/scope')");
    expect(source).toContain('void readScopeOnce().then');
    expect(source).toContain('void readSettingsOnce().then');
  });

  it('falls back to declared Unity Catalog tables only', () => {
    expect(
      insightTables({
        checks: [],
        connections: [
          { connection: { state: 'declared', resourceType: 'catalog', value: 'main' } },
          { connection: { state: 'declared', resourceType: 'schema', value: 'main.analytics' } },
          { connection: { state: 'declared', resourceType: 'table', value: 'main.analytics.orders' } },
          { connection: { state: 'declared', resourceType: 'table', value: 'MAIN.ANALYTICS.ORDERS' } },
          { connection: { state: 'removed', resourceType: 'table', value: 'main.analytics.old_orders' } },
        ],
      })
    ).toEqual([
      {
        name: 'main.analytics.orders',
        display: 'analytics.orders',
        status: 'unverified',
      },
    ]);
  });

  it('keeps probed tables authoritative when checks are available', () => {
    expect(
      insightTables({
        checks: [{ kind: 'table', name: 'main.analytics.checked', status: 'ok' }],
        connections: [{ connection: { state: 'declared', resourceType: 'table', value: 'main.analytics.fallback' } }],
      })
    ).toEqual([
      {
        name: 'main.analytics.checked',
        display: 'analytics.checked',
        status: 'ok',
      },
    ]);
  });

  it('counts the authoritative declarations independently of reachability probes', () => {
    const payload = {
      checks: [
        { kind: 'serving-endpoint', name: 'adapt', status: 'ok' },
        { kind: 'genie-space', name: 'space', status: 'ok' },
      ],
      connections: Array.from({ length: 11 }, (_, index) => ({
        connection: {
          state: 'declared',
          resourceType: 'table',
          value: `main.analytics.table_${index + 1}`,
        },
      })),
    };
    expect(insightConfidence(payload)).toContainEqual({
      tone: 'ok',
      text: '11 tables in scope',
    });
  });
});
