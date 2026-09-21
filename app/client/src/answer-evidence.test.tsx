import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AnswerEvidence } from './AnswerEvidence';
import { carriesTable } from './answer-markdown';
import type { Chart } from './AnswerCharts';

/**
 * Both live and stored answers show exact rows before their visual reading.
 *
 * The rule lives in one component so the table/chart order cannot drift between
 * Ask and Run Explorer.
 */

const SOURCES = [{ name: 'catalog.schema.games', freshness: 'fresh' }];

const CHART: Chart = {
  id: 'c1',
  title: 'Sessions by week',
  kind: 'line',
  data: [{ type: 'scatter', x: ['Week 1'], y: [10] }],
  layout: {},
};
const EMPTY_CHART: Chart = {
  id: 'c2',
  title: 'Missing sessions',
  kind: 'line',
  data: [{ type: 'scatter', x: ['Week 1'], y: [null] }],
  layout: {},
};
const ZERO_LINE_CHART: Chart = {
  id: 'c3',
  title: 'Zero-only sessions',
  kind: 'line',
  data: [{ type: 'scatter', x: ['Week 1', 'Week 2'], y: [0, 0] }],
  layout: {},
};

const WITH_TABLE = ['Sessions rose.', '', '| Week | Sessions |', '| --- | --- |', '| 1 | 10 |'].join('\n');

function markup(props: Parameters<typeof AnswerEvidence>[0]): string {
  return renderToStaticMarkup(<AnswerEvidence {...props} />);
}

describe('the evidence half of an answer', () => {
  it('draws the rows when there is no chart to draw', () => {
    const html = markup({ narrative: WITH_TABLE, sources: SOURCES });
    expect(html).toContain('Table evidence');
    expect(html).toContain('<table');
    expect(html).not.toContain('Show the rows behind this');
  });

  it('shows exact rows before the chart for a structured answer', () => {
    const html = markup({ narrative: WITH_TABLE, charts: [CHART], sources: SOURCES });
    expect(html).toContain('Table and chart evidence');
    expect(html).toContain('<table');
    expect(html).toContain('Sessions by week');
    expect(html.indexOf('<table')).toBeLessThan(html.indexOf('Sessions by week'));
    expect(html).not.toContain('Show the rows behind this');
  });

  it('shows the rows directly instead of rendering an empty chart shell', () => {
    const html = markup({ narrative: WITH_TABLE, charts: [EMPTY_CHART], sources: SOURCES });
    expect(html).toContain('Table evidence');
    expect(html).toContain('<table');
    expect(html).not.toContain('Missing sessions');
    expect(html).not.toContain('Show the rows behind this');
  });

  it('shows the rows instead of a zero-only line chart', () => {
    const html = markup({ narrative: WITH_TABLE, charts: [ZERO_LINE_CHART], sources: SOURCES });
    expect(html).toContain('Table evidence');
    expect(html).toContain('<table');
    expect(html).not.toContain('Zero-only sessions');
  });

  it('says nothing at all when the answer measured nothing', () => {
    expect(markup({ narrative: 'A sentence with no figures in it.', sources: SOURCES })).toBe('');
  });

  it('reads the tables out of the second body too', () => {
    expect(carriesTable('prose only', WITH_TABLE)).toBe(true);
    expect(carriesTable('prose only', null)).toBe(false);
    expect(carriesTable(undefined)).toBe(false);
  });
});

describe('both surfaces that show an answer', () => {
  /**
   * Read rather than rendered: the Run Explorer fetches its own trace, so
   * mounting it here would assert against a loading skeleton. What is at stake is
   * which component the narrative is handed to, and that is visible in the source.
   */
  const explorer = readFileSync(new URL('./RunExplorer.tsx', import.meta.url), 'utf8');
  const finalAnswer = readFileSync(new URL('./FinalAnswer.tsx', import.meta.url), 'utf8');
  const card = readFileSync(new URL('./AnswerCard.tsx', import.meta.url), 'utf8');

  it('hands the narrative to the same evidence component', () => {
    for (const source of [finalAnswer, card]) expect(source).toContain('<AnswerEvidence');
    expect(explorer).toContain('<FinalAnswer');
  });

  it('prints only the prose of the narrative, leaving its tables to the evidence', () => {
    // Unqualified, this printed every block including the tables, which is how
    // the Explorer came to show rows a chart was already showing.
    expect(finalAnswer).toMatch(/text=\{story\}[\s\S]{0,80}blocks="prose"/);
  });

  it('keeps the evidence ordering rule out of the card, so it cannot drift', () => {
    expect(card).not.toContain('answer-evidence');
    expect(card).not.toContain('Show the rows behind this');
  });
});
