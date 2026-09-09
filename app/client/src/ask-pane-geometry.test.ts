import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { partial } from './styles/stylesheet';

const HOME = readFileSync(new URL('./HomePage.tsx', import.meta.url), 'utf8');
const TOKENS = partial('tokens.css').replace(/\/\*[\s\S]*?\*\//g, ' ');
const RAIL = partial('rail.css').replace(/\/\*[\s\S]*?\*\//g, ' ');
const ASK = partial('ask.css').replace(/\/\*[\s\S]*?\*\//g, ' ');
const COMPOSER = partial('composer.css').replace(/\/\*[\s\S]*?\*\//g, ' ');
const ANSWER_BODY = partial('answer-body.css').replace(/\/\*[\s\S]*?\*\//g, ' ');
const RESPONSIVE = partial('responsive.css').replace(/\/\*[\s\S]*?\*\//g, ' ');
const RESPONSIVE_RUNS = partial('responsive-runs.css').replace(/\/\*[\s\S]*?\*\//g, ' ');
const RUNS = partial('runs.css').replace(/\/\*[\s\S]*?\*\//g, ' ');

function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

describe('Ask and Run use page-specific desktop pane geometry', () => {
  it('keeps Run Explorer on its dedicated 760–1120px reading panes', () => {
    expect(TOKENS).toMatch(
      /--workspace-pane-block-size:\s*clamp\(\s*760px,\s*calc\(100dvh - var\(--app-header-h\) \+ 160px - env\(safe-area-inset-bottom,\s*0px\)\),\s*1120px\s*\)/
    );
    expect(rule(RUNS, '.run-explorer')).toContain('--run-explorer-pane-block-size: var(--workspace-pane-block-size)');
  });

  it('keeps the active card compact while the live-step list owns scrolling', () => {
    const layout = rule(RAIL, '.ask-layout');
    expect(layout).toContain('--ask-active-card-min-block-size: min(360px, 60dvh)');
    expect(layout).toContain('--ask-active-card-max-block-size: min(520px, 60dvh)');
    const working = rule(ASK, ".ask-layout[data-center-state='working'] .conversation-main > .answer-card");
    expect(working).toContain('height: var(--ask-active-card-max-block-size)');
    expect(working).toContain('min-height: var(--ask-active-card-min-block-size)');
    expect(working).toContain('max-height: var(--ask-active-card-max-block-size)');
    expect(working).toContain('overflow: hidden');
    expect(working).not.toContain('overflow-y: auto');
    expect(
      rule(
        ASK,
        ".ask-layout[data-center-state='working'] .conversation-main > .answer-card > [data-slot='card-content']"
      )
    ).toContain('overflow: hidden');
    expect(ASK).toMatch(
      /\.ask-layout\[data-center-state='working'\] \.conversation-main > \.answer-card \.live-steps\s*\{[^}]*max-height:\s*none/
    );
    expect(ASK).toMatch(
      /\.ask-layout\[data-center-state='working'\][^{]*\.live-progress,[\s\S]*?\.live-steps\s*\{[^}]*min-height:\s*0/
    );
    expect(HOME).toContain("data-center-state={loading ? 'working'");
  });

  it('keeps the conversation rail viewport-tall with one scrolling list', () => {
    const left = rule(RAIL, '.ask-layout > .conversation-rail');
    for (const property of ['height', 'min-height', 'max-height']) {
      expect(left).toContain(`${property}: var(--ask-rail-block-size)`);
    }
    expect(left).toContain('position: sticky');
    expect(left).toContain('overflow: hidden');
    expect(rule(RAIL, '.conversation-list')).toContain('overflow-y: auto');
  });

  it('keeps the ADAPT insights rail independently scrollable', () => {
    const seated = rule(RAIL, '.ask-layout > .trace-inspector');
    for (const property of ['height', 'min-height', 'max-height']) {
      expect(seated).toContain(`${property}: var(--ask-rail-block-size)`);
    }
    expect(RAIL).toMatch(/\n\.trace-inspector\s*\{[^}]*overflow-y:\s*auto/);
    expect(RAIL).toMatch(/\n\.trace-inspector\s*\{[^}]*grid-column:\s*3/);
    expect(HOME).toContain('className="trace-inspector insight-rail"');
    expect(HOME).not.toContain('AgentPathConstellation');
  });

  it('lets final answers grow through normal page flow', () => {
    const center = rule(ASK, '.conversation-main');
    expect(center).toContain('height: auto');
    expect(center).toContain('min-height: calc(100dvh - var(--app-header-h))');
    expect(center).toContain('max-height: none');
    expect(center).toContain('overflow-y: visible');
    expect(center).not.toContain('var(--ask-active-card');
    expect(ASK).toMatch(
      /\.ask-layout\[data-center-state='final'\][\s\S]*?\.answer-card\s*\{[^}]*min-height:\s*calc\(100dvh - var\(--app-header-h\)\)[^}]*max-height:\s*none/
    );
    expect(rule(ANSWER_BODY, '.answer-card-content')).toMatch(/grid-auto-rows:\s*auto[\s\S]*overflow:\s*visible/);
  });

  it('returns Ask and Run panes to auto-height page flow on narrow screens', () => {
    expect(RESPONSIVE).toMatch(
      /@media \(max-width: 800px\)[\s\S]*?\.conversation-main\s*\{[^}]*height:\s*auto[^}]*max-height:\s*none[^}]*overflow:\s*visible/
    );
    expect(RESPONSIVE).toMatch(
      /@media \(max-width: 800px\)[\s\S]*?\.ask-layout\[data-transcript='active'\][^{]*\.answer-card\s*\{[^}]*min-height:\s*280px/
    );
    expect(RESPONSIVE_RUNS).toMatch(
      /@media \(max-width: 1180px\)[\s\S]*?\.run-list\s*\{[^}]*height:\s*auto[^}]*overflow:\s*visible/
    );
    expect(RESPONSIVE_RUNS).toMatch(
      /@media \(max-width: 1180px\)[\s\S]*?\.run-detail\s*\{[^}]*height:\s*auto[^}]*overflow:\s*visible/
    );
  });
});

describe('the Ask composer follows the answer pane in normal flow', () => {
  it('renders the scroll pane before the composer as sibling grid rows', () => {
    const column = HOME.slice(
      HOME.indexOf('className="conversation-column"'),
      HOME.indexOf('className="trace-inspector"')
    );
    expect(column).toMatch(/<section[\s\S]*?className=\{`conversation-main[\s\S]*?<\/section>\s*<form/);
    expect(column.indexOf('className={`conversation-main')).toBeLessThan(column.indexOf('className="composer"'));
    expect(rule(RAIL, '.conversation-column')).toMatch(/grid-template-rows:\s*auto auto/);
  });

  it('keeps a deliberate positive gap and no second dead-space reserve', () => {
    expect(rule(RAIL, '.conversation-column')).toMatch(/gap:\s*12px/);
    expect(ASK).not.toContain('--composer-reserve');
    expect(COMPOSER).not.toContain('--composer-reserve');
  });

  it('cannot overlay short answers, tall answers, or an active timeline', () => {
    const composer = rule(COMPOSER, '.composer');
    expect(composer).toMatch(/position:\s*static/);
    expect(composer).not.toMatch(/\b(?:top|right|bottom|left|z-index|transform):/);
    expect(composer).not.toMatch(/margin-(?:top|block-start):\s*-/);
    expect(HOME).toContain('if (loading) void stopCurrentAsk()');
    expect(HOME).toContain("'Stop'");
  });
});
