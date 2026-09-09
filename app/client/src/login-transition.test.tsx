import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { FirstOpenPanel } from './FirstOpenGate';
import type { FirstOpenReport } from './first-open';

const GATE = readFileSync(new URL('./FirstOpenGate.tsx', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('./styles/first-open.css', import.meta.url), 'utf8');

const report: FirstOpenReport = {
  signedInAs: 'sam@example.com',
  oauthVerified: true,
  verdict: 'granted',
  scopes: [],
  missing: [],
  footer: null,
};

describe('the ADAPT login handoff', () => {
  it('renders an ADAPT gate with no constellation layer', () => {
    const markup = renderToStaticMarkup(
      <FirstOpenPanel report={report} onContinue={vi.fn()} onRefresh={vi.fn()} onSkip={vi.fn()} />
    );
    expect(markup).toContain('ADAPT');
    expect(markup).toContain('role="dialog"');
    expect(markup).not.toMatch(/constellation|ast-opening-sky/i);
  });

  it('uses the ADAPT busy treatment while preparing Ask', () => {
    const markup = renderToStaticMarkup(
      <FirstOpenPanel report={report} onContinue={vi.fn()} onRefresh={vi.fn()} onSkip={vi.fn()} preparing />
    );
    expect(markup).toContain('Preparing Ask');
    expect(markup).toContain('adapt-button-mark');
  });

  it('uses one short surface handoff and no opening choreography', () => {
    expect(GATE).toContain('requestLoginHandoff');
    expect(GATE).toContain('SURFACE_TRANSITION_MS');
    expect(GATE).not.toMatch(/OpeningSequence|ConstellationField|ast-anim-x-/);
    expect(CSS).not.toMatch(/@keyframes ast-x-|ast-opening-sky/);
  });
});
