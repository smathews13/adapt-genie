import { describe, expect, it } from 'vitest';

import { ownsPreferenceDefaults, PREFERENCE_DEFAULT_OWNER } from './preference-default-owner';

describe('preference default ownership', () => {
  it('reserves deployment defaults for Rida and compares canonically', () => {
    expect(PREFERENCE_DEFAULT_OWNER).toBe('rida.qureshi@take2games.com');
    expect(ownsPreferenceDefaults(' RIDA.QURESHI@TAKE2GAMES.COM ')).toBe(true);
    expect(ownsPreferenceDefaults('other.admin@take2games.com')).toBe(false);
  });
});
