import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { partial } from './styles/stylesheet';

const clean = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, ' ');
const TOKENS = clean(partial('tokens.css'));
const ADAPT = clean(partial('astrolabe-tokens.css'));
const BASE = clean(partial('base.css'));
const SHELL = clean(partial('shell.css'));
const MARK = clean(partial('astrolabe-mark.css'));
const RAIL = clean(partial('rail.css'));
const ASK = clean(partial('ask.css'));
const COMPOSER = clean(partial('composer.css'));
const ACCOUNT = clean(partial('account-menu.css'));
const RESPONSIVE = clean(partial('responsive.css'));
const LOADING = clean(partial('adapt-loading.css'));
const MARKUP = readFileSync(new URL('./AstrolabeMark.tsx', import.meta.url), 'utf8');

function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

describe('ADAPT shared geometry', () => {
  it('pins the delivered type, radius, chrome, and Ask geometry', () => {
    for (const [token, value] of [
      ['--ast-type-hero', '40px'],
      ['--ast-type-page', '30px'],
      ['--ast-type-section', '22px'],
      ['--ast-type-card', '17px'],
      ['--ast-type-body', '15px'],
      ['--ast-type-control', '14px'],
      ['--ast-type-meta', '13px'],
      ['--ast-type-eyebrow', '11px'],
      ['--ast-radius-card', '10px'],
      ['--ast-radius-control', '8px'],
      ['--ast-radius-pill', '6px'],
    ]) {
      expect(ADAPT).toMatch(new RegExp(`${token}:\\s*${value}`));
    }
    expect(TOKENS).toMatch(/--app-header-content-h:\s*56px/);
    expect(TOKENS).toMatch(/--app-header-pad-x:\s*16px/);
    expect(TOKENS).toMatch(/--conversation-width:\s*290px/);
    expect(TOKENS).toMatch(/--trace-width:\s*320px/);
    expect(rule(RAIL, '.ask-layout')).toMatch(
      /--trace-width:\s*320px[\s\S]*--conversation-expanded-width:\s*290px[\s\S]*grid-template-columns:\s*var\(--conversation-width\) minmax\(0, 1fr\) var\(--trace-width\)/
    );
  });

  it('collapses shared chrome and the right Ask rail at 1240px', () => {
    expect(RESPONSIVE).toMatch(/@media \(max-width:\s*1240px\)[\s\S]*\.app-nav\s*\{[^}]*display:\s*none/);
    expect(RESPONSIVE).toMatch(/@media \(max-width:\s*1240px\)[\s\S]*\.trace-inspector\s*\{[^}]*display:\s*none/);
  });
});

describe('ADAPT shared recipes', () => {
  it('draws raised 56px chrome with a reserved tab underline', () => {
    const header = rule(SHELL, '.app-header');
    expect(header).toContain('height: var(--app-header-h)');
    expect(header).toContain('border-bottom: 1px solid var(--ast-hairline)');
    expect(header).toContain('background-color: var(--ast-surface-chrome)');
    expect(header).toContain('box-shadow: var(--ast-shadow-chrome)');
    expect(rule(SHELL, '.app-nav-tab')).toContain('border-bottom: 2px solid transparent');
    expect(rule(SHELL, ".app-nav-tab[aria-current='page']")).toContain('border-bottom-color: var(--primary)');
  });

  it('seats the delivered peak in the header at 19 by 21', () => {
    expect(MARKUP).toContain('<span className="adapt-peak-lockup-mark" aria-hidden="true" />');
    const peak = rule(MARK, '.adapt-peak-lockup-mark');
    expect(peak).toContain('width: 19px');
    expect(peak).toContain('height: 21px');
    expect(peak).toContain('background-image: var(--brand-mark)');
    expect(RESPONSIVE).toMatch(
      /@media \(max-width:\s*480px\)[\s\S]*\.adapt-peak-lockup-mark\s*\{[^}]*background-image:\s*var\(--brand-mark-sm\)/
    );
  });

  it('keeps cards flat, controls filled or outlined, and disabled controls opaque', () => {
    expect(rule(BASE, "[data-slot='card']")).toMatch(
      /border-radius:\s*var\(--ast-radius-card\)[\s\S]*background:\s*var\(--ast-surface\)[\s\S]*box-shadow:\s*var\(--ast-shadow-flat\)/
    );
    expect(rule(BASE, "[data-slot='button'][data-variant='primary']")).toContain('background: var(--ast-action)');
    expect(rule(BASE, "[data-slot='button'][data-variant='secondary']")).toContain('background: var(--ast-surface)');
    expect(rule(BASE, "[data-slot='button'][data-variant='danger']")).toContain('background: var(--ast-danger-fill)');
    expect(BASE).toMatch(
      /\[data-slot='button'\]:disabled,\s*\[data-slot='button'\]\[data-disabled\]\s*\{[^}]*opacity:\s*1/
    );
  });

  it('uses one visible focus recipe including cards, rows, tabs, and composer', () => {
    expect(rule(BASE, ':focus-visible')).toMatch(
      /outline:\s*2px solid var\(--ast-action\)[\s\S]*outline-offset:\s*2px/
    );
    expect(rule(COMPOSER, '.composer:focus-within')).toMatch(
      /outline:\s*2px solid var\(--ast-action\)[\s\S]*outline-offset:\s*2px/
    );
    expect(rule(ASK, '.ask-starter:focus-visible')).not.toContain('outline: none');
    expect(rule(RAIL, '.conversation-item')).not.toContain('outline: none');
    expect(rule(SHELL, '.app-nav-tab:focus-visible')).not.toContain('outline: none');
  });

  it('gives every status family a 6px pill and keeps role labels at 999', () => {
    expect(rule(ADAPT, '.ast-pill')).toContain('border-radius: var(--ast-radius-pill)');
    for (const family of ['pos', 'warn', 'neg', 'neutral', 'info', 'provenance']) {
      expect(ADAPT).toContain(`.ast-pill--${family}`);
    }
    expect(rule(SHELL, '.role-badge')).toContain('border-radius: 999px');
  });

  it('uses blue selected segments with white labels', () => {
    const selected = rule(BASE, "[data-slot='tabs-trigger'][data-state='active']");
    expect(selected).toContain('background: var(--ast-action)');
    expect(selected).toContain('color: var(--ast-action-ink-on-fill)');
  });
});

describe('Ask, account, and loading seating', () => {
  it('keeps starter cards flat and the composer opaque with a sunken footer', () => {
    expect(rule(ASK, '.ask-starter')).toContain('box-shadow: var(--ast-shadow-flat)');
    expect(rule(ASK, '.ask-starter:hover:not(:disabled),')).not.toContain('transform');
    expect(rule(ASK, '.ask-hero h2')).toContain('font-size: var(--ast-type-hero)');
    expect(rule(COMPOSER, '.composer')).toContain('background: var(--ast-surface)');
    expect(rule(COMPOSER, '.composer-actions')).toContain('background: var(--ast-surface-sunken)');
    expect(rule(COMPOSER, ".composer-actions [data-slot='button'][type='submit']")).toContain('height: 40px');
  });

  it('keeps the account overlay solid, 12px, hairlined, and focused while open', () => {
    expect(rule(ACCOUNT, '.account-menu')).toMatch(
      /border:\s*1px solid var\(--ast-hairline\)[\s\S]*border-radius:\s*var\(--ast-radius-overlay\)[\s\S]*background:\s*var\(--ast-surface-menu\)[\s\S]*box-shadow:\s*var\(--ast-shadow-overlay\)/
    );
    expect(rule(ACCOUNT, ".account-menu-trigger.identity-chip[aria-expanded='true']")).toContain(
      'outline: 2px solid var(--ast-action)'
    );
  });

  it('keeps the light loader ink, teal apex and bar, tertiary status, and timing', () => {
    expect(LOADING).toMatch(/\.adapt-loading-peak\s*\{[^}]*stroke:\s*var\(--ast-loading-peak\)/);
    expect(LOADING).toMatch(/\.adapt-loading-dot\s*\{[^}]*fill:\s*var\(--accent\)/);
    expect(LOADING).toMatch(/\.adapt-loading-bar\s*\{[^}]*stroke:\s*var\(--accent\)/);
    expect(LOADING).toMatch(/\.adapt-loading-status\s*\{[^}]*color:\s*var\(--ast-loading-status\)/);
    expect(LOADING).toContain('adapt-peak-draw 900ms');
  });
});
