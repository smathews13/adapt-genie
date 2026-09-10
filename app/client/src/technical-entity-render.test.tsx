import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { TraceStage } from './answer-shape';
import { AnswerProse } from './DataEntityLinks';
import { LiveProgress } from './LiveProgress';
import { PayloadView, RawPayload, TraceTimeline } from './TraceTimeline';
import { describePayload } from './trace-payload';
import { partial } from './styles/stylesheet';

const TABLE = 'example_catalog.sales_demo.silver_sales_activity';

function stage(fields: Partial<TraceStage> & Pick<TraceStage, 'id' | 'name'>): TraceStage {
  return {
    kind: 'agent',
    start: 0,
    duration: 100,
    status: 'complete',
    calls: 1,
    input: '',
    output: '',
    ...fields,
  } as TraceStage;
}

describe('the shared technical-entity formatter', () => {
  it('renders a model decision tool as semantic inline code in live progress', () => {
    const markup = renderToStaticMarkup(
      <LiveProgress
        stages={[stage({ id: 'step-1', name: 'Chose the next step', output: 'run_sql' })]}
        openedAt={1}
        question="Which games exist?"
      />
    );
    expect(markup).toContain('Chose to call ');
    expect(markup).toContain(
      '<code class="answer-code semantic-inline-code" data-technical-entity="tool">run_sql</code>'
    );
  });

  it('renders a stored Run Explorer event tool through the same formatter', () => {
    const called = stage({
      id: 'step-1-1-query_metrics',
      name: 'Called query_metrics',
      kind: 'tool',
      input: '{"question":"games titles franchises","kind":"table"}',
    });
    const markup = renderToStaticMarkup(
      <TraceTimeline variant="explorer" trace={{ id: 'tr-1', totalMs: 100, stages: [called] }} />
    );
    expect(markup).toContain('data-technical-entity="tool">query_metrics</code>');
  });

  it('renders tool identifiers but keeps ordinary underscore prose plain in answer prose', () => {
    const markup = renderToStaticMarkup(
      <AnswerProse text="The run used run_sql; request_id was omitted." sources={[]} />
    );
    expect(markup).toContain('data-technical-entity="tool">run_sql</code>');
    expect(markup).toContain('request_id');
    expect(markup).not.toContain('data-technical-entity="tool">request_id</code>');
  });
});

describe('table entities in answer and trace prose', () => {
  const answerCss = partial('answer.css');
  const tokens = partial('astrolabe-tokens.css');

  it('renders full and unambiguous table-only names inline in the answer body', () => {
    const markup = renderToStaticMarkup(
      <AnswerProse
        text={`The governed source is ${TABLE}. The silver_sales_activity rows contain session events.`}
        sources={[{ name: TABLE }]}
      />
    );
    expect(markup.match(/class="entity-table-mark"/g)).toHaveLength(2);
    expect(markup).toContain('data-entity-part="catalog"');
    expect(markup).toContain('data-entity-part="schema"');
    expect(markup.match(/data-entity-part="table"/g)).toHaveLength(2);
    expect(tokens).toContain('--ast-table-ref-text: #6f5312');
    expect(tokens).toContain('--ast-table-ref-fill: #f3e6bd');
    expect(answerCss).toMatch(/\.entity-table\s*\{[^}]*color: var\(--ast-entity-table-fg\)/s);
    expect(answerCss).toMatch(/\.entity-column\s*\{[^}]*color: var\(--ast-entity-column-fg\)/s);
  });

  it('keeps linked table references visibly linked inside the yellow family', () => {
    expect(answerCss).toMatch(
      /\.entity-table-link\s*\{[^}]*color: var\(--ast-entity-table-fg\)[^}]*text-decoration-color: var\(--ast-table-ref-border\)/s
    );
    expect(answerCss).toMatch(/\.entity-table-link:hover\s*\{[^}]*text-decoration-color: currentColor/s);
  });

  it('keeps inline table highlighting inside a sanitized SQL detail', () => {
    const sql = `SELECT title_name FROM ${TABLE} WHERE title_name IS NOT NULL`;
    const markup = renderToStaticMarkup(<PayloadView text={JSON.stringify({ sql })} tables={[TABLE]} />);
    expect(markup).toContain('data-entity-part="catalog"');
    expect(markup).toContain('data-entity-part="schema"');
    expect(markup).toContain('data-entity-part="table"');
  });
});

describe('shared answer-table typography', () => {
  const css = partial('answer.css');

  it('uses one readable header/body system with responsive overflow', () => {
    const markup = renderToStaticMarkup(
      <AnswerProse text={'| Title Code | Title Name |\n| --- | --- |\n| NBA2K26 | NBA 2K26 |'} sources={[]} />
    );
    expect(markup).toContain('<div class="answer-table-wrap">');
    expect(markup).toContain('<table class="answer-table">');
    expect(markup).toContain('<th scope="col"');
    expect(css).toMatch(/\.answer-table thead th\s*\{[^}]*background: var\(--ast-neutral-fill\)/s);
    expect(css).toMatch(/\.answer-table tbody td\s*\{[^}]*font-size: var\(--ast-fs-12\)/s);
    expect(css).toMatch(/\.answer-table-wrap\s*\{[^}]*overflow-x: auto/s);
  });
});

describe('raw schema fidelity', () => {
  it('keeps columns beyond the rendered cap in the explicit Raw payload', () => {
    const raw = Array.from({ length: 12 }, (_, index) => `column_${index + 1} (string)`).join('\n');
    const payload = describePayload(raw);
    const markup = renderToStaticMarkup(<RawPayload payload={payload} />);
    expect(markup).toContain('column_1 (string)');
    expect(markup).toContain('column_12 (string)');
  });
});
