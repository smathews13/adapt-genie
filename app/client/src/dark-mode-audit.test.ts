import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const TOKENS = readFileSync(new URL('./styles/astrolabe-tokens.css', import.meta.url), 'utf8');
const DARK = readFileSync(new URL('./styles/dark-mode.css', import.meta.url), 'utf8');

describe('ADAPT theme contracts', () => {
  it('starts in light mode unless the user explicitly saved dark mode', () => {
    expect(INDEX).toContain('class="light"');
    expect(INDEX).not.toMatch(/<html[^>]*data-theme=/);
    expect(INDEX).toContain('<meta name="theme-color" content="#f4f7f9"');
    expect(INDEX).toContain("saved?.colorScheme === 'dark' ? 'dark' : 'light'");
    expect(INDEX).not.toContain('prefers-color-scheme');
  });

  it('maps dark actions and information to the existing blue family', () => {
    expect(TOKENS).toMatch(/html\[data-theme='dark'\][^{]*\{[\s\S]*--ast-action:\s*#8fc1e8/);
    expect(TOKENS).toMatch(/html\[data-theme='dark'\][^{]*\{[\s\S]*--ast-blue-on-dark:\s*var\(--ast-action\)/);
    expect(TOKENS).toMatch(/html\[data-theme='dark'\][^{]*\{[\s\S]*--ast-info-text:\s*var\(--ast-action\)/);
  });

  it('keeps dark overrides under the explicit theme attribute', () => {
    expect(DARK).toContain("html[data-theme='dark']");
    expect(DARK).not.toContain('@media (prefers-color-scheme: dark)');
  });

  it('keeps the decorative background disabled on first paint', () => {
    expect(INDEX).toContain('data-background-graphics="off"');
    expect(INDEX).toContain("root.dataset.backgroundGraphics = 'off'");
  });
});
