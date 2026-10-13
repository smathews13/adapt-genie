import { describe, expect, it } from 'vitest';
import { bodyString, bodyValue } from './request-body';

describe('request body readers', () => {
  it('trims a string field', () => {
    expect(bodyString({ body: { name: '  main.default.x  ' } }, 'name')).toBe('main.default.x');
  });

  it('reads a missing body, a missing field, or a non-string as empty', () => {
    expect(bodyString({}, 'name')).toBe('');
    expect(bodyString({ body: null }, 'name')).toBe('');
    expect(bodyString({ body: { name: 7 } }, 'name')).toBe('');
  });

  it('returns other values unchanged for the caller to check', () => {
    expect(bodyValue({ body: { preview: true } }, 'preview')).toBe(true);
    expect(bodyValue({ body: undefined }, 'preview')).toBeUndefined();
  });
});
