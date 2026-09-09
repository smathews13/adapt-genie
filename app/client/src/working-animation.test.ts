import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AdaptLoader, AdaptLoadingAnimation } from './AdaptLoadingAnimation';

const SOURCE = readFileSync(new URL('./AdaptLoadingAnimation.tsx', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('./styles/adapt-loading.css', import.meta.url), 'utf8');

describe('ADAPT loading states', () => {
  it('renders the ADAPT mark and wordmark for startup', () => {
    const markup = renderToStaticMarkup(createElement(AdaptLoadingAnimation));
    expect(markup).toContain('adapt-loading-mark');
    expect(markup).toContain('ADAPT');
    expect(markup).toContain('Preparing Ask');
  });

  it('uses the compact ADAPT mark for inline and panel waits', () => {
    const markup = renderToStaticMarkup(createElement(AdaptLoader, { label: 'Loading settings', variant: 'panel' }));
    expect(markup).toContain('adapt-button-mark');
    expect(markup).toContain('Loading settings');
    expect(markup).not.toMatch(/spinner|constellation/i);
  });

  it('reuses the moving login A while an answer runs', () => {
    const markup = renderToStaticMarkup(createElement(AdaptLoadingAnimation, { variant: 'ask' }));
    expect(markup).toContain('adapt-loading-ring');
    expect(markup).toContain('adapt-loading-bar');
    expect(CSS).toMatch(/\.adapt-loading\s*\{[^}]*--accent:\s*#3ec6b4/s);
    expect(SOURCE).not.toMatch(/WorkingConstellation|AgentConstellation/);
  });

  it('provides a complete reduced-motion resting state', () => {
    const guard = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(guard).toContain('.adapt-loading-peak');
    expect(guard).toContain('animation: none');
    expect(guard).toContain('stroke-dashoffset: 0');
  });
});
