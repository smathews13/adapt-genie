import { describe, expect, it } from 'vitest';

import { normalizeAnswer, type WireAnswer } from './answer-shape';
import { parseAnswerMarkdown } from './answer-markdown';
import {
  answerMarkdown,
  conversationMarkdown,
  deterministicFilename,
  exportTable,
  tableTsv,
} from './export-serializers';

const answer = normalizeAnswer({
  id: 'answer-1',
  mode: 'live',
  takeaway: 'Revenue grew.',
  narrative: '| Region | Revenue |\n| --- | ---: |\n| East | $12 |',
  content: 'Reader-facing detail.',
  sources: [{ name: 'catalog.gold.revenue', freshness: '2026-09-09', role: 'reading' }],
  caveats: ['Current quarter is incomplete.'],
  document_snippets: [{ filename: 'private.txt', quote: 'hidden attachment text', supports: 'internal' }],
  trace: {
    id: 'tr-12345678',
    totalMs: 100,
    toolCalls: 1,
    stages: [{ id: 'sql', name: 'internal diagnostic', status: 'complete', input: 'secret', output: 'trace output' }],
  },
  sql: 'select * from private_internal_table',
} as WireAnswer);

describe('reader-facing export serializers', () => {
  it('exports the visible question, answer, caveats and sources without diagnostics', () => {
    const markdown = answerMarkdown('How did revenue change?', answer);
    expect(markdown).toContain('How did revenue change?');
    expect(markdown).toContain('Revenue grew.');
    expect(markdown).toContain('| Region | Revenue |');
    expect(markdown).toContain('catalog.gold.revenue');
    expect(markdown).toContain('Current quarter is incomplete.');
    for (const hidden of ['hidden attachment text', 'internal diagnostic', 'trace output', 'private_internal_table']) {
      expect(markdown).not.toContain(hidden);
    }
  });

  it('builds a chronological conversation from user, text and normalized answer turns', () => {
    const markdown = conversationMarkdown('Quarter review', [
      { role: 'user', content: 'How did revenue change?' },
      { role: 'assistant', content: 'I need one detail.' },
      { role: 'user', content: 'Use the current quarter.' },
      { role: 'assistant', answer: { ...answer, takeaway: 'East led.' } },
    ]);
    expect(markdown).toMatch(/^# Quarter review/);
    expect(markdown.match(/## User/g)).toHaveLength(2);
    expect(markdown.match(/## ADAPT/g)).toHaveLength(2);
    expect(markdown.indexOf('How did revenue')).toBeLessThan(markdown.indexOf('I need one detail'));
    expect(markdown.indexOf('I need one detail')).toBeLessThan(markdown.indexOf('Use the current quarter'));
    expect(markdown).toContain('East led.');
  });

  it('serializes parsed tables with headers and source attribution', () => {
    const block = parseAnswerMarkdown(answer.narrative).find((entry) => entry.kind === 'table');
    if (!block || block.kind !== 'table') throw new Error('Expected a parsed table');
    const table = exportTable(block, answer.sources);
    expect(tableTsv(table)).toBe('# Source: catalog.gold.revenue\nRegion\tRevenue\nEast\t$12');
  });

  it('creates stable filesystem-safe names', () => {
    expect(deterministicFilename(' Q3 / Revenue: East ', '.pdf')).toBe('adapt-q3-revenue-east.pdf');
    expect(deterministicFilename(' Q3 / Revenue: East ', '.pdf')).toBe(
      deterministicFilename(' Q3 / Revenue: East ', '.pdf')
    );
  });
});
