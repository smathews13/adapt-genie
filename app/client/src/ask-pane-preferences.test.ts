import { afterEach, describe, expect, it, vi } from 'vitest';

import { paneStartsCollapsed, rememberPaneCollapsed } from './ask-pane-preferences';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Ask pane collapse preferences', () => {
  it('starts both rails expanded and remembers explicit collapse', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });

    expect(paneStartsCollapsed('rail')).toBe(false);
    expect(paneStartsCollapsed('inspector')).toBe(false);

    rememberPaneCollapsed('rail', true);
    rememberPaneCollapsed('inspector', true);
    expect(paneStartsCollapsed('rail')).toBe(true);
    expect(paneStartsCollapsed('inspector')).toBe(true);
  });

  it('fails closed when browser storage is unavailable', () => {
    vi.stubGlobal('window', {
      get localStorage() {
        throw new Error('blocked');
      },
    });

    expect(paneStartsCollapsed('rail')).toBe(false);
    expect(() => rememberPaneCollapsed('inspector', false)).not.toThrow();
  });
});
