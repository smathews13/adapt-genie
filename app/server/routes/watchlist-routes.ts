import { z } from 'zod';
import { normalizeWorkspaceHost } from '../../shared/databricks-links';
import {
  WATCHLIST_METRIC_LABEL,
  WatchlistSettingsPatchSchema,
  type WatchlistTitlesResponse,
  type WatchlistTrend,
  type WatchlistTrendsResponse,
} from '../../shared/watchlist';
import { recordAdminAction } from '../lib/admin-roles';
import { sqlQueryTags } from '../lib/sql-query-tags';
import { readWatchlistSettings, writeWatchlistSettings } from '../lib/watchlist-settings-store';
import { SettingsRevisionConflict } from '../lib/versioned-settings-store';
import { forwardedUserToken } from './access-verification';
import { userEmail, type InsightsAppKit } from './insights-routes';

const PERIOD_DAYS = 7;
const TABLE_ENV = 'PLAYER_INSIGHTS_WATCHLIST_TABLE';
const TABLE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;

const WatchlistWrite = z.strictObject({
  revision: z.number().int().nonnegative(),
  patch: WatchlistSettingsPatchSchema,
});

type StatementResponse = {
  status?: { state?: string; error?: { message?: string } };
  result?: { data_array?: unknown[][] };
  message?: string;
};

export function validatedWatchlistTable(value: string | undefined): string | null {
  const table = (value ?? '').trim();
  return TABLE_IDENTIFIER.test(table) ? table : null;
}

function quotedTable(table: string): string {
  return table
    .split('.')
    .map((part) => `\`${part}\``)
    .join('.');
}

export function watchlistStatement(table: string, titleCount: number): string {
  const configured = Array.from(
    { length: titleCount },
    (_, index) => `${index === 0 ? 'SELECT' : 'UNION ALL SELECT'} :title_${index} AS title`
  ).join('\n');
  const source = quotedTable(table);
  return `WITH configured AS (
  ${configured}
),
anchors AS (
  SELECT configured.title, MAX(source.DATE) AS as_of_date
  FROM configured
  LEFT JOIN ${source} source
    ON lower(source.TITLE_ROLL_UP_DESC) = lower(configured.title)
  GROUP BY configured.title
),
display_anchor AS (
  SELECT MAX(as_of_date) AS as_of_date FROM anchors
),
periods AS (
  SELECT
    anchors.title,
    SUM(CASE WHEN source.DATE > date_sub(anchors.as_of_date, ${PERIOD_DAYS}) THEN source.NET_REV_USD_AMT ELSE 0 END) AS recent_rev,
    SUM(CASE WHEN source.DATE > date_sub(anchors.as_of_date, ${PERIOD_DAYS}) THEN source.UNIT_QTY ELSE 0 END) AS recent_units,
    SUM(CASE
      WHEN source.DATE > date_sub(anchors.as_of_date, ${PERIOD_DAYS * 2})
       AND source.DATE <= date_sub(anchors.as_of_date, ${PERIOD_DAYS})
      THEN source.NET_REV_USD_AMT ELSE 0 END) AS preceding_rev,
    SUM(CASE
      WHEN source.DATE > date_sub(anchors.as_of_date, ${PERIOD_DAYS * 2})
       AND source.DATE <= date_sub(anchors.as_of_date, ${PERIOD_DAYS})
      THEN source.UNIT_QTY ELSE 0 END) AS preceding_units
  FROM anchors
  LEFT JOIN ${source} source
    ON lower(source.TITLE_ROLL_UP_DESC) = lower(anchors.title)
   AND source.DATE > date_sub(anchors.as_of_date, ${PERIOD_DAYS * 2})
  GROUP BY anchors.title
)
SELECT anchors.title,
       CASE WHEN COALESCE(SUM(periods.recent_units), 0) = 0 THEN NULL
            ELSE COALESCE(SUM(periods.recent_rev), 0) / SUM(periods.recent_units) END,
       CASE WHEN COALESCE(SUM(periods.preceding_units), 0) = 0 THEN NULL
            ELSE COALESCE(SUM(periods.preceding_rev), 0) / SUM(periods.preceding_units) END,
       CAST(display_anchor.as_of_date AS STRING)
FROM anchors
CROSS JOIN display_anchor
LEFT JOIN periods ON lower(periods.title) = lower(anchors.title)
GROUP BY anchors.title, display_anchor.as_of_date
ORDER BY anchors.title`;
}

export function watchlistTitlesStatement(table: string): string {
  return `SELECT DISTINCT trim(TITLE_ROLL_UP_DESC) AS title
FROM ${quotedTable(table)}
WHERE TITLE_ROLL_UP_DESC IS NOT NULL
  AND trim(TITLE_ROLL_UP_DESC) <> ''
ORDER BY title`;
}

function numericOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

export function parseWatchlistRows(rows: unknown[][]): { asOfDate: string; trends: WatchlistTrend[] } | null {
  let asOfDate = '';
  const trends: WatchlistTrend[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 4 || typeof row[0] !== 'string') return null;
    const recentRevenuePerSale = numericOrNull(row[1]);
    const precedingRevenuePerSale = numericOrNull(row[2]);
    const date = typeof row[3] === 'string' ? row[3] : '';
    if (date) asOfDate = date;
    trends.push({
      title: row[0],
      recentRevenuePerSale,
      precedingRevenuePerSale,
      trendPercent:
        precedingRevenuePerSale !== null && precedingRevenuePerSale > 0 && recentRevenuePerSale !== null
          ? ((recentRevenuePerSale - precedingRevenuePerSale) / precedingRevenuePerSale) * 100
          : null,
    });
  }
  return asOfDate ? { asOfDate, trends } : null;
}

async function queryTrends(token: string, table: string, titles: string[]): Promise<WatchlistTrendsResponse> {
  const host = normalizeWorkspaceHost(process.env.DATABRICKS_HOST);
  const warehouseId = (process.env.DATABRICKS_SQL_WAREHOUSE_ID ?? '').trim();
  if (!host || !warehouseId) {
    return {
      status: 'unavailable',
      detail: 'The watchlist cannot run because this deployment has no SQL warehouse configured.',
      sourceTable: table,
      trends: [],
    };
  }
  let response: Response;
  try {
    response = await fetch(`${host}/api/2.0/sql/statements`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        warehouse_id: warehouseId,
        statement: watchlistStatement(table, titles.length),
        parameters: titles.map((value, index) => ({ name: `title_${index}`, value, type: 'STRING' })),
        query_tags: sqlQueryTags({
          surface: 'watchlist',
          tool: 'sales_revenue_per_unit',
          operation: 'read',
        }),
        wait_timeout: '30s',
        on_wait_timeout: 'CANCEL',
        format: 'JSON_ARRAY',
        disposition: 'INLINE',
      }),
      signal: AbortSignal.timeout(35_000),
    });
  } catch (error) {
    return {
      status: 'unavailable',
      detail: `Watchlist trends could not be read from the SQL warehouse: ${(error as Error).message}`,
      sourceTable: table,
      trends: [],
    };
  }
  const body = (await response.json().catch(() => ({}))) as StatementResponse;
  if (!response.ok || body.status?.state !== 'SUCCEEDED') {
    return {
      status: 'unavailable',
      detail:
        body.message ||
        body.status?.error?.message ||
        `Watchlist trends were unavailable because Databricks returned HTTP ${response.status}.`,
      sourceTable: table,
      trends: [],
    };
  }
  const parsed = parseWatchlistRows(body.result?.data_array ?? []);
  if (!parsed) {
    return {
      status: 'unavailable',
      detail: 'The sales table returned no dated rows or an unreadable result.',
      sourceTable: table,
      trends: [],
    };
  }
  return {
    status: 'ready',
    sourceTable: table,
    periodDays: PERIOD_DAYS,
    metric: WATCHLIST_METRIC_LABEL,
    ...parsed,
  };
}

async function queryTitles(token: string, table: string): Promise<WatchlistTitlesResponse> {
  const host = normalizeWorkspaceHost(process.env.DATABRICKS_HOST);
  const warehouseId = (process.env.DATABRICKS_SQL_WAREHOUSE_ID ?? '').trim();
  if (!host || !warehouseId) {
    return {
      status: 'unavailable',
      detail: 'Titles cannot be loaded because this deployment has no SQL warehouse configured.',
      sourceTable: table,
      titles: [],
    };
  }
  try {
    const response = await fetch(`${host}/api/2.0/sql/statements`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        warehouse_id: warehouseId,
        statement: watchlistTitlesStatement(table),
        query_tags: sqlQueryTags({
          surface: 'watchlist',
          tool: 'title_catalog',
          operation: 'read',
        }),
        wait_timeout: '30s',
        on_wait_timeout: 'CANCEL',
        format: 'JSON_ARRAY',
        disposition: 'INLINE',
      }),
      signal: AbortSignal.timeout(35_000),
    });
    const body = (await response.json().catch(() => ({}))) as StatementResponse;
    if (!response.ok || body.status?.state !== 'SUCCEEDED') {
      return {
        status: 'unavailable',
        detail:
          body.message ||
          body.status?.error?.message ||
          `Titles were unavailable because Databricks returned HTTP ${response.status}.`,
        sourceTable: table,
        titles: [],
      };
    }
    const titles = (body.result?.data_array ?? [])
      .map((row) => (Array.isArray(row) && typeof row[0] === 'string' ? row[0].trim() : ''))
      .filter(Boolean);
    return { status: 'ready', sourceTable: table, titles: [...new Set(titles)] };
  } catch (error) {
    return {
      status: 'unavailable',
      detail: `Titles could not be read from the SQL warehouse: ${(error as Error).message}`,
      sourceTable: table,
      titles: [],
    };
  }
}

export function setupWatchlistRoutes(appkit: InsightsAppKit): void {
  appkit.server.extend((app) => {
    app.get('/api/watchlist-settings', async (_req, res) => {
      try {
        res.json(await readWatchlistSettings(appkit));
      } catch (error) {
        res.status(503).json({
          error: 'watchlist_settings_unavailable',
          detail: `Watchlist settings could not be read from Lakebase: ${(error as Error).message}`,
        });
      }
    });

    app.put('/api/admin/watchlist-settings', async (req, res) => {
      const parsed = WatchlistWrite.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_watchlist_settings', detail: parsed.error.message });
        return;
      }
      let document: Awaited<ReturnType<typeof writeWatchlistSettings>>;
      try {
        document = await writeWatchlistSettings(appkit, parsed.data.patch, parsed.data.revision, userEmail(req));
      } catch (error) {
        const conflict = error instanceof SettingsRevisionConflict;
        res.status(conflict ? 409 : 503).json({
          error: conflict ? 'watchlist_settings_conflict' : 'watchlist_settings_unavailable',
          detail: conflict ? error.message : `The watchlist was not saved: ${(error as Error).message}`,
        });
        return;
      }
      try {
        await recordAdminAction(appkit.lakebase, {
          actor: userEmail(req),
          action: 'watchlist-settings-updated',
          subject: 'watchlist',
          detail: `Configured ${document.settings.titles.length} watchlist titles.`,
        });
      } catch (error) {
        console.warn('[watchlist] Saved settings, but could not write the admin audit row:', error);
      }
      res.json(document);
    });

    app.get('/api/watchlist-titles', async (req, res) => {
      const table = validatedWatchlistTable(process.env[TABLE_ENV]);
      if (!table) {
        res.status(503).json({
          status: 'unavailable',
          detail: `Titles are unavailable because ${TABLE_ENV} is missing or is not a strict three-part table identifier.`,
          titles: [],
        } satisfies WatchlistTitlesResponse);
        return;
      }
      const token = forwardedUserToken(req);
      if (!token) {
        res.status(401).json({
          status: 'unavailable',
          detail: 'Titles are unavailable because this request has no signed-in user OAuth token.',
          sourceTable: table,
          titles: [],
        } satisfies WatchlistTitlesResponse);
        return;
      }
      const result = await queryTitles(token, table);
      res.status(result.status === 'ready' ? 200 : 503).json(result);
    });

    app.get('/api/watchlist-trends', async (req, res) => {
      const table = validatedWatchlistTable(process.env[TABLE_ENV]);
      if (!table) {
        res.status(503).json({
          status: 'unavailable',
          detail: `Watchlist data is unavailable because ${TABLE_ENV} is missing or is not a strict three-part table identifier.`,
          trends: [],
        } satisfies WatchlistTrendsResponse);
        return;
      }
      const token = forwardedUserToken(req);
      if (!token) {
        res.status(401).json({
          status: 'unavailable',
          detail: 'Watchlist data is unavailable because this request has no signed-in user OAuth token.',
          sourceTable: table,
          trends: [],
        } satisfies WatchlistTrendsResponse);
        return;
      }
      let document: Awaited<ReturnType<typeof readWatchlistSettings>>;
      try {
        document = await readWatchlistSettings(appkit);
      } catch (error) {
        res.status(503).json({
          status: 'unavailable',
          detail: `Watchlist settings could not be read from Lakebase: ${(error as Error).message}`,
          sourceTable: table,
          trends: [],
        } satisfies WatchlistTrendsResponse);
        return;
      }
      if (document.settings.titles.length === 0) {
        res.json({
          status: 'not-configured',
          detail: 'No titles are configured. An administrator can add them in Settings → Insights.',
          sourceTable: table,
          trends: [],
        } satisfies WatchlistTrendsResponse);
        return;
      }
      const result = await queryTrends(token, table, document.settings.titles);
      res.status(result.status === 'ready' || result.status === 'not-configured' ? 200 : 503).json(result);
    });
  });
}
