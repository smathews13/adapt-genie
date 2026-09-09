import { describe, expect, it } from 'vitest';
import {
  MAX_CONVERSATION_FILTER_VALUES,
  conversationFilterQueryString,
  conversationMatchesFilters,
  parseConversationFilterQuery,
} from './conversation-filters';

describe('conversation owner filter contract', () => {
  it('normalizes, deduplicates, and caps owner addresses', () => {
    const owners = Array.from(
      { length: MAX_CONVERSATION_FILTER_VALUES + 5 },
      (_, index) => ` User-${index}@Example.com `
    );
    const parsed = parseConversationFilterQuery({
      owners: [owners[0], owners[0].toLowerCase(), ...owners.slice(1)],
    });
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.value.owners).toHaveLength(MAX_CONVERSATION_FILTER_VALUES);
    expect(parsed.value.owners[0]).toBe('user-0@example.com');
  });

  it('rejects malformed owner values', () => {
    expect(parseConversationFilterQuery({ owners: { forged: 'someone@example.com' } }).ok).toBe(false);
  });

  it('matches only selected owners and serializes only owner filters', () => {
    const filters = { owners: ['alice@example.com'] };
    expect(conversationMatchesFilters({ id: 'match', user_email: 'Alice@Example.com' }, filters)).toBe(true);
    expect(conversationMatchesFilters({ id: 'other', user_email: 'bob@example.com' }, filters)).toBe(false);
    expect(conversationFilterQueryString(filters)).toBe('owners=alice%40example.com');
  });
});
