import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { NavLinks } from './Layout';
import { NO_EXPERIMENTS } from './experimental-features';
import type { RoleResolution } from './role';
import { partial } from './styles/stylesheet';

const SHELL = partial('shell.css');
const RAIL = partial('rail.css');
const ADMIN: RoleResolution = { state: 'admin', addedAdminsReadable: true };
const TABS = [
  ['/', 'Ask'],
  ['/monitoring', 'Monitoring'],
  ['/ops', 'Ops'],
  ['/connections', 'Connections'],
  ['/architecture', 'Architecture'],
] as const;

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

function renderNav(route: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[route]}>
      <NavLinks linkClass={() => 'app-nav-tab'} role={ADMIN} features={NO_EXPERIMENTS} />
    </MemoryRouter>
  );
}

describe('ADAPT global navigation selection', () => {
  it('renders every admin destination with one selected icon and label', () => {
    for (const [route, label] of TABS) {
      const markup = renderNav(route);
      expect(markup.match(/class="app-nav-tab"/g)).toHaveLength(TABS.length);
      expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
      const selected = markup.match(/<a[^>]*aria-current="page"[^>]*>[\s\S]*?<\/a>/)?.[0] ?? '';
      expect(selected).toContain('<svg');
      expect(selected).toContain(label);
    }
  });

  it('uses the ADAPT primary token for label, icon, and underline', () => {
    expect(rule(RAIL, '.conversation-row.active')).toContain('border-color: var(--primary)');
    const selected = rule(SHELL, ".app-nav-tab[aria-current='page']");
    expect(selected).toContain('border-bottom-color: var(--primary)');
    expect(selected).toContain('color: var(--primary)');
    expect(rule(SHELL, '.app-nav-tab svg')).toMatch(/color:\s*inherit[\s\S]*stroke:\s*currentColor/);
  });

  it('keeps hover neutral and keyboard focus separate from selection', () => {
    const hover = rule(SHELL, '.app-nav-tab:hover');
    const focus = rule(SHELL, '.app-nav-tab:focus-visible');
    expect(hover).toContain('color: var(--foreground)');
    expect(hover).toContain('background: transparent');
    expect(focus).toContain('outline: 2px solid var(--ring)');
    expect(focus).toContain('border-bottom-color: transparent');
    expect(focus).not.toContain('color: var(--primary)');
  });

  it('maps selection and focus to distinct high-contrast shapes', () => {
    const forced = SHELL.slice(SHELL.indexOf('@media (forced-colors: active)'));
    expect(forced).toMatch(
      /\.app-nav-tab\[aria-current='page'\][\s\S]*border-bottom-color:\s*Highlight;[\s\S]*color:\s*Highlight/
    );
    expect(forced).toMatch(
      /\.app-nav-tab:focus-visible\s*\{[^}]*outline-color:\s*Highlight;[^}]*border-bottom-color:\s*transparent/
    );
  });
});
