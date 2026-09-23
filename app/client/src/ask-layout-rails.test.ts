import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { partial } from './styles/stylesheet';

/**
 * ADAPT Ask-tab rails: conversations on the left, business insights on the
 * right, and the answer card centred between them.
 */

const RAIL = withoutComments(partial('rail.css'));
const INSIGHTS = withoutComments(partial('insight-rail.css'));
const ASK = withoutComments(partial('ask.css'));
const COMPOSER = withoutComments(partial('composer.css'));
const QUESTION = withoutComments(readFileSync(new URL('styles/question-attribution.css', import.meta.url), 'utf8'));
const TOKENS = withoutComments(partial('tokens.css'));
const HOME = readFileSync(new URL('HomePage.tsx', import.meta.url), 'utf8');

function withoutComments(css: string) {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

describe('idle Ask keeps ADAPT business context instead of an agent map', () => {
  it('keeps the insights rail and excludes constellation artwork', () => {
    expect(HOME).toContain('className="trace-inspector insight-rail"');
    expect(HOME).toContain('aria-label="Insights"');
    expect(HOME).not.toContain('AgentPathConstellation');
    expect(HOME).not.toContain('ConstellationField');
    expect(HOME).not.toContain('trace-idle-sky');
  });
});

describe('the two rails share one width and the card sits in the middle', () => {
  it('keeps stable conversation and insight rail widths', () => {
    expect(TOKENS).toMatch(/--conversation-width:\s*290px/);
    expect(TOKENS).toMatch(/--trace-width:\s*320px/);
    expect(RAIL).toMatch(/--trace-width:\s*320px/);
    expect(RAIL).toMatch(/--conversation-expanded-width:\s*290px/);
    expect(RAIL).toMatch(/--conversation-width:\s*var\(--conversation-expanded-width\)/);
    expect(HOME).toContain('className="trace-inspector insight-rail"');
  });

  it('uses PIA panel icons to collapse both rails without removing their boundaries', () => {
    expect(HOME).not.toContain('railHidden');
    expect(HOME).toContain('PanelLeftClose');
    expect(HOME).toContain('PanelLeftOpen');
    expect(HOME).toContain('PanelRightClose');
    expect(HOME).toContain('PanelRightOpen');
    expect(HOME).toContain('aria-label="Hide conversation history"');
    expect(HOME).toContain('aria-label="Show conversation history"');
    expect(HOME).toContain('aria-label="Hide insights"');
    expect(HOME).toContain('aria-label="Show insights"');
    expect(HOME).toContain("data-rail-collapsed={railCollapsed ? 'true' : 'false'}");
    expect(HOME).toContain("data-inspector-collapsed={inspectorCollapsed ? 'true' : 'false'}");
    expect(INSIGHTS).not.toContain('.ask-layout.rail-hidden');
    expect(INSIGHTS).toMatch(/\.trace-inspector\.insight-rail\s*\{[^}]*border-left:\s*1px solid/);
    expect(RAIL).toMatch(
      /\.ask-layout\[data-rail-collapsed='true'\]\s*\{[^}]*--conversation-width:\s*var\(--ask-pane-collapsed-width\)/
    );
    expect(RAIL).toMatch(
      /\.ask-layout\[data-inspector-collapsed='true'\]\s*\{[^}]*grid-template-columns:[^}]*var\(--ask-pane-collapsed-width\)/
    );
  });

  it('centres the answer and working cards in the leftover track', () => {
    expect(ASK).toMatch(/\.conversation-main\s*\{[^}]*max-width:\s*none/);
    expect(ASK).toMatch(
      /\.conversation-main \.answer-card,\s*\.conversation-main \.plan-card\s*\{[^}]*max-width:\s*var\(--conversation-measure\)[^}]*margin-inline:\s*auto/
    );
  });

  it('insets cards from the rails and caps the composer independently', () => {
    // Cards retain their 8px side inset. The composer keeps that responsive
    // width rule but stops at 640px, leaving a materially narrower prompt bar.
    expect(ASK).toMatch(
      /\.conversation-main \.answer-card,\s*\.conversation-main \.plan-card\s*\{[^}]*width:\s*calc\(100% - 16px\)/
    );
    expect(COMPOSER).toMatch(
      /\.composer\s*\{[^}]*width:\s*calc\(100% - 16px\)[^}]*max-width:\s*min\(640px,\s*var\(--conversation-measure\)\)/
    );
  });

  it('keeps the organization-marked owner badge compact, not a full-width slab', () => {
    expect(RAIL).toMatch(/\.conversation-owner\s*\{[^}]*max-width:\s*132px/);
    expect(RAIL).not.toMatch(/\.conversation-owner\s*\{[^}]*width:\s*100%/);
    expect(RAIL).not.toMatch(/\.conversation-owner\s*\{[^}]*flex:\s*1/);
    expect(RAIL).not.toMatch(
      /\.conversation-rail \.conversation-owner \.identity-chip-text\s*\{[^}]*white-space:\s*normal/
    );
  });
});

describe('Insights content', () => {
  it('links governed tables and keeps confidence last', () => {
    expect(HOME).toContain('<VisitInDatabricks name={table.name} className="insight-table-link">');
    expect(HOME).toContain("table.display.split('.').at(-1)");
    expect(HOME).toContain('<Link className="insight-connections-link" to="/connections">');
    expect(INSIGHTS).toMatch(
      /\.insight-table \.insight-table-link,\s*\.insight-table-link\s*\{[^}]*display:\s*inline-flex[^}]*flex-flow:\s*row nowrap[^}]*white-space:\s*nowrap/
    );
    expect(INSIGHTS).toMatch(
      /\.insight-table \.insight-table-link svg,\s*\.insight-table-link svg\s*\{[^}]*flex:\s*none/
    );
    expect(HOME.indexOf('Saved queries')).toBeLessThan(HOME.indexOf('Answer confidence'));
    expect(HOME.indexOf('Watchlist</p>')).toBeLessThan(HOME.indexOf('Answer confidence'));
  });
});

describe('the question is anchored above its answer', () => {
  it('uses normal-flow spacing below the chrome', () => {
    expect(ASK).toMatch(
      /\.ask-layout\[data-transcript='active'\] \.conversation-main\s*\{[^}]*padding-top:\s*var\(--density-page-gap\)/
    );
    expect(ASK).toMatch(/\.user-message\s*\{[^}]*margin-bottom:\s*22px/);
    expect(ASK).not.toMatch(/\.user-message\s*\{[^}]*margin-top:\s*-/);
  });

  it('integrates the question and organization badge in one tailed surface', () => {
    expect(QUESTION).toMatch(/\.question-attribution-surface\s*\{[^}]*border:\s*1px solid var\(--ast-border-input\)/);
    expect(QUESTION).toMatch(/\.question-attribution-surface::after\s*\{[^}]*right:\s*22px[^}]*bottom:\s*-5px/);
  });
});
