import { describe, expect, it } from 'vitest';
import { markdownToMrkdwn, splitMrkdwn } from './slack-mrkdwn';

describe('markdownToMrkdwn', () => {
  it('renders the bullets and bold labels Slack showed as raw Markdown', () => {
    const out = markdownToMrkdwn(
      '- **Scope:** All 5 tables live in `sample_catalog.sample_schema`.\n- **Visibility:** `pub_steam_visibility` -- daily impressions'
    );
    expect(out).toBe(
      '• *Scope:* All 5 tables live in `sample_catalog.sample_schema`.\n• *Visibility:* `pub_steam_visibility` -- daily impressions'
    );
    expect(out).not.toContain('**');
  });

  it('converts headings, italics, strikethrough, links, quotes and nested lists', () => {
    const out = markdownToMrkdwn(
      '## Wishlist trend\nUp *sharply* and ~~flat~~ [see docs](https://example.com/a?b=1&c=2)\n> note\n  - child\n1. first'
    );
    expect(out.split('\n')).toEqual([
      '*Wishlist trend*',
      'Up _sharply_ and ~flat~ <https://example.com/a?b=1&c=2|see docs>',
      '>note',
      '    ◦ child',
      '1. first',
    ]);
  });

  it('leaves code untouched and escapes Slack control characters', () => {
    const out = markdownToMrkdwn('Use `a**b**c` when x < 5 & y > 2\n```\nSELECT * FROM t WHERE a < 1\n```');
    expect(out).toBe('Use `a**b**c` when x &lt; 5 &amp; y &gt; 2\n```\nSELECT * FROM t WHERE a &lt; 1\n```');
  });

  it('turns a pipe table into an aligned monospace block', () => {
    const out = markdownToMrkdwn('| Country | Wishlists |\n|---|---:|\n| US | **1,200** |\n| Japan | 300 |');
    expect(out).toBe('```\nCountry  Wishlists\nUS       1,200\nJapan    300\n```');
  });

  it('refuses non-web link targets', () => {
    expect(markdownToMrkdwn('[x](javascript:alert(1))')).not.toContain('<javascript');
  });
});

describe('splitMrkdwn', () => {
  it('splits at paragraph breaks and keeps each piece under the limit', () => {
    const paragraph = 'word '.repeat(50).trim();
    const chunks = splitMrkdwn([paragraph, paragraph, paragraph].join('\n\n'), 600);
    expect(chunks).toHaveLength(2);
    expect(chunks.every((chunk) => chunk.length <= 600)).toBe(true);
    expect(chunks.join('\n\n')).toBe([paragraph, paragraph, paragraph].join('\n\n'));
  });
});
