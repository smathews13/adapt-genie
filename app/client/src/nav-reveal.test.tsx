/**
 * What `SHOW_EVERY_TAB_TO_EVERYONE` actually changes, and what it deliberately
 * does not.
 *
 * The temporary all-tabs review posture is off in production. These checks use
 * the real value and pin the role-gated navigation that ADAPT ships.
 */
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { NavLinks } from './Layout';
import { navEntries, showsSettingsGear, ADMIN_PAGE_NAMES, type RoleResolution, type RoleState } from './role';
import { NO_EXPERIMENTS } from './experimental-features';
import { BENCHMARK_LAB_ENABLED, SHOW_EVERY_TAB_TO_EVERYONE } from './nav-reveal';

const APP_SOURCE = readFileSync(new URL('App.tsx', import.meta.url), 'utf8');
const BENCHMARK_VISIBILITY_SOURCE = readFileSync(new URL('BenchmarkingVisibility.tsx', import.meta.url), 'utf8');

function resolution(state: RoleState): RoleResolution {
  return { state, addedAdminsReadable: true };
}

function render(state: RoleState): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <NavLinks linkClass={() => 'app-nav-tab'} role={resolution(state)} features={NO_EXPERIMENTS} />
    </MemoryRouter>
  );
}

/** The labels, in the order they are drawn. */
function labels(markup: string): string[] {
  return [...markup.matchAll(/<\/svg>\s*([^<]+?)\s*<\/(?:a|button)>/g)].map((match) => match[1].trim());
}

const EVERY_TAB = ['Ask', 'Monitoring', 'Ops', 'Connections', 'Architecture'];

describe('the review flag is off', () => {
  it('keeps administrative navigation role-gated', () => {
    expect(SHOW_EVERY_TAB_TO_EVERYONE).toBe(false);
  });
});

describe('navigation follows the signed-in role', () => {
  it('draws only Ask for a consumer', () => {
    expect(labels(render('consumer'))).toEqual(['Ask']);
  });

  it.each(['admin', 'super_admin'] as const)('draws the administrative set for a %s', (role) => {
    expect(labels(render(role))).toEqual(EVERY_TAB);
  });

  it('fails closed when the role could not be read', () => {
    expect(labels(render('failed'))).toEqual(['Ask']);
  });

  it('keeps the settings gear administrative', () => {
    expect(showsSettingsGear('consumer')).toBe(false);
    expect(showsSettingsGear('admin')).toBe(true);
    expect(EVERY_TAB).not.toContain('Settings');
  });
});

describe('Benchmarking is withdrawn from the product surface', () => {
  it('is off, because this app’s analyst audience benchmarks nothing here', () => {
    expect(BENCHMARK_LAB_ENABLED).toBe(false);
  });

  it('is hidden for every role', () => {
    for (const state of ['consumer', 'admin', 'super_admin', 'failed', 'resolving'] as const) {
      const entries = navEntries(state, NO_EXPERIMENTS).map((entry) => entry.to);
      expect(entries, state).not.toContain('/benchmarks');
      expect(labels(render(state)), state).not.toContain('Benchmarking');
    }
  });

  it('cannot be revealed by the per-browser setting while the deployment flag is off', () => {
    // The flag stands in front of the operator preference: turning benchmarkLab
    // on in one browser reveals nothing while the surface is withdrawn.
    const withToggle = navEntries('admin', { ...NO_EXPERIMENTS, benchmarkLab: true });
    expect(withToggle.some((entry) => entry.to === '/benchmarks')).toBe(false);
  });

  it('still gates a pasted /benchmarks URL on the same flag, so the route redirects to Ask', () => {
    expect(APP_SOURCE).toMatch(/path: '\/benchmarks'/);
    expect(APP_SOURCE).toMatch(/<BenchmarkingVisibility>/);
    expect(BENCHMARK_VISIBILITY_SOURCE).toMatch(/BENCHMARK_LAB_ENABLED/);
    expect(BENCHMARK_VISIBILITY_SOURCE).toMatch(/showsBenchmarkLab\(features\)/);
    expect(BENCHMARK_VISIBILITY_SOURCE).toMatch(/<Navigate to="\/" replace \/>/);
  });
});

describe('nothing about permission has moved', () => {
  it('leaves every admin route wrapped in the gate, so a consumer meets a sentence and not a page', () => {
    // The flag reveals the tab. `AdminOnly` still decides what is behind it, and
    // that is the whole reason revealing the tab is safe: a genuine consumer who
    // clicks Monitoring gets "Not available on your account" rather than a page
    // of requests the server refuses.
    for (const path of Object.keys(ADMIN_PAGE_NAMES)) {
      const route = APP_SOURCE.match(new RegExp(`path: '${path}',[\\s\\S]*?errorElement:`));

      expect(route, `${path} is no longer registered in App.tsx`).not.toBeNull();
      expect(route![0], `${path} is no longer wrapped in AdminRoute`).toContain('<AdminRoute>');
    }
  });

  it('is client-side only, and names nothing the server reads', () => {
    const flag = readFileSync(new URL('nav-reveal.ts', import.meta.url), 'utf8');
    const code = flag.replace(/\/\*[\s\S]*?\*\//g, ' ');

    // Kept out of `shared/` deliberately, and importing nothing from it: the
    // server must not agree with this one, which is the opposite of
    // ACCESS_GATE_ENABLED. A dependency either way would be the first step
    // towards it being read as permission, which it is not.
    expect(code).not.toMatch(/\bimport\b/);
    expect(code).toContain('SHOW_EVERY_TAB_TO_EVERYONE');
    expect(code).toContain('BENCHMARK_LAB_ENABLED');
  });
});
