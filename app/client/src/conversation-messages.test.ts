import { describe, expect, it, vi } from 'vitest';

import type { ConversationMessage } from './app-types';
import {
  capturePrependAnchor,
  mergeNewestConversationMessages,
  prependConversationMessages,
  readConversationMessagePage,
  restorePrependAnchor,
} from './conversation-messages';

const message = (index: number): ConversationMessage => ({
  id: `msg-${String(index).padStart(3, '0')}`,
  role: index % 2 ? 'assistant' : 'user',
  content: `message ${index}`,
  created_at: new Date(Date.UTC(2026, 7, 1, 0, 0, index)).toISOString(),
});

describe('conversation message pages', () => {
  it('requests the bounded newest page and forwards cancellation', async () => {
    const signal = new AbortController().signal;
    const fetcher = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ messages: [message(119)], nextCursor: 'older', hasMore: true })))
    );

    await expect(readConversationMessagePage('conversation/a', { signal, fetcher })).resolves.toMatchObject({
      messages: [{ id: 'msg-119' }],
      nextCursor: 'older',
      hasMore: true,
    });
    expect(fetcher).toHaveBeenCalledWith('/api/conversations/conversation%2Fa/messages?limit=50', { signal });
  });

  it('accepts the previous server array during a rolling deploy', async () => {
    const fetcher = vi.fn(() => Promise.resolve(new Response(JSON.stringify([message(1), message(2)]))));
    await expect(readConversationMessagePage('conv', { fetcher })).resolves.toEqual({
      messages: [message(1), message(2)],
      nextCursor: null,
      hasMore: false,
    });
  });

  it('assembles a 120-message thread in ascending order without duplicates', () => {
    const all = Array.from({ length: 120 }, (_, index) => message(index));
    const newest = all.slice(70);
    const middle = all.slice(20, 70);
    const oldestWithBoundaryDuplicate = [...all.slice(0, 20), all[20]];
    const assembled = prependConversationMessages(
      prependConversationMessages(newest, middle),
      oldestWithBoundaryDuplicate
    );

    expect(assembled).toHaveLength(120);
    expect(assembled.map((entry) => entry.id)).toEqual(all.map((entry) => entry.id));
  });

  it('keeps concurrent arrivals when an older page is prepended', () => {
    const current = [message(50), message(51), message(52), message(53)];
    const older = [message(48), message(49), message(50)];
    expect(prependConversationMessages(current, older).map((entry) => entry.id)).toEqual([
      'msg-048',
      'msg-049',
      'msg-050',
      'msg-051',
      'msg-052',
      'msg-053',
    ]);
  });

  it('replaces the newest window after an active answer arrives while retaining loaded history', () => {
    const current = [...Array.from({ length: 60 }, (_, index) => message(index)), { ...message(60), id: 'local-user' }];
    const newest = Array.from({ length: 50 }, (_, index) => message(index + 12));
    const merged = mergeNewestConversationMessages(current, newest);

    expect(merged.map((entry) => entry.id)).toEqual(Array.from({ length: 62 }, (_, index) => message(index).id));
    expect(merged.some((entry) => entry.id === 'local-user')).toBe(false);
  });

  it('keeps an in-flight follow-up until the store has actually written that turn', () => {
    const persisted = [message(0), message(1), message(2), message(3)];
    const current: ConversationMessage[] = [
      ...persisted,
      { id: 'local-follow-up', role: 'user', content: 'How did that compare to last week?' },
    ];
    expect(mergeNewestConversationMessages(current, persisted).map((entry) => entry.id)).toEqual([
      'msg-000',
      'msg-001',
      'msg-002',
      'msg-003',
      'local-follow-up',
    ]);

    const storedTurn: ConversationMessage[] = [
      ...persisted,
      { ...message(4), role: 'user' as const, content: 'How did that compare to last week?' },
      { ...message(5), role: 'assistant' as const, content: 'Last week was lower.' },
    ];
    expect(mergeNewestConversationMessages(current, storedTurn).map((entry) => entry.id)).toEqual(
      storedTurn.map((entry) => entry.id)
    );
  });
});

describe('prepend scroll and focus contract', () => {
  it('restores the old first row to the same viewport coordinate and focuses it', () => {
    const focus = vi.fn();
    const scrollBy = vi.fn();
    let top = 120;
    const row = {
      dataset: {},
      getBoundingClientRect: () => ({ top }),
      focus,
    } as unknown as HTMLElement;
    const load = { dataset: { messagePagination: 'older' } } as unknown as HTMLElement;
    const root = { getElementById: () => row, activeElement: load } as unknown as Document;
    const anchor = capturePrependAnchor(message(50), root);
    top = 360;
    restorePrependAnchor(anchor, root, { scrollBy } as unknown as Window);

    expect(scrollBy).toHaveBeenCalledWith({ top: 240, behavior: 'instant' });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
