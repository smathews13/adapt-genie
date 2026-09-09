import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(new URL('./styles/adapt-loading.css', import.meta.url), 'utf8');

describe('ADAPT loading keyframes', () => {
  it('declares every animation used by the branded loader', () => {
    for (const name of [
      'adapt-peak-draw',
      'adapt-dot-pop',
      'adapt-bar-in',
      'adapt-wordmark-in',
      'adapt-status-in',
      'adapt-ring-ping',
      'adapt-bar-scan',
      'adapt-button-pulse',
      'adapt-button-ring',
      'adapt-button-scan',
    ]) {
      expect(CSS, name).toContain(`@keyframes ${name}`);
    }
  });

  it('does not depend on the retired animation reference', () => {
    expect(CSS).not.toMatch(/@keyframes ast-|ast-anim-/);
  });

  it('freezes all ADAPT activity under reduced motion', () => {
    const reduced = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.adapt-loading-peak');
    expect(reduced).toContain('.adapt-button-mark__ring');
    expect(reduced).toContain('animation: none');
  });
});
