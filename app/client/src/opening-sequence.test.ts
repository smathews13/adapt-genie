import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AdaptLoadingAnimation } from './AdaptLoadingAnimation';

const APP = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const STARTUP = readFileSync(new URL('./StartupBoundary.tsx', import.meta.url), 'utf8');
const LOADER = readFileSync(new URL('./AdaptLoadingAnimation.tsx', import.meta.url), 'utf8');

describe('the ADAPT opening state', () => {
  it('uses the branded startup loader', () => {
    const markup = renderToStaticMarkup(createElement(AdaptLoadingAnimation));
    expect(markup).toContain('ADAPT');
    expect(markup).toContain('adapt-loading-mark');
    expect(STARTUP).toContain('<AdaptLoadingAnimation');
  });

  it('does not run the retired opening sequence', () => {
    for (const source of [APP, STARTUP]) {
      expect(source).not.toMatch(/OpeningSequence|ConstellationField|StarField/);
    }
  });

  it('cycles useful loading messages without constellation language', () => {
    for (const message of ['Preparing Ask', 'Gathering context', 'Analyzing your data', 'Composing answer']) {
      expect(LOADER).toContain(`'${message}'`);
    }
    const messages = LOADER.slice(
      LOADER.indexOf('const ADAPT_LOADING_MESSAGES'),
      LOADER.indexOf('as const;', LOADER.indexOf('const ADAPT_LOADING_MESSAGES'))
    );
    expect(messages).not.toMatch(/constellation|robot/i);
  });
});
