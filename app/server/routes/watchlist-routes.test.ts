import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAdminRoute } from '../lib/admin-roles';
import {
  parseWatchlistRows,
  setupWatchlistRoutes,
  validatedWatchlistTable,
  watchlistStatement,
  watchlistTitlesStatement,
} from './watchlist-routes';

const realFetch = globalThis.fetch;
let closeServer: (() => Promise<void>) | null = null;

afterEach(async () => {
  vi.unstubAllGlobals();
  if (closeServer) await closeServer();
  closeServer = null;
});

describe('watchlist query contract', () => {
  it('accepts only a strict three-part table identifier', () => {
    expect(validatedWatchlistTable('catalog.schema.table_name')).toBe('catalog.schema.table_name');
    expect(validatedWatchlistTable('catalog.schema.table; DROP TABLE x')).toBeNull();
    expect(validatedWatchlistTable('schema.table')).toBeNull();
    expect(validatedWatchlistTable('catalog.bad-name.table')).toBeNull();
  });

  it('places writes behind the server-authorized admin namespace', () => {
    expect(isAdminRoute('/api/admin/watchlist-settings')).toBe(true);
    expect(isAdminRoute('/api/watchlist-settings')).toBe(false);
    expect(isAdminRoute('/api/watchlist-titles')).toBe(false);
    expect(isAdminRoute('/api/watchlist-trends')).toBe(false);
  });

  it('loads every unique non-empty title from the configured sales table', () => {
    const sql = watchlistTitlesStatement('catalog.schema.sales');
    expect(sql).toContain('SELECT DISTINCT trim(TITLE_ROLL_UP_DESC)');
    expect(sql).toContain('FROM `catalog`.`schema`.`sales`');
    expect(sql).not.toContain('LIMIT');
  });

  it('builds adjacent seven-day periods against net revenue and units', () => {
    const sql = watchlistStatement('catalog.schema.sales', 2);
    expect(sql).toContain('date_sub(anchor.as_of_date, 7)');
    expect(sql).toContain('date_sub(anchor.as_of_date, 14)');
    expect(sql).toContain('NET_REV_USD_AMT');
    expect(sql).toContain('UNIT_QTY');
    expect(sql).not.toContain('WISHLIST_ADDS');
    expect(sql).toContain('lower(:title_0)');
    expect(sql).not.toContain('NBA 2K26');
  });

  it('parses revenue per unit and leaves a missing baseline explicit', () => {
    expect(
      parseWatchlistRows([
        ['A', '12', '10', '2026-09-07'],
        ['B', '4', '0', '2026-09-07'],
        ['C', null, null, '2026-09-07'],
      ])
    ).toEqual({
      asOfDate: '2026-09-07',
      trends: [
        {
          title: 'A',
          recentRevenuePerSale: 12,
          precedingRevenuePerSale: 10,
          trendPercent: 20,
        },
        {
          title: 'B',
          recentRevenuePerSale: 4,
          precedingRevenuePerSale: 0,
          trendPercent: null,
        },
        {
          title: 'C',
          recentRevenuePerSale: null,
          precedingRevenuePerSale: null,
          trendPercent: null,
        },
      ],
    });
  });
});

async function start() {
  const app = express();
  app.use(express.json());
  const lakebase = {
    query: vi.fn((sql: string) => {
      if (sql.includes('SELECT settings, revision')) {
        return { rows: [{ settings: { titles: ['NBA 2K26'] }, revision: 3 }] };
      }
      return { rows: [] };
    }),
  };
  setupWatchlistRoutes({
    lakebase,
    server: { extend: (register: (application: express.Application) => void) => register(app) },
  } as never);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  closeServer = () => new Promise((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('watchlist delegated SQL route', () => {
  it('refuses to query without the signed-in user token', async () => {
    vi.stubEnv('PLAYER_INSIGHTS_WATCHLIST_TABLE', 'catalog.schema.sales');
    const origin = await start();
    const response = await realFetch(`${origin}/api/watchlist-trends`);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ status: 'unavailable', trends: [] });
  });

  it('forwards the caller token and never substitutes app credentials', async () => {
    vi.stubEnv('PLAYER_INSIGHTS_WATCHLIST_TABLE', 'catalog.schema.sales');
    vi.stubEnv('DATABRICKS_HOST', 'https://workspace.example');
    vi.stubEnv('DATABRICKS_SQL_WAREHOUSE_ID', 'warehouse-1');
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
        if (!target.includes('/api/2.0/sql/statements')) return realFetch(url, init);
        calls.push(init ?? {});
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: { state: 'SUCCEEDED' },
              result: { data_array: [['NBA 2K26', '112', '100', '2026-09-07']] },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        );
      })
    );
    const origin = await start();
    const response = await realFetch(`${origin}/api/watchlist-trends`, {
      headers: { 'x-forwarded-access-token': 'reader-oauth-token' },
    });
    expect(response.status).toBe(200);
    expect((calls[0].headers as Record<string, string>).authorization).toBe('Bearer reader-oauth-token');
    expect(JSON.stringify(calls[0])).not.toContain('service-principal');
    expect(await response.json()).toMatchObject({
      status: 'ready',
      asOfDate: '2026-09-07',
      trends: [
        {
          title: 'NBA 2K26',
          recentRevenuePerSale: 112,
          precedingRevenuePerSale: 100,
          trendPercent: 12,
        },
      ],
    });
  });

  it('refreshes distinct titles as the signed-in user', async () => {
    vi.stubEnv('PLAYER_INSIGHTS_WATCHLIST_TABLE', 'catalog.schema.sales');
    vi.stubEnv('DATABRICKS_HOST', 'https://workspace.example');
    vi.stubEnv('DATABRICKS_SQL_WAREHOUSE_ID', 'warehouse-1');
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
        if (!target.includes('/api/2.0/sql/statements')) return realFetch(url, init);
        calls.push(init ?? {});
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: { state: 'SUCCEEDED' },
              result: { data_array: [['Borderlands 4'], ['NBA 2K26'], ['NBA 2K26']] },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        );
      })
    );
    const origin = await start();
    const response = await realFetch(`${origin}/api/watchlist-titles`, {
      headers: { 'x-forwarded-access-token': 'reader-oauth-token' },
    });
    expect(response.status).toBe(200);
    expect((calls[0].headers as Record<string, string>).authorization).toBe('Bearer reader-oauth-token');
    expect(JSON.stringify(calls[0])).toContain('title_catalog');
    expect(await response.json()).toEqual({
      status: 'ready',
      sourceTable: 'catalog.schema.sales',
      titles: ['Borderlands 4', 'NBA 2K26'],
    });
  });
});
