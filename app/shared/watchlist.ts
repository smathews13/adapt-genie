import { z } from 'zod';
export { WATCHLIST_METRIC_DETAIL, WATCHLIST_METRIC_LABEL } from './watchlist-metric';
import { WATCHLIST_METRIC_LABEL } from './watchlist-metric';
export { DEFAULT_INSIGHT_RAIL_SECTIONS, type InsightRailSections } from './insight-rail-sections';
import { DEFAULT_INSIGHT_RAIL_SECTIONS } from './insight-rail-sections';

export const WATCHLIST_MAX_TITLES = 20;

export const InsightRailSectionsSchema = z.strictObject({
  dataInScope: z.boolean(),
  savedQueries: z.boolean(),
  watchlist: z.boolean(),
  answerConfidence: z.boolean(),
});

export const WatchlistSettingsSchema = z.strictObject({
  titles: z.array(z.string().trim().min(1).max(200)).max(WATCHLIST_MAX_TITLES),
  sections: InsightRailSectionsSchema.default(DEFAULT_INSIGHT_RAIL_SECTIONS),
});

export const WatchlistSettingsPatchSchema = WatchlistSettingsSchema.partial();
export type WatchlistSettings = z.infer<typeof WatchlistSettingsSchema>;

export const DEFAULT_WATCHLIST_SETTINGS: WatchlistSettings = {
  titles: ['Grand Theft Auto V', 'Red Dead Redemption 2', 'NBA 2K26', 'Borderlands 4'],
  sections: DEFAULT_INSIGHT_RAIL_SECTIONS,
};

export function parseWatchlistSettings(value: unknown): WatchlistSettings {
  const parsed = WatchlistSettingsSchema.parse(value);
  const seen = new Set<string>();
  return {
    titles: parsed.titles.filter((title) => {
      const key = title.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    sections: parsed.sections,
  };
}

export interface WatchlistTrend {
  title: string;
  recentRevenuePerSale: number | null;
  precedingRevenuePerSale: number | null;
  trendPercent: number | null;
}

export type WatchlistTitlesResponse =
  | {
      status: 'ready';
      sourceTable: string;
      titles: string[];
    }
  | {
      status: 'unavailable';
      detail: string;
      sourceTable?: string;
      titles: [];
    };

export type WatchlistTrendsResponse =
  | {
      status: 'ready';
      asOfDate: string;
      periodDays: number;
      sourceTable: string;
      metric: typeof WATCHLIST_METRIC_LABEL;
      trends: WatchlistTrend[];
    }
  | {
      status: 'unavailable' | 'not-configured';
      detail: string;
      trends: [];
      sourceTable?: string;
    };
