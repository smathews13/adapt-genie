import {
  type WatchlistSettings,
  type WatchlistTitlesResponse,
  type WatchlistTrendsResponse,
} from '../../shared/watchlist';
import { DEFAULT_INSIGHT_RAIL_SECTIONS, type InsightRailSections } from '../../shared/insight-rail-sections';

export interface WatchlistSettingsDocument {
  settings: WatchlistSettings;
  revision: number;
}

const INSIGHTS_SETTINGS_CHANGED = 'adapt:insights-settings-changed';

export function notifyInsightsSettingsChanged(settings: WatchlistSettings): void {
  window.dispatchEvent(new CustomEvent<WatchlistSettings>(INSIGHTS_SETTINGS_CHANGED, { detail: settings }));
}

export function listenForInsightsSettingsChanges(visit: (settings: WatchlistSettings) => void): () => void {
  const listener = (event: Event) => visit((event as CustomEvent<WatchlistSettings>).detail);
  window.addEventListener(INSIGHTS_SETTINGS_CHANGED, listener);
  return () => window.removeEventListener(INSIGHTS_SETTINGS_CHANGED, listener);
}

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error(`The watchlist endpoint answered ${response.status} without a readable response.`);
  }
}

function detail(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const value = (body as { detail?: unknown }).detail;
  return typeof value === 'string' ? value : '';
}

function watchlistSettings(value: unknown): WatchlistSettings | null {
  if (!value || typeof value !== 'object') return null;
  const titles = (value as { titles?: unknown }).titles;
  if (!Array.isArray(titles) || titles.length > 20) return null;
  const validated: string[] = [];
  for (const title of titles) {
    if (typeof title !== 'string' || !title.trim() || title.length > 200) return null;
    validated.push(title);
  }
  const rawSections = (value as { sections?: unknown }).sections;
  let sections: InsightRailSections = { ...DEFAULT_INSIGHT_RAIL_SECTIONS };
  if (rawSections !== undefined) {
    if (!rawSections || typeof rawSections !== 'object') return null;
    const candidate = rawSections as Record<keyof InsightRailSections, unknown>;
    const keys = Object.keys(DEFAULT_INSIGHT_RAIL_SECTIONS) as Array<keyof InsightRailSections>;
    if (!keys.every((key) => typeof candidate[key] === 'boolean')) return null;
    sections = Object.fromEntries(keys.map((key) => [key, candidate[key]])) as unknown as InsightRailSections;
  }
  return { titles: validated, sections };
}

export async function watchlistSettingsFromResponse(response: Response): Promise<WatchlistSettingsDocument> {
  const body = await json(response);
  if (!response.ok) throw new Error(detail(body) || `Watchlist settings answered ${response.status}.`);
  const candidate = body as { settings?: unknown; revision?: unknown };
  const settings = watchlistSettings(candidate.settings);
  if (!settings || !Number.isInteger(candidate.revision) || Number(candidate.revision) < 0) {
    throw new Error('The server returned incomplete watchlist settings.');
  }
  return { settings, revision: Number(candidate.revision) };
}

export async function watchlistTrendsFromResponse(response: Response): Promise<WatchlistTrendsResponse> {
  const body = await json(response);
  if (!body || typeof body !== 'object') throw new Error('The watchlist response was incomplete.');
  const candidate = body as WatchlistTrendsResponse;
  if (candidate.status !== 'ready') {
    return {
      status: candidate.status === 'not-configured' ? 'not-configured' : 'unavailable',
      detail: detail(body) || `Watchlist trends answered ${response.status}.`,
      trends: [],
    };
  }
  return candidate;
}

export async function watchlistTitlesFromResponse(response: Response): Promise<WatchlistTitlesResponse> {
  const body = await json(response);
  if (!body || typeof body !== 'object') throw new Error('The title list response was incomplete.');
  const candidate = body as Partial<WatchlistTitlesResponse>;
  if (!response.ok || candidate.status !== 'ready') {
    return {
      status: 'unavailable',
      detail: detail(body) || `Watchlist titles answered ${response.status}.`,
      sourceTable: typeof candidate.sourceTable === 'string' ? candidate.sourceTable : undefined,
      titles: [],
    };
  }
  if (
    typeof candidate.sourceTable !== 'string' ||
    !Array.isArray(candidate.titles) ||
    !candidate.titles.every((title) => typeof title === 'string' && title.trim().length > 0)
  ) {
    throw new Error('The server returned an incomplete title list.');
  }
  return {
    status: 'ready',
    sourceTable: candidate.sourceTable,
    titles: candidate.titles,
  };
}
