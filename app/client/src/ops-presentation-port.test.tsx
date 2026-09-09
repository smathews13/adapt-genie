import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { dateOnlyBadgeValue, DateRangeBadges } from './DateBadge';
import { ProjectionBreakdown } from './ForecastingPanel';
import { costTilesForDisplay } from './ops-view';
import type { CostTile } from '../../shared/ops-contract';

describe('ADAPT Ops presentation port', () => {
  it('collapses a one-day cost range to one accessible badge', () => {
    const day = dateOnlyBadgeValue('2026-09-03');
    const markup = renderToStaticMarkup(<DateRangeBadges value={{ start: day, end: day }} />);
    expect(markup.match(/dateTime="2026-09-03"/g)).toHaveLength(1);
    expect(markup).toContain('aria-label="Date: 2026-09-03"');
    expect(markup).not.toContain('date-range-separator');
  });

  it('brands the forecast component and gives the total a distinct mark', () => {
    const markup = renderToStaticMarkup(
      <ProjectionBreakdown
        open
        partial={false}
        onToggle={() => {}}
        currency="USD"
        result={{
          dailyQuestions: 1,
          dailyActiveMinutes: 1,
          components: [
            {
              id: 'sql-warehouse',
              label: 'SQL warehouse',
              dailyAmount: 2,
              formula: '',
              unavailable: '',
            },
          ],
          horizons: [
            {
              days: 7,
              label: 'Next 7 days',
              total: 14,
              components: [{ id: 'sql-warehouse', label: 'SQL warehouse', amount: 14, unavailable: '' }],
            },
          ],
        }}
      />
    );
    expect(markup).toContain('data-cost-component="sql-warehouse"');
    expect(markup).toContain('>Ask SQL</span>');
    expect(markup).toContain('lucide-sigma');
  });

  it('keeps source-only resources out of ADAPT cost cards', () => {
    const tile = (id: string): CostTile => ({
      id,
      label: id,
      resourceId: '',
      quality: 'unknown',
      amount: null,
      basis: 'total-in-range',
      population: '',
      attribution: 'unavailable',
      pricing: null,
      unavailable: '',
      remedy: '',
      note: '',
    });
    expect(costTilesForDisplay([tile('genie:data'), tile('genie:dictionary'), tile('legacy-addon')])).toEqual([
      tile('genie:data'),
    ]);
  });

  it('keeps ADAPT latency bars teal while adding aligned cost-card footers', () => {
    const css = readFileSync(new URL('./styles/ops.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.ops-lat-bar-fill\s*\{[^}]*background:\s*var\(--db-blue-600\)/);
    expect(css).toMatch(/\.ops-cost-card-footer\s*\{[^}]*margin-top:\s*auto/);
  });
});
