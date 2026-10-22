import { describe, expect, it } from 'vitest';
import { slackAnswerLink } from './answer-link';

describe('slackAnswerLink', () => {
  it('opens the conversation in ADAPT Ask rather than the trace JSON', () => {
    const link = slackAnswerLink('https://adapt.example/', 'conv 1');
    expect(link).toBe('https://adapt.example/?c=conv+1');
    expect(link).not.toContain('/api/');
  });

  it('refuses to build a link without the app URL', () => {
    expect(() => slackAnswerLink('  ', 'conv-1')).toThrow('app URL is unavailable');
  });
});
