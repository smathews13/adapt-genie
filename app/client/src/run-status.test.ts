import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { runStatusFor } from './run-status';
import { RunStatusPill } from './RunStatusPill';

const status = (overrides: Partial<Parameters<typeof runStatusFor>[0]> = {}) =>
  runStatusFor({
    loading: false,
    liveSteps: 0,
    runStopped: false,
    awaitingApproval: false,
    asked: false,
    answered: false,
    readiness: 'ready',
    ...overrides,
  });

describe('ADAPT run status', () => {
  it('distinguishes a connected idle agent from active work', () => {
    expect(status().label).toBe('Connected');
    expect(status({ loading: true, liveSteps: 8 }).label).toBe('Live · step 08');
  });

  it('does not call an unknown or unreachable connection ready', () => {
    expect(status({ readiness: 'unchecked' }).label).toBe('Disconnected');
    expect(status({ readiness: 'unreachable' }).label).toBe('Disconnected');
  });

  it('uses the ADAPT loader while connection readiness is being checked', () => {
    const markup = renderToStaticMarkup(createElement(RunStatusPill, { status: status({ readiness: 'checking' }) }));
    expect(markup).toContain('adapt-loader');
    expect(markup).toContain('Checking agent connection');
    expect(markup).not.toMatch(/ConceptFlicker|constellation/);
  });

  it('stops reporting activity when a run completes', () => {
    const done = status({ answered: true, liveSteps: 8 });
    expect(done.label).toBe('Complete');
    expect(done.alive).toBe(false);
  });

  it('distinguishes a recovered complete answer from an ordinary completion', () => {
    const recovered = status({
      answered: true,
      verdict: 'complete',
      recoveredWithRetries: true,
    });
    expect(recovered.label).toBe('Recovered · complete with retries');
    expect(recovered.finished).toBe(true);
    expect(recovered.alive).toBe(false);
  });
});
