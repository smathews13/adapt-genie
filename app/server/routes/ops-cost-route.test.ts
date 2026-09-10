import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application, Request, Response } from 'express';

import {
  forgetWorkspaceId,
  GENIE_APP_ACTIVITY_QUERY,
  QUESTION_COST_RUNS_QUERY,
  RESOURCE_ACTIVITY_QUERY,
  questionRun,
  runFoundationCostQuery,
  setupOpsRoutes,
} from './ops-routes';
import type { InsightsAppKit } from './insights-routes';
import type { OpsCostPayload } from '../../shared/ops-contract';
import { USER_MONITORING_ACTIVITY_QUERY } from '../lib/user-spend';

const saved = {
  host: process.env.DATABRICKS_HOST,
  warehouse: process.env.DATABRICKS_SQL_WAREHOUSE_ID,
  endpoint: process.env.DATABRICKS_SERVING_ENDPOINT_NAME,
  app: process.env.DATABRICKS_APP_NAME,
  dataGenie: process.env.PLAYER_INSIGHTS_DATA_GENIE_ID,
  dataTitle: process.env.PLAYER_INSIGHTS_DATA_GENIE_TITLE,
  dictGenie: process.env.PLAYER_INSIGHTS_DICTIONARY_GENIE_ID,
  dictTitle: process.env.PLAYER_INSIGHTS_DICTIONARY_GENIE_TITLE,
  admins: process.env.PLAYER_INSIGHTS_ADMIN_EMAILS,
};

const ENV_NAMES: Record<keyof typeof saved, string> = {
  host: 'DATABRICKS_HOST',
  warehouse: 'DATABRICKS_SQL_WAREHOUSE_ID',
  endpoint: 'DATABRICKS_SERVING_ENDPOINT_NAME',
  app: 'DATABRICKS_APP_NAME',
  dataGenie: 'PLAYER_INSIGHTS_DATA_GENIE_ID',
  dataTitle: 'PLAYER_INSIGHTS_DATA_GENIE_TITLE',
  dictGenie: 'PLAYER_INSIGHTS_DICTIONARY_GENIE_ID',
  dictTitle: 'PLAYER_INSIGHTS_DICTIONARY_GENIE_TITLE',
  admins: 'PLAYER_INSIGHTS_ADMIN_EMAILS',
};

beforeEach(() => {
  forgetWorkspaceId();
  process.env.DATABRICKS_HOST = 'https://workspace.example.test';
  process.env.DATABRICKS_SQL_WAREHOUSE_ID = 'warehouse-1';
  process.env.DATABRICKS_SERVING_ENDPOINT_NAME = 'agent-endpoint';
  process.env.DATABRICKS_APP_NAME = 'adapt';
  delete process.env.PLAYER_INSIGHTS_DATA_GENIE_ID;
  delete process.env.PLAYER_INSIGHTS_DATA_GENIE_TITLE;
  delete process.env.PLAYER_INSIGHTS_DICTIONARY_GENIE_ID;
  delete process.env.PLAYER_INSIGHTS_DICTIONARY_GENIE_TITLE;
  delete process.env.PLAYER_INSIGHTS_ADMIN_EMAILS;
});

afterEach(() => {
  forgetWorkspaceId();
  for (const [key, value] of Object.entries(saved) as Array<[keyof typeof saved, string | undefined]>) {
    const name = ENV_NAMES[key];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('the ranged cost route', () => {
  it('accepts Postgres boolean forms for complete Ask evidence', () => {
    expect(questionRun({ evidence_complete: true }).evidenceComplete).toBe(true);
    expect(questionRun({ evidence_complete: 't' }).evidenceComplete).toBe(true);
    expect(questionRun({ evidence_complete: 1 }).evidenceComplete).toBe(true);
    expect(questionRun({ evidence_complete: false }).evidenceComplete).toBe(false);
    expect(questionRun({ evidence_complete: 'f' }).evidenceComplete).toBe(false);
  });

  it('falls back to the available foundation usage table', async () => {
    const statements: string[] = [];
    const fetchImpl = vi.fn((_input: string | URL | globalThis.Request, init?: RequestInit) => {
      const statement = (JSON.parse(String(init?.body)) as { statement: string }).statement;
      statements.push(statement);
      const body =
        statements.length === 1
          ? { status: { state: 'FAILED', error: { message: 'TABLE_OR_VIEW_NOT_FOUND: system.ai_gateway.usage' } } }
          : { status: { state: 'SUCCEEDED' }, result: { data_array: [] } };
      return Promise.resolve(
        new globalThis.Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    });

    await expect(
      runFoundationCostQuery({
        ids: {
          appName: 'adapt',
          endpointName: 'agent-endpoint',
          foundationModel: 'databricks-claude-sonnet-4-6',
          warehouseId: 'warehouse-1',
          lakebaseEndpoint: 'lakebase-1',
          genieSpaces: [],
          workspaceId: 'workspace-1',
          telemetryEnabled: false,
          appBillingTag: 'matched',
        },
        range: { from: '2026-09-01', to: '2026-09-09' },
        runs: [],
        host: 'https://workspace.example.test',
        token: 'app-token',
        warehouseId: 'warehouse-1',
        fetchImpl: fetchImpl as typeof fetch,
      })
    ).resolves.toMatchObject({ ok: true });
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('system.serving.endpoint_usage');
    expect(statements[0]).toContain('system.ai_gateway.usage');
    expect(statements[1]).toContain('system.serving.endpoint_usage');
    expect(statements[1]).not.toContain('system.ai_gateway.usage');
  });

  it('attributes legacy Genie traces by configured space without double-counting current resource calls', () => {
    expect(RESOURCE_ACTIVITY_QUERY).toContain("trace->'genie_spaces'");
    expect(RESOURCE_ACTIVITY_QUERY).toContain("space->>'id' = c.resource_id");
    expect(RESOURCE_ACTIVITY_QUERY).toContain('AND NOT EXISTS');
    expect(RESOURCE_ACTIVITY_QUERY).toContain('COALESCE(a.calls, 0) + COALESCE(l.calls, 0)');
    expect(GENIE_APP_ACTIVITY_QUERY).toContain("(r.completed_at AT TIME ZONE 'UTC')::date");
    expect(GENIE_APP_ACTIVITY_QUERY).toContain("resource->>'id' = configured.space_id");
    expect(GENIE_APP_ACTIVITY_QUERY).toContain("space->>'id' = configured.space_id");
    expect(GENIE_APP_ACTIVITY_QUERY).toContain('AND NOT EXISTS');
  });

  it('passes complete-day bounds to billing and the run ledger', async () => {
    let handler: ((req: Request, res: Response) => Promise<void>) | undefined;
    const app = {
      get: (path: string, registered: (req: Request, res: Response) => Promise<void>) => {
        if (path === '/api/ops/cost') handler = registered;
      },
      post: () => {},
    } as unknown as Application;
    const lakebase = vi.fn((sql: string) =>
      Promise.resolve({
        rows: sql.includes('SELECT email, role, added_by, added_at')
          ? [
              {
                email: 'active@example.test',
                role: 'consumer',
                added_by: 'admin@example.test',
                added_at: new Date('2026-08-01T00:00:00Z'),
              },
              {
                email: 'session-only@example.test',
                role: 'consumer',
                added_by: 'admin@example.test',
                added_at: new Date('2026-08-02T00:00:00Z'),
              },
            ]
          : sql === USER_MONITORING_ACTIVITY_QUERY
            ? [
                {
                  user_email: 'active@example.test',
                  questions: 2,
                  runs: 1,
                  first_active: new Date('2026-08-16T10:00:00Z'),
                  last_active: new Date('2026-08-16T12:00:00Z'),
                },
                {
                  user_email: 'session-only@example.test',
                  questions: 0,
                  runs: 0,
                  first_active: new Date('2026-08-17T10:00:00Z'),
                  last_active: new Date('2026-08-17T10:00:00Z'),
                },
              ]
            : [
                {
                  run_id: 'run-1',
                  correlation_id: 'req-00000000-0000-0000-0000-000000000001',
                  trace_id: 'trace-1',
                  completed_at: new Date('2026-08-16T12:00:00Z'),
                  total_tokens: '250',
                  runs_in_range: 1,
                  token_covered_runs: 1,
                  total_recorded_tokens: '250',
                },
              ],
      })
    );
    const statementBodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn((input: string | URL | globalThis.Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith('/preview/scim/v2/Me')) {
        return Promise.resolve(
          new globalThis.Response('{}', {
            status: 200,
            headers: { 'x-databricks-org-id': 'workspace-1' },
          })
        );
      }
      statementBodies.push(JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>);
      return Promise.resolve(
        new globalThis.Response(
          JSON.stringify({
            status: { state: 'SUCCEEDED' },
            result: {
              data_array: [
                ['serving-endpoint', '12', 'USD', '7', null, '2026-08-16'],
                ['sql-warehouse', '7', 'USD', '7', null, '2026-08-16'],
                ['__range', null, 'USD', '7', null, '2026-08-16'],
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    });

    setupOpsRoutes(
      {
        lakebase: { query: lakebase },
        servingTransport: () => Promise.reject(new Error('serving must not be asked')),
        server: { extend: (register: (target: Application) => void) => register(app) },
      } as unknown as InsightsAppKit,
      {
        isAdminRoute: () => true,
        now: () => Date.parse('2026-08-18T12:00:00Z'),
        fetchImpl: fetchImpl as typeof fetch,
        billingAppToken: () =>
          Promise.resolve({ host: 'https://workspace.example.test', token: 'app-service-principal-token' }),
        readAppBillingTag: () => Promise.resolve('matched'),
        readFirstAppDeployment: () => Promise.resolve({ deployedAt: '2026-01-01T00:00:00Z' }),
        queryHistoryTransport: {
          listQueries: () =>
            Promise.resolve({
              res: [
                {
                  query_id: 'adapt-query-1',
                  warehouse_id: 'warehouse-1',
                  query_tags: { application: 'ADAPT', surface: 'benchmark', tool: 'genie_result' },
                  metrics: { execution_time_ms: 100 },
                },
              ],
            }),
        },
      }
    );

    let payload = {} as OpsCostPayload;
    await handler!(
      {
        query: { from: '2026-08-10', to: '2026-08-17' },
        headers: {},
        header: (name: string) => (name === 'x-forwarded-access-token' ? 'caller-token' : undefined),
      } as unknown as Request,
      { json: (body: OpsCostPayload) => (payload = body) } as unknown as Response
    );

    expect(payload.period).toBe('current_month');
    expect(payload.range).toEqual({ from: '2026-08-01', to: '2026-08-17' });
    expect(payload.billingLagDays).toBe(1);
    expect(fetchImpl).toHaveBeenCalled();
    expect(
      fetchImpl.mock.calls.every(([, init]) => {
        const authorization = new Headers(init?.headers).get('authorization');
        return authorization === 'Bearer app-service-principal-token';
      })
    ).toBe(true);
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain('caller-token');
    expect(lakebase).toHaveBeenCalledWith(QUESTION_COST_RUNS_QUERY, ['2026-08-01', '2026-08-17']);
    expect(statementBodies[0].parameters).toEqual(
      expect.arrayContaining([
        { name: 'from_day', value: '2026-08-01', type: 'DATE' },
        { name: 'to_day', value: '2026-08-17', type: 'DATE' },
      ])
    );
    expect(payload.perQuestion.runs[0].parts.map((part) => part.id)).toEqual(
      expect.arrayContaining(['serving-endpoint', 'foundation-model', 'sql-warehouse', 'genie'])
    );
    expect(payload.budgets).toEqual({ total: { USD: null, DBU: null }, resources: {} });
    expect(payload.budgetsReadable).toBe(true);
    expect(payload.recentMonthlySpend?.map((month) => month.month)).toEqual(['2026-07', '2026-06', '2026-05']);
    expect(payload.honesty?.priceSource).toBe('list_prices');
    expect(payload.honesty?.contractRates).toBe('unavailable');

    await handler!(
      {
        query: { from: '2026-08-10', to: '2026-08-17', userBrowse: '1' },
        headers: {},
        header: (name: string) =>
          name === 'x-forwarded-access-token'
            ? 'caller-token'
            : name === 'x-forwarded-email'
              ? 'admin@example.test'
              : undefined,
      } as unknown as Request,
      { json: (body: OpsCostPayload) => (payload = body) } as unknown as Response
    );
    expect(payload.userMonitoring?.users.map((row) => row.email).sort()).toEqual([
      'active@example.test',
      'emily.huang@take2games.com',
      'rida.qureshi@take2games.com',
      'sam.mathews@databricks.com',
      'session-only@example.test',
    ]);
    expect(payload.userMonitoring?.pagination.total).toBe(5);
    expect(
      payload.userMonitoring?.users.every(
        (row) => row.lastActive === null || Number.isFinite(Date.parse(row.lastActive))
      )
    ).toBe(true);
  });

  it('traces current resource identity, activity, USD, and DBUs into allocated tiles', async () => {
    let handler: ((req: Request, res: Response) => Promise<void>) | undefined;
    const app = {
      get: (path: string, registered: (req: Request, res: Response) => Promise<void>) => {
        if (path === '/api/ops/cost') handler = registered;
      },
      post: () => {},
    } as unknown as Application;
    const lakebase = vi.fn((sql: string) => {
      if (sql === RESOURCE_ACTIVITY_QUERY) {
        return Promise.resolve({
          rows: [
            { tile_id: 'genie:data', attributed_calls: '3', observed_calls: '4' },
            { tile_id: 'genie:dictionary', attributed_calls: '2', observed_calls: '2' },
          ],
        });
      }
      if (sql.includes('cost_budgets')) {
        return Promise.resolve({
          rows: [
            {
              settings: {
                total: 250,
                resources: {
                  'app-compute': 40,
                  'index-rebuild-job': 30,
                },
              },
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    process.env.PLAYER_INSIGHTS_DATA_GENIE_ID = 'space-data';
    process.env.PLAYER_INSIGHTS_DATA_GENIE_TITLE = 'Player data';
    process.env.PLAYER_INSIGHTS_DICTIONARY_GENIE_ID = 'space-dictionary';
    process.env.PLAYER_INSIGHTS_DICTIONARY_GENIE_TITLE = 'Dictionary';
    const fetchImpl = vi.fn((input: string | URL | globalThis.Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith('/preview/scim/v2/Me')) {
        return Promise.resolve(
          new globalThis.Response('{}', {
            status: 200,
            headers: { 'x-databricks-org-id': 'workspace-1' },
          })
        );
      }
      const statement =
        typeof init?.body === 'string' ? ((JSON.parse(init.body) as { statement?: string }).statement ?? '') : '';
      if (statement.includes('WITH configured_spaces AS')) {
        return Promise.resolve(
          new globalThis.Response(
            JSON.stringify({
              status: { state: 'SUCCEEDED' },
              result: {
                data_array: [
                  [
                    '2026-08-17',
                    'person@example.test',
                    'human',
                    'GENIE_CODE',
                    'UI',
                    'PAYGO',
                    'GENIE_FREE_USAGE',
                    'space-data',
                    'query-history-exact',
                    '12.5',
                    '0',
                    '0',
                    '0',
                    '0',
                    '1',
                    '2026-08-17',
                  ],
                  [
                    '2026-08-17',
                    'person@example.test',
                    'human',
                    'GENIE_ONE',
                    'UI',
                    'PAYGO',
                    'GENIE_FREE_USAGE',
                    'space-dictionary',
                    'query-history-allocation',
                    '3',
                    '0',
                    '0',
                    '0',
                    '0',
                    '1',
                    '2026-08-17',
                  ],
                ],
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        );
      }
      return Promise.resolve(
        new globalThis.Response(
          JSON.stringify({
            status: { state: 'SUCCEEDED' },
            result: {
              data_array: [
                [
                  'component',
                  'app-compute',
                  '21',
                  'USD',
                  '1',
                  '2',
                  null,
                  '2026-08-17',
                  '7',
                  '0',
                  '2',
                  '0',
                  '',
                  'priced',
                  '0',
                  '0',
                  '2026-01-01T00:00:00Z',
                  '2',
                  '0',
                  '1',
                  '7',
                  '1',
                ],
                [
                  'range',
                  '__range',
                  null,
                  'USD',
                  '1',
                  '2',
                  null,
                  '2026-08-17',
                  '8',
                  '0',
                  '2',
                  '0',
                  '',
                  '',
                  '0',
                  '0',
                  '2026-01-01T00:00:00Z',
                  '0',
                  '2',
                  '2',
                  '6',
                  '1',
                ],
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    }) as typeof fetch;

    setupOpsRoutes(
      {
        lakebase: { query: lakebase },
        servingTransport: () => Promise.reject(new Error('serving must not be asked')),
        server: { extend: (register: (target: Application) => void) => register(app) },
      } as unknown as InsightsAppKit,
      {
        isAdminRoute: () => true,
        now: () => Date.parse('2026-08-18T12:00:00Z'),
        fetchImpl,
        billingAppToken: () =>
          Promise.resolve({ host: 'https://workspace.example.test', token: 'app-service-principal-token' }),
        readAppBillingTag: () => Promise.resolve('matched'),
        readFirstAppDeployment: () => Promise.resolve({ deployedAt: '2026-01-01T00:00:00Z' }),
        queryHistoryTransport: { listQueries: () => Promise.resolve({ res: [] }) },
        readOrchestratorReport: () =>
          Promise.resolve({
            report: {
              checked_at: '2026-08-18T12:00:00Z',
              status: 'ok',
              principal: 'app',
              principal_resolved: true,
              table_source: 'release',
              build_sha: 'abc',
              configuration: [],
              checks: [],
              assumptions: [],
              counts: { ok: 0, failed: 0, unverified: 0 },
              source: 'configuration',
            },
          }),
      }
    );

    let payload = {} as OpsCostPayload;
    await handler!(
      {
        query: { from: '2026-08-10', to: '2026-08-17' },
        headers: {},
        header: (name: string) => (name === 'x-forwarded-access-token' ? 'caller-token' : undefined),
      } as unknown as Request,
      { json: (body: OpsCostPayload) => (payload = body) } as unknown as Response
    );

    expect(payload.state).toBe('ready');
    const genie = payload.tiles.filter((tile) => tile.id.startsWith('genie:'));
    expect(genie).toHaveLength(1);
    expect(genie.map((tile) => [tile.id, tile.resourceId])).toEqual([['genie:data', 'space-data']]);
    expect(payload.genieInstances?.map((instance) => instance.spaceId)).toEqual(['space-data']);
    expect(payload.genieInstances).toMatchObject([
      { allowanceUsedDbus: 12.5, promotionalDbus: 0, underlyingTotalDbus: 12.5 },
    ]);
    expect(payload.genieAccounting?.reconciliation).toMatchObject({
      sourceRows: 2,
      sourceDbus: 15.5,
      classifiedDbus: 15.5,
      classificationDifferenceDbus: 0,
    });
    expect(payload.tiles.some((tile) => tile.id === 'foundation-model')).toBe(true);
    expect(payload.tiles.find((tile) => tile.id === 'app-compute')).toMatchObject({
      amount: 21,
      dbus: 7,
      basis: 'total-in-range',
      resourceId: 'adapt',
      attribution: 'deployment',
      unavailable: '',
      note: '',
      remedy: '',
    });
    expect(payload.budgets).toEqual({
      total: { USD: 250, DBU: null },
      resources: { 'app-compute': { USD: 40, DBU: null } },
    });
    expect(payload.budgetsReadable).toBe(true);
  });
});
