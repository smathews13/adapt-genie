import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { QuestionDrawer } from './MonitoringPage';
import { UsedThisRun } from './UsedThisRun';
import { RUN_RUNTIME_USED_ABSENT, RUN_RUNTIME_USED_HEADING, type RunRuntimeUsed } from '../../shared/run-runtime-used';
import type { MonitoringDetail } from '../../shared/monitoring-contract';

const EXPLORER = readFileSync(new URL('./RunExplorer.tsx', import.meta.url), 'utf8');
const MONITORING = readFileSync(new URL('./MonitoringPage.tsx', import.meta.url), 'utf8');

const SNAPSHOT: RunRuntimeUsed = {
  answer: {
    takeaway: true,
    narrative: true,
    figures: false,
    charts: false,
    narrativeMaxCharacters: 800,
    figuresOrder: 'totals-first',
  },
};

function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('Settings applied in this run', () => {
  it('keeps runtime settings out of Run Explorer and Monitoring answers', () => {
    expect(RUN_RUNTIME_USED_HEADING).toBe('Settings applied in this run');
    expect(EXPLORER).not.toContain("from './UsedThisRun'");
    expect(EXPLORER).not.toContain('<UsedThisRun');
    expect(MONITORING).not.toContain("from './UsedThisRun'");
    expect(MONITORING).not.toContain('<UsedThisRun');
  });

  it('keeps the Overview free of that rail and the removed Agent map', () => {
    const overviewPane = EXPLORER.slice(
      EXPLORER.indexOf('<TabsContent value="overview"'),
      EXPLORER.indexOf('<TabsContent value="timeline"')
    );
    expect(overviewPane).not.toContain('<UsedThisRun');
    expect(overviewPane).toContain('<RunOverviewKpis');
    expect(EXPLORER).not.toContain('<TraceDag');
    expect(EXPLORER).not.toContain('value="map"');
  });

  it('shows the answer settings that Ask sent', () => {
    const rendered = text(renderToStaticMarkup(<UsedThisRun used={SNAPSHOT} />));
    expect(rendered).toContain(RUN_RUNTIME_USED_HEADING);
    expect(rendered).toContain('Figures off');
    expect(rendered).toContain('Narrative cap 800');
    expect(rendered).toContain('Order Totals first');
    expect(rendered).not.toContain(RUN_RUNTIME_USED_ABSENT);
    expect(rendered).not.toContain('150');
  });

  it('says Not recorded when the run stored no snapshot', () => {
    const rendered = text(renderToStaticMarkup(<UsedThisRun used={null} />));
    expect(rendered).toContain(RUN_RUNTIME_USED_HEADING);
    expect(rendered).toContain(RUN_RUNTIME_USED_ABSENT);
  });

  it('keeps runtime settings out of the Monitoring answer drawer', () => {
    const withSnapshot = text(
      renderToStaticMarkup(
        <MemoryRouter>
          <QuestionDrawer detail={drawerDetail({ runtimeUsed: SNAPSHOT })} onClose={() => {}} canOpenUser />
        </MemoryRouter>
      )
    );
    expect(withSnapshot).not.toContain('Figures off');
    const without = text(
      renderToStaticMarkup(
        <MemoryRouter>
          <QuestionDrawer detail={drawerDetail({ runtimeUsed: null })} onClose={() => {}} canOpenUser />
        </MemoryRouter>
      )
    );
    expect(without).not.toContain(RUN_RUNTIME_USED_ABSENT);
  });
});

function drawerDetail(overrides: Partial<MonitoringDetail> = {}): MonitoringDetail {
  return {
    id: 'q1',
    conversationId: 'c1',
    question: 'Which countries grew fastest this quarter?',
    askedBy: 'first.person@example.test',
    askedAt: '2026-08-15T06:40:00Z',
    outcome: 'completed',
    outcomeDetail: null,
    outcomeCode: null,
    answer: null,
    conditioning: null,
    trace: null,
    tokens: null,
    execution: null,
    rating: null,
    usefulness: null,
    comment: null,
    mlflowUrl: null,
    runId: 'a1',
    ...overrides,
  };
}
