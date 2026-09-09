import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const TOKENS = readFileSync(new URL('./styles/astrolabe-tokens.css', import.meta.url), 'utf8');
const DARK = readFileSync(new URL('./styles/dark-mode.css', import.meta.url), 'utf8');

describe('ADAPT theme contracts', () => {
  it('starts dark without allowing the operating system to override AppKit', () => {
    expect(INDEX).toContain('class="light"');
    expect(INDEX).toContain('data-theme="dark"');
    expect(INDEX).toContain('<meta name="theme-color" content="#11171c"');
  });

  it('maps dark actions and information to the teal family', () => {
    expect(TOKENS).toMatch(/--ast-blue-on-dark:\s*#58d9cc/);
    expect(TOKENS).toMatch(/--ast-ice-accent:\s*#86e2d7/);
    expect(TOKENS).toMatch(/--ast-info-text:\s*var\(--ast-ice-accent\)/);
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
