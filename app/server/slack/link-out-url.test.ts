import { describe, expect, it } from 'vitest';
import { authenticatedAdaptLinkOutUrl, SlackLinkOutUrlUnavailableError } from './link-out-url';

describe('authenticated ADAPT link-out URL', () => {
  it('returns a generic app URL without identifiers, state, query, or fragment', () => {
    const url = authenticatedAdaptLinkOutUrl({
      DATABRICKS_APP_URL: 'https://adapt.example/app?slack_user=U123#token',
    });
    expect(url).toBe('https://adapt.example/app');
    expect(url).not.toContain('U123');
    expect(url).not.toContain('token');
  });

  it('fails safely when the authenticated app URL is missing', () => {
    expect(() => authenticatedAdaptLinkOutUrl({})).toThrow(SlackLinkOutUrlUnavailableError);
  });
});
