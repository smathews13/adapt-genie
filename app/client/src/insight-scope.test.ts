import { describe, expect, it } from 'vitest';

import { insightTables } from './insight-scope';

describe('insightTables', () => {
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
});
