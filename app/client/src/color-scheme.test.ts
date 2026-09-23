import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  applyColorScheme,
  DARK_THEME_COLOR,
  DEFAULT_COLOR_SCHEME,
  initialColorScheme,
  LIGHT_THEME_COLOR,
} from './color-scheme';

function fakeRoot() {
  const attrs = new Map<string, string>();
  const classes = new Set<string>();
  return {
    classList: {
      add: (name: string) => {
        classes.add(name);
      },
      contains: (name: string) => classes.has(name),
    },
    setAttribute: (name: string, value: string) => {
      attrs.set(name, value);
    },
    getAttribute: (name: string) => attrs.get(name) ?? null,
  };
}

describe('color scheme', () => {
  it('keeps the AppKit light class and paints from data-theme', () => {
    const root = fakeRoot();
    const meta = fakeRoot();
    applyColorScheme('dark', root, meta);
    expect(root.classList.contains('light')).toBe(true);
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(meta.getAttribute('content')).toBe(DARK_THEME_COLOR);

    applyColorScheme('light', root, meta);
    expect(root.classList.contains('light')).toBe(true);
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(meta.getAttribute('content')).toBe(LIGHT_THEME_COLOR);
  });

  it('boots light before React while the inline script prevents a preference flash', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const tokens = readFileSync(new URL('./styles/astrolabe-tokens.css', import.meta.url), 'utf8');
    expect(DEFAULT_COLOR_SCHEME).toBe('light');
    expect(html).toMatch(/<html[^>]*class="light"[^>]*data-brand="adapt"/);
    expect(html).not.toMatch(/<html[^>]*data-theme=/);
    expect(html).toMatch(/<meta name="theme-color" content="#f4f7f9"\s*\/>/i);
    expect(html.indexOf('root.dataset.theme = scheme')).toBeLessThan(html.indexOf('<style>'));
    expect(html).toContain("scheme === 'dark' ? '#0b1014' : '#f4f7f9'");
    expect(tokens).toMatch(/:root\s*\{[^}]*color-scheme:\s*light/s);
    expect(tokens).toMatch(/html\[data-theme='dark'\]\s*\{[^}]*color-scheme:\s*dark/s);
  });

  it('uses the ADAPT light default when there is no stored preference', () => {
    expect(initialColorScheme(null)).toBe('light');
    expect(initialColorScheme(undefined)).toBe('light');
  });

  it('gives stored preferences precedence and treats a missing legacy scheme as light', () => {
    expect(initialColorScheme({ colorScheme: 'light' })).toBe('light');
    expect(initialColorScheme({ colorScheme: 'dark' })).toBe('dark');
    expect(initialColorScheme({ density: 'compact' })).toBe('light');
  });

  it('does not require a document to exist', () => {
    expect(() => applyColorScheme('dark', null)).not.toThrow();
  });
});
