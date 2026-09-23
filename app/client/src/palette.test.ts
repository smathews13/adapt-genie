import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const TOKENS = readFileSync(new URL('./styles/astrolabe-tokens.css', import.meta.url), 'utf8');
const APPKIT = readFileSync(new URL('./styles/tokens.css', import.meta.url), 'utf8');
const LOADING = readFileSync(new URL('./styles/adapt-loading.css', import.meta.url), 'utf8');
const CONSTELLATION = readFileSync(new URL('./styles/constellation.css', import.meta.url), 'utf8');
const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ADAPT_MARK = readFileSync(new URL('./assets/logo/adapt-peak.svg', import.meta.url), 'utf8');
const ADAPT_MARK_SMALL = readFileSync(new URL('./assets/logo/adapt-peak-sm.svg', import.meta.url), 'utf8');
const ADAPT_MARK_DARK = readFileSync(new URL('./assets/logo/adapt-peak-dark.svg', import.meta.url), 'utf8');
const ADAPT_MARK_SMALL_DARK = readFileSync(new URL('./assets/logo/adapt-peak-sm-dark.svg', import.meta.url), 'utf8');
const DARK_TOKENS = TOKENS.slice(
  TOKENS.indexOf("html[data-theme='dark']"),
  TOKENS.indexOf('/*\n * ---- Light mode', TOKENS.indexOf("html[data-theme='dark']"))
);

function declaration(source: string, name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`, 'i').exec(source);
  expect(match, name).not.toBeNull();
  return match?.[1].trim().toLowerCase() ?? '';
}

function contrast(first: string, second: string): number {
  const luminance = (hex: string) => {
    const linear = [1, 3, 5].map((offset) => {
      const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const [bright, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (bright + 0.05) / (dark + 0.05);
}

describe('the canonical ADAPT light palette', () => {
  it('pins the exact spec grounds, ink, action, borders, elevation, stars, and charts', () => {
    const expected = {
      '--ast-canvas': '#f4f7f9',
      '--ast-surface': '#ffffff',
      '--ast-surface-sunken': '#f0f4f7',
      '--ast-surface-raised': '#ffffff',
      '--ast-surface-selected': '#edf3f9',
      '--ast-scrim': 'rgba(23, 34, 44, 0.45)',
      '--ast-ink': '#0e1720',
      '--ast-ink-secondary': '#4c5c68',
      '--ast-ink-tertiary': '#64737f',
      '--ast-ink-disabled': '#9aa7b2',
      '--ast-action': '#1a62a8',
      '--ast-action-hover': '#14507f',
      '--ast-action-ink-on-fill': '#ffffff',
      '--ast-action-tint': '#e8f1fa',
      '--ast-action-edge': '#bbd6f0',
      '--ast-focus-halo': 'rgba(26, 98, 168, 0.28)',
      '--ast-positive-text': '#0f6257',
      '--ast-positive-border': '#a8d5cd',
      '--ast-positive-fill': '#eaf6f3',
      '--ast-warning-text': '#8a5a00',
      '--ast-warning-border': '#e6ce9a',
      '--ast-warning-fill': '#fdf6e8',
      '--ast-negative-text': '#a21f35',
      '--ast-negative-border': '#edbfc8',
      '--ast-negative-fill': '#fcf1f3',
      '--ast-neutral-text': '#4c5c68',
      '--ast-neutral-border': '#dce3e9',
      '--ast-neutral-fill': '#f2f5f8',
      '--ast-info-text': '#1a5b8f',
      '--ast-info-border': '#bbd6f0',
      '--ast-info-fill': '#e8f1fa',
      '--ast-provenance-text': '#7a5a11',
      '--ast-provenance-border': '#e4d3a6',
      '--ast-provenance-fill': '#fbf5e6',
      '--ast-danger-fill': '#c2263f',
      '--ast-danger-hover': '#a61e34',
      '--ast-danger-ink': '#ffffff',
      '--ast-hairline': '#e2e8ed',
      '--ast-hairline-strong': '#cfd9e0',
      '--ast-border-input': '#c9d3db',
      '--ast-border-dashed': '#b8c6d1',
      '--ast-shadow-flat': 'none',
      '--ast-shadow-chrome': '0 1px 2px rgba(14, 23, 32, 0.06)',
      '--ast-shadow-overlay': '0 16px 40px rgba(14, 23, 32, 0.18)',
      '--ast-star': '#c3d0da',
      '--ast-constellation-line': '#dde5eb',
      '--ast-chart-1': '#1a62a8',
      '--ast-chart-2': '#0f6257',
      '--ast-chart-3': '#8a5a00',
      '--ast-chart-track': '#e7ecf0',
      '--ast-chart-grid': '#edf1f4',
    } as const;
    for (const [name, value] of Object.entries(expected)) expect(declaration(TOKENS, name)).toBe(value);
  });

  it('contains all six complete status families', () => {
    for (const family of ['positive', 'warning', 'negative', 'neutral', 'info', 'provenance']) {
      for (const slot of ['text', 'border', 'fill']) expect(TOKENS).toContain(`--ast-${family}-${slot}:`);
    }
  });

  it('keeps reading, menu, and chrome surfaces opaque in both themes', () => {
    expect(declaration(APPKIT, '--background')).toBe('var(--ast-canvas)');
    expect(declaration(APPKIT, '--card')).toBe('var(--ast-surface)');
    expect(declaration(APPKIT, '--popover')).toBe('var(--ast-surface-raised)');
    expect(declaration(TOKENS, '--ast-surface-primary')).toBe('var(--ast-surface)');
    expect(TOKENS).toMatch(/html\[data-theme='dark'\][^{]*\{[\s\S]*--ast-surface-primary:\s*var\(--ast-surface\)/);
    expect(TOKENS).toMatch(/html\[data-theme='dark'\][^{]*\{[\s\S]*--ast-pane:\s*var\(--ast-surface\)/);
  });

  it('pins dark canonical values and keeps legacy names as aliases', () => {
    expect(declaration(DARK_TOKENS, '--ast-canvas')).toBe('#0b1014');
    expect(declaration(DARK_TOKENS, '--ast-surface')).toBe('#101820');
    expect(declaration(DARK_TOKENS, '--ast-action')).toBe('#8fc1e8');
    expect(declaration(DARK_TOKENS, '--ast-action-ink-on-fill')).toBe('#0e1720');
    expect(declaration(DARK_TOKENS, '--ast-chart-1')).toBe('#8fc1e8');
    expect(declaration(DARK_TOKENS, '--ast-chart-2')).toBe('#04867d');
    expect(declaration(DARK_TOKENS, '--ast-chart-3')).toBe('#6faedd');
    for (const [legacy, canonical] of [
      ['--ast-blue', '--ast-action'],
      ['--ast-pos-text', '--ast-positive-text'],
      ['--ast-neg-text', '--ast-negative-text'],
      ['--ast-warn-text', '--ast-warning-text'],
      ['--ast-table-ref-text', '--ast-provenance-text'],
    ]) {
      expect(declaration(DARK_TOKENS, legacy)).toBe(`var(${canonical})`);
    }
  });

  it('keeps small text and filled actions above WCAG AA contrast', () => {
    const tertiary = declaration(TOKENS, '--ast-ink-tertiary');
    expect(contrast(tertiary, declaration(TOKENS, '--ast-surface'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tertiary, declaration(TOKENS, '--ast-canvas'))).toBeGreaterThanOrEqual(4.5);

    const actionInk = declaration(DARK_TOKENS, '--ast-action-ink-on-fill');
    expect(contrast(actionInk, declaration(DARK_TOKENS, '--ast-action'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(actionInk, declaration(DARK_TOKENS, '--ast-action-hover'))).toBeGreaterThanOrEqual(4.5);
  });

  it('uses blue for UI action and confines teal to the ADAPT mark', () => {
    expect(declaration(TOKENS, '--ast-action')).toBe('#1a62a8');
    expect(declaration(TOKENS, '--ast-brand-teal')).toBe('#3ec6b4');
    expect(LOADING).toMatch(/--accent:\s*var\(--ast-brand-teal\)/);
    expect(LOADING).toMatch(/stroke:\s*var\(--ast-loading-peak\)/);
    expect(LOADING).toMatch(/color:\s*var\(--ast-loading-status\)/);
  });

  it('brands the document and maps the retired constellation paint without remounting it', () => {
    expect(INDEX).toMatch(/<html[^>]*data-brand="adapt"/);
    for (const name of ['--brand-mark', '--brand-mark-sm', '--brand-name', '--brand-qualifier']) {
      expect(TOKENS).toContain(`${name}:`);
    }
    expect(ADAPT_MARK).toContain('d="M 15 100 L 50 13 L 85 100"');
    expect(ADAPT_MARK_SMALL).toContain('d="M3.5 20 10 3.5 16.5 20"');
    expect(ADAPT_MARK_DARK).toContain('stroke="#F2F6FA"');
    expect(ADAPT_MARK_SMALL_DARK).toContain('stroke="#F2F6FA"');
    expect(declaration(DARK_TOKENS, '--brand-mark')).toContain('adapt-peak-dark.svg');
    expect(declaration(DARK_TOKENS, '--brand-mark-sm')).toContain('adapt-peak-sm-dark.svg');
    expect(CONSTELLATION).toMatch(/\.ast-links\s*\{[^}]*stroke:\s*var\(--ast-constellation-line\)/s);
    expect(CONSTELLATION).toMatch(/\.ast-star-decision\s*\{[^}]*fill:\s*var\(--ast-star\)/s);
  });
});
