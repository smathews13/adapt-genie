import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AdaptBusyButtonContent, AdaptLoader } from './AdaptLoadingAnimation';
import { AstrolabeLockup } from './AstrolabeMark';

const HOME = readFileSync(new URL('./HomePage.tsx', import.meta.url), 'utf8');

describe('the ADAPT mark', () => {
  it('uses ADAPT as the product wordmark', () => {
    const markup = renderToStaticMarkup(createElement(AstrolabeLockup));
    expect(markup).toContain('ADAPT');
  });

  it('uses branded activity marks instead of a generic spinner', () => {
    const markup = renderToStaticMarkup(createElement(AdaptLoader, { label: 'Loading' }));
    expect(markup).toContain('adapt-button-mark');
    expect(markup).not.toMatch(/loader2|spinner/i);
  });

  it('keeps busy button width stable while changing its message', () => {
    const markup = renderToStaticMarkup(
      createElement(AdaptBusyButtonContent, { busy: true, label: 'Continue', busyLabel: 'Preparing Ask' })
    );
    expect(markup).toContain('data-busy="true"');
    expect(markup).toContain('Continue');
    expect(markup).toContain('Preparing Ask');
  });

  it('uses the ADAPT Ask loader and no constellation', () => {
    expect(HOME).toContain('<AdaptLoadingAnimation variant="ask"');
    expect(HOME).not.toMatch(/AgentPathConstellation|WorkingConstellation|ConceptFlicker/);
  });
});
