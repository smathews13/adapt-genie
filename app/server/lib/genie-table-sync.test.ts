import { describe, expect, it, vi } from 'vitest';

import { genieTableSources, syncGenieTables } from './genie-table-sync';
import type { LakebaseReader } from './lakebase-store';

const SERIALIZED = JSON.stringify({
  version: 2,
  data_sources: {
    tables: [{ identifier: 'catalog.sales.orders' }, { identifier: 'catalog.sales.customers' }],
    metric_views: [{ identifier: 'catalog.sales.revenue_metrics' }],
  },
});

describe('Genie table scope sync', () => {
  it('reads tables and metric views from the serialized Genie inventory', () => {
    expect(genieTableSources({ serialized_space: SERIALIZED })).toEqual([
      { identifier: 'catalog.sales.customers', kind: 'table' },
      { identifier: 'catalog.sales.orders', kind: 'table' },
      { identifier: 'catalog.sales.revenue_metrics', kind: 'metric-view' },
    ]);
  });

  it('persists only Genie sources not already declared', async () => {
    const writes: unknown[][] = [];
    const store = {
      lakebase: {
        query: vi.fn((statement: string, params: unknown[] = []) => {
          if (statement.includes('SELECT id, label, kind')) {
            return Promise.resolve({
              rows: [
                {
                  id: 'existing',
                  label: 'orders',
                  kind: 'unity-catalog',
                  resource_type: 'table',
                  value: 'catalog.sales.orders',
                  note: '',
                  state: 'declared',
                  origin: 'app',
                },
              ],
            });
          }
          writes.push(params);
          return Promise.resolve({
            rows: [
              {
                id: params[0],
                label: params[1],
                kind: params[2],
                resource_type: params[3],
                value: params[4],
                note: params[5],
                state: 'declared',
                origin: params[6],
                changed_by: params[7],
              },
            ],
          });
        }),
      },
    } as LakebaseReader;
    const reader = vi.fn(() => Promise.resolve({ serialized_space: SERIALIZED }));

    const result = await syncGenieTables({
      store,
      spaceId: 'space-1',
      actor: 'admin@example.test',
      reader,
      now: new Date('2026-09-10T12:00:00Z'),
    });

    expect(reader).toHaveBeenCalledWith('/api/2.0/genie/spaces/space-1', {
      include_serialized_space: 'true',
    });
    expect(result).toMatchObject({ status: 'synced', discovered: 3, added: 2 });
    expect(writes.map((params) => params[4])).toEqual(['catalog.sales.customers', 'catalog.sales.revenue_metrics']);
    expect(writes.every((params) => params[6] === 'genie')).toBe(true);
  });
});
