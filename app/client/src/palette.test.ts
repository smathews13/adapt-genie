import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const TOKENS = readFileSync(new URL('./styles/astrolabe-tokens.css', import.meta.url), 'utf8');
const LOADING = readFileSync(new URL('./styles/adapt-loading.css', import.meta.url), 'utf8');

describe('the ADAPT palette', () => {
  it('uses teal for branded actions and activity', () => {
    expect(TOKENS).toMatch(/--ast-blue:\s*#0d7168/);
    expect(TOKENS).toMatch(/--ast-blue-on-dark:\s*#58d9cc/);
    expect(TOKENS).toMatch(/--ast-info-text:\s*#094f48/);
    expect(LOADING).toMatch(/--accent:\s*#3ec6b4/);
  });

  it('keeps the startup surface dark and the ADAPT mark legible', () => {
    expect(LOADING).toMatch(/\.startup-surface\s*\{[^}]*background:\s*#131722/s);
    expect(LOADING).toMatch(/\.adapt-loading-peak\s*\{[^}]*stroke:\s*#fff/s);
  });

  it('does not restore the retired blue brand values', () => {
    for (const retired of ['#2272b4', '#6faedd', '#0e538b']) {
      expect(TOKENS.toLowerCase()).not.toContain(retired);
    }
  });
});
