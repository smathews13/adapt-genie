import { describe, expect, it, vi } from 'vitest';

import { genieTableSources, syncGenieTables, userGenieControlPlaneReader } from './genie-table-sync';
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

  it('reads the Genie inventory with the signed-in user token', async () => {
    const call = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ serialized_space: SERIALIZED })));
    const reader = userGenieControlPlaneReader({
      host: 'https://workspace.example',
      token: 'user-token',
      fetchImpl: call,
    });

    await expect(reader('/api/2.0/genie/spaces/space-1', { include_serialized_space: 'true' })).resolves.toMatchObject({
      serialized_space: SERIALIZED,
    });
    expect(String(call.mock.calls[0]?.[0])).toBe(
      'https://workspace.example/api/2.0/genie/spaces/space-1?include_serialized_space=true'
    );
    expect(new Headers(call.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer user-token');
  });

  it('reports the permission the signed-in user needs beside the sync control', async () => {
    const result = await syncGenieTables({
      store: { lakebase: { query: vi.fn() } } as LakebaseReader,
      spaceId: 'space-1',
      actor: 'admin@example.test',
      reader: () => Promise.reject(new Error('User does not have read permission for this Genie space')),
    });

    expect(result.status).toBe('unavailable');
    expect(result.detail).toContain('CAN EDIT');
  });
});
