import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  watchlistSettingsFromResponse,
  watchlistTitlesFromResponse,
  watchlistTrendsFromResponse,
} from './watchlist-api';

describe('watchlist settings and rail', () => {
  it('exposes a dedicated Settings section backed by the watchlist panel', () => {
    const sections = readFileSync(new URL('./settings-sections.ts', import.meta.url), 'utf8');
    const page = readFileSync(new URL('./SettingsPage.tsx', import.meta.url), 'utf8');
    const panel = readFileSync(new URL('./WatchlistSettingsPanel.tsx', import.meta.url), 'utf8');
    expect(sections).toContain("{ id: 'watchlist', label: 'Insights' }");
    expect(page).toContain('<WatchlistSettingsPanel');
    expect(page).toContain('WATCHLIST_SETTINGS_FORM_ID');
    expect(panel).toContain("fetch('/api/watchlist-titles')");
    expect(panel).toContain('placeholder="Search games"');
    expect(panel).toContain("if (event.key === 'Enter') event.preventDefault()");
    expect(panel).toContain('Rail visuals');
    expect(panel).not.toContain("['savedQueries', 'Saved queries']");
    expect(panel).toContain("disabled={state === 'loading' || state === 'saving' || !saved}");
    expect(panel).toContain('<VisitInDatabricks');
    expect(panel).toContain('<Switch');
    expect(panel).not.toContain('<textarea');
  });

  it('renders governed trend states and contains no demo percentages', () => {
    const home = readFileSync(new URL('./HomePage.tsx', import.meta.url), 'utf8');
    const settings = readFileSync(new URL('./WatchlistSettingsPanel.tsx', import.meta.url), 'utf8');
    expect(home).toContain("fetch('/api/watchlist-trends')");
    expect(home).toContain('WATCHLIST_METRIC_LABEL');
    expect(home).not.toContain('className="insight-watch-metric"');
    expect(home).toContain('Source table');
    expect(home).toContain('No prior-period baseline');
    expect(home).not.toContain('INSIGHT_WATCHLIST');
    expect(home).not.toContain('Reading wishlist trends');
    expect(settings).toContain('Watchlist games');
    expect(home).not.toContain('(demo data)');
    expect(home).not.toContain('+41.7%');
  });

  it('parses settings and preserves explicit unavailable trend detail', async () => {
    await expect(
      watchlistSettingsFromResponse(
        new Response(JSON.stringify({ settings: { titles: ['NBA 2K26'] }, revision: 2 }), { status: 200 })
      )
    ).resolves.toEqual({
      settings: {
        titles: ['NBA 2K26'],
        sections: {
          dataInScope: true,
          savedQueries: true,
          watchlist: true,
          answerConfidence: true,
        },
      },
      revision: 2,
    });
    await expect(
      watchlistTitlesFromResponse(
        new Response(
          JSON.stringify({
            status: 'ready',
            sourceTable: 'catalog.schema.sales',
            titles: ['Borderlands 4', 'NBA 2K26'],
          })
        )
      )
    ).resolves.toEqual({
      status: 'ready',
      sourceTable: 'catalog.schema.sales',
      titles: ['Borderlands 4', 'NBA 2K26'],
    });
    await expect(
      watchlistTrendsFromResponse(
        new Response(JSON.stringify({ status: 'unavailable', detail: 'No table configured.', trends: [] }), {
          status: 503,
        })
      )
    ).resolves.toEqual({ status: 'unavailable', detail: 'No table configured.', trends: [] });
  });
});
