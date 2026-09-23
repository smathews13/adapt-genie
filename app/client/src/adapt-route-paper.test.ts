import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./styles/${name}`, import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('ADAPT route paper system', () => {
  it('keeps Monitoring opaque, tabular, and sticky', () => {
    const css = source('monitoring.css');
    expect(css).toMatch(/\.monitoring-tile\s*\{[^}]*border:\s*1px solid var\(--ast-hairline\)/s);
    expect(css).toMatch(/\.monitoring-tile\s*\{[^}]*background:\s*var\(--ast-surface\)/s);
    expect(css).toMatch(
      /\.monitoring-table th\s*\{[^}]*position:\s*sticky[^}]*background:\s*var\(--ast-surface-sunken\)[^}]*box-shadow:\s*var\(--ast-shadow-chrome\)/s
    );
    expect(css).toMatch(/\.monitoring-row:hover,[^{]+?\{[^}]*background:\s*var\(--ast-surface-sunken\)/s);
    expect(css).toMatch(/\.monitoring-outcome-value-zero\s*\{[^}]*color:\s*var\(--ast-ink-tertiary\)/s);
    expect(css).toMatch(/\.monitoring-token-total\s*\{[^}]*text-align:\s*right[^}]*font-family:\s*var\(--font-mono\)/s);
    expect(source('dark-monitoring.css')).toContain("html[data-theme='dark'] .monitoring-tile");
  });

  it('keeps Ops paper surfaces and chart recipes semantic', () => {
    const css = source('ops.css');
    expect(css).toMatch(/\.ops-tile\s*\{[^}]*background:\s*var\(--ast-surface\)/s);
    expect(css).toMatch(/\.ops-bar-track\s*\{[^}]*background:\s*var\(--ast-chart-track\)/s);
    expect(css).toMatch(/\.ops-bar-fill\s*\{[^}]*background:\s*var\(--ast-chart-1\)/s);
    expect(css).toMatch(/\.ops-statistic-positive \.ops-bar-fill\s*\{[^}]*var\(--ast-chart-2\)/s);
    expect(css).toMatch(/\.ops-statistic-warning \.ops-bar-fill\s*\{[^}]*var\(--ast-chart-3\)/s);
    expect(css).toMatch(
      /\.ops-stop-all\s*\{[^}]*border-color:\s*var\(--ast-neg-border\)[^}]*background:\s*var\(--ast-neg-fill\)/s
    );
    expect(css).toContain('.ops-latency-trend-filter:focus-visible');
    expect(source('dark-ops.css')).toContain("html[data-theme='dark'] .ops-lat-bar-track");
  });

  it('keeps Connections opaque with selected edges and mono provenance', () => {
    const css = source('connections.css');
    expect(css).toMatch(/\.connection-rows\s*\{[^}]*background:\s*var\(--ast-surface\)/s);
    expect(css).toMatch(/\.connection-tile\s*\{[^}]*background:\s*var\(--ast-surface\)/s);
    expect(css).toMatch(
      /\.connections-table tr\[data-highlighted='true'\]\s*\{[^}]*background:\s*var\(--ast-surface-selected\)[^}]*inset 3px 0 0 var\(--ast-blue\)/s
    );
    expect(css).toMatch(/\.declared-connection-id\s*\{[^}]*font-family:\s*var\(--font-mono\)/s);
    expect(css).toMatch(/\.connection-group-title\[data-tone='blocked'\]\s*\{[^}]*var\(--ast-neg-text\)/s);
    expect(css).toMatch(/\.connection-group-title\[data-tone='drifted'\]\s*\{[^}]*var\(--ast-warn-deep\)/s);
    expect(css).toContain('.connection-row-summary:focus-visible');
  });

  it('pins Settings modal geometry and opaque chrome', () => {
    const css = source('settings.css');
    expect(css).toMatch(/\.settings-overlay\s*\{[^}]*background:\s*var\(--ast-scrim\)/s);
    expect(css).toMatch(
      /\.settings-page\.settings-modal\s*\{[^}]*border-radius:\s*14px[^}]*background:\s*var\(--ast-surface\)[^}]*box-shadow:\s*var\(--ast-shadow-overlay\)/s
    );
    expect(css).toMatch(/\.settings-modal-body\s*\{[^}]*grid-template-columns:\s*230px minmax\(0, 1fr\)/s);
    expect(css).toMatch(/\.settings-rail\s*\{[^}]*background:\s*var\(--ast-surface-sunken\)/s);
    expect(css).toMatch(/\.settings-rail button\.active\s*\{[^}]*background:\s*var\(--ast-surface-selected\)/s);
    expect(css).toMatch(/\.settings-modal-footer\s*\{[^}]*background:\s*var\(--ast-surface-raised\)/s);
    expect(css).toContain('.settings-rail button:focus-visible');
    expect(source('dark-settings.css')).toContain("html[data-theme='dark'] .settings-page.settings-modal");
  });

  it('keeps explorer, trace, architecture, and benchmark on token recipes', () => {
    const runs = source('runs.css');
    const timeline = source('timeline.css');
    const architecture = source('architecture.css');
    const benchmark = source('benchmark.css');
    expect(runs).toMatch(/\.run-detail\s*\{[^}]*background:\s*var\(--ast-pane\)/s);
    expect(runs).toContain(".run-detail [data-slot='tabs-trigger']:focus-visible");
    expect(timeline).toMatch(/\.trace-timeline--explorer \.trace-chip-llm\s*\{[^}]*var\(--ast-trace-llm-fill\)/s);
    expect(timeline).toMatch(/\.trace-timeline--explorer \.trace-bar-sql\s*\{[^}]*var\(--ast-trace-sql-bar\)/s);
    expect(architecture).toMatch(/\.arch-rail-badge\[data-optional='true'\]\s*\{[^}]*border-style:\s*dashed/s);
    expect(architecture).toMatch(/\.arch-node\.arch-node-selected\s*\{[^}]*var\(--ast-surface-selected\)/s);
    expect(benchmark).toMatch(/\.bench-surface\s*\{[^}]*background:\s*var\(--card\)/s);
    expect(source('dark-runs.css')).toContain("html[data-theme='dark'] .run-explorer .run-detail");
    expect(source('dark-benchmark.css')).toContain("html[data-theme='dark'] .bench-surface");
  });

  it('keeps gates and sessions opaque beneath foreground paper', () => {
    const gate = source('gate.css');
    const session = source('app-session.css');
    expect(gate).toMatch(/\.access-gate\s*\{[^}]*background:\s*var\(--ast-scrim\)/s);
    expect(gate).toMatch(
      /\.access-gate-panel\s*\{[^}]*background:\s*var\(--ast-surface-elevated\)[^}]*box-shadow:\s*var\(--ast-shadow-overlay\)/s
    );
    expect(session).toMatch(/\.app-session-block\s*\{[^}]*background:\s*var\(--ast-canvas\)/s);
    expect(session).toMatch(/\.app-session-card\s*\{[^}]*background:\s*var\(--ast-surface-elevated\)/s);
    expect(gate).toContain('.access-gate-actions button:not(.refresh-button):hover:not(:disabled)');
  });
});
