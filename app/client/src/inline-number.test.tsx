import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AnswerProse } from './DataEntityLinks';
import { INLINE_NUMBER } from './inline-number';
import { partial } from './styles/stylesheet';

function figures(text: string): string[] {
  return [...text.matchAll(INLINE_NUMBER)].map((match) => match[0]);
}

describe('inline figures in answer prose', () => {
  it('leaves digits inside a name alone', () => {
    expect(figures('NBA 2K25 outsold PS5 bundles in Q3 during COVID-19')).toEqual([]);
  });

  it('never marks part of a decimal or grouped figure joined to a unit', () => {
    expect(figures('margin up 1.5pp, 3.2GB of data, took 2.5s, 1,204pts')).toEqual([]);
  });

  it('still marks standalone figures, signs, currency, dates, and magnitudes', () => {
    expect(figures('Revenue rose 12.5% to $1.2M (-3 vs 2025-09-30), 10-20 players, 3x lift')).toEqual([
      '12.5%',
      '$1.2M',
      '-3',
      '2025-09-30',
      '10',
      '20',
      '3x',
    ]);
  });

  it('marks a prose numeral without making it bold', () => {
    const markup = renderToStaticMarkup(
      <AnswerProse text="NBA 2K25 had 1,204 players; **42%** were new." sources={[]} />
    );
    expect(markup).toContain('NBA 2K25 had ');
    expect(markup).not.toMatch(/answer-inline-number[^>]*>2/);
    expect(markup).toContain('<span class="answer-inline-number ast-num">1,204</span>');
    expect(markup).toMatch(/<strong[^>]*>.*42%.*<\/strong>/);
    expect(partial('answer.css')).toMatch(/\.answer-inline-number\s*\{\s*font-weight: inherit;\s*\}/);
  });
});
