import { describe, expect, it } from 'vitest';

import type { ConversationMessage } from './app-types';
import { readerConversationTurns } from './conversation-export';
import { conversationMarkdown } from './export-serializers';

const message = (
  id: string,
  role: 'user' | 'assistant',
  content: string,
  response_json?: unknown
): ConversationMessage => ({
  id,
  role,
  content,
  response_json,
  created_at: `2026-09-09T00:00:${id.padStart(2, '0')}Z`,
});

describe('stored conversation export', () => {
  it('preserves every reader-visible turn in chronological order', () => {
    const messages: ConversationMessage[] = [
      message('1', 'user', 'Unmatched opening question'),
      message('2', 'assistant', 'A visible unstructured reply'),
      message('3', 'assistant', 'stored plan envelope', {
        type: 'plan',
        plan: {
          question: 'Original planned question',
          summary: 'Compare the current and prior quarter.',
          steps: [{ id: 'one', title: 'Read revenue', description: 'Aggregate by region.', kind: 'data' }],
        },
      }),
      message('4', 'user', 'Approved the proposed analysis plan.'),
      message('5', 'assistant', 'stored clarification envelope', {
        type: 'clarification',
        clarification: {
          question: 'Which currency?',
          reason: 'The source stores two currencies.',
          options: ['USD', 'EUR'],
        },
      }),
      message('6', 'user', 'USD'),
      message('7', 'assistant', 'stored answer envelope', {
        type: 'answer',
        id: 'answer-7',
        mode: 'live',
        takeaway: 'East led.',
        narrative: 'Revenue was $12.',
        sources: [{ name: 'catalog.gold.revenue', freshness: 'today', role: 'reading' }],
        caveats: [],
        sql: 'secret query',
        trace: { id: 'trace-secret', stages: [{ name: 'hidden diagnostic' }] },
      }),
    ];

    const markdown = conversationMarkdown('Review', readerConversationTurns(messages));
    const visible = [
      'Unmatched opening question',
      'A visible unstructured reply',
      'Proposed analysis plan',
      'Compare the current and prior quarter.',
      'Read revenue',
      'Original planned question',
      'Approved the proposed analysis plan.',
      'Needs one detail',
      'Which currency?',
      'USD',
      'East led.',
    ];
    visible.forEach((value) => expect(markdown).toContain(value));
    visible.reduce((previous, value) => {
      const position = markdown.indexOf(value);
      expect(position).toBeGreaterThan(previous);
      return position;
    }, -1);
    expect(markdown).not.toContain('secret query');
    expect(markdown).not.toContain('hidden diagnostic');
  });

  it('falls back to normalized reader text for malformed or non-answer assistant envelopes', () => {
    const markdown = conversationMarkdown(
      'Fallbacks',
      readerConversationTurns([
        message('1', 'assistant', 'Reader can still see this.', { type: 'status', trace: 'hidden' }),
        message('2', 'assistant', 'Malformed JSON stays visible.', '{nope'),
      ])
    );
    expect(markdown).toContain('Reader can still see this.');
    expect(markdown).toContain('Malformed JSON stays visible.');
    expect(markdown).not.toContain('hidden');
  });
});
