/**
 * Settings Save must reach Architecture without a remount.
 *
 * The gear is a modal over Architecture, so a one-shot fetch on that page
 * kept showing 100 after 200 was saved. Refresh only re-ran the workspace
 * checks. The live store is the wiring those two screens share.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_RUNTIME_SETTINGS } from '../../shared/runtime-settings';
import { adoptRuntimeEntityStyles } from './runtime-entity-styles';
import {
  forgetLiveRuntimeSettings,
  loadLiveRuntimeSettings,
  recalledLiveRuntimeSettings,
  rememberLiveRuntimeSettings,
  subscribeLiveRuntimeSettings,
} from './runtime-settings-live';

const SAVED = {
  ...DEFAULT_RUNTIME_SETTINGS,
  answer: {
    ...DEFAULT_RUNTIME_SETTINGS.answer,
    takeawayGuidance: 'Test',
  },
};

afterEach(() => {
  forgetLiveRuntimeSettings();
  vi.unstubAllGlobals();
});

describe('live runtime settings', () => {
  it('publishes saved answer settings to subscribers', () => {
    const seen: string[] = [];
    const stop = subscribeLiveRuntimeSettings(() => {
      seen.push(recalledLiveRuntimeSettings()?.answer.takeawayGuidance ?? '');
    });
    rememberLiveRuntimeSettings(SAVED);
    stop();
    expect(seen).toEqual(['Test']);
    expect(recalledLiveRuntimeSettings()).not.toHaveProperty('loop');
    expect(recalledLiveRuntimeSettings()?.answer.takeawayGuidance).toBe('Test');
  });

  it('remembers the same row Appearance applies', () => {
    adoptRuntimeEntityStyles(SAVED, { setProperty: vi.fn() });
    expect(recalledLiveRuntimeSettings()?.answer.takeawayGuidance).toBe('Test');
  });

  it('reuses the remembered row instead of refetching after Save', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    rememberLiveRuntimeSettings(SAVED);
    await expect(loadLiveRuntimeSettings()).resolves.toEqual(SAVED);
    expect(fetch).not.toHaveBeenCalled();
  });
});
