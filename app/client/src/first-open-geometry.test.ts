import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(new URL('./styles/first-open.css', import.meta.url), 'utf8');
const RESPONSIVE = readFileSync(new URL('./styles/responsive.css', import.meta.url), 'utf8');

function rule(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  return start < 0 ? '' : source.slice(start, source.indexOf('}', start));
}

describe('the ADAPT first-open card', () => {
  it('keeps an over-tall card reachable', () => {
    expect(rule(CSS, '.first-open')).toContain('overflow-y: auto');
    expect(rule(CSS, '.first-open')).toContain('align-items: flex-start');
    expect(rule(CSS, '.first-open-card')).toContain('overflow-y: auto');
    expect(rule(CSS, '.first-open-card')).toContain('max-width: 100%');
  });

  it('keeps scope rows responsive without requiring an obsolete breakpoint value', () => {
    expect(RESPONSIVE).toMatch(/\.fo-scope-list\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    expect(RESPONSIVE).toMatch(/\.fo-scope-row:nth-child\(even\)\s*\{[^}]*border-left:\s*none/s);
  });

  it('does not add constellation or opening-canvas geometry', () => {
    expect(CSS).not.toMatch(/constellation|ast-opening-sky/);
  });
});
