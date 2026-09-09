import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { abbreviatedConversationId } from './display-id';
import { RunHeader } from './RunHeader';
import type { Run } from './app-types';

const RAIL = readFileSync(new URL('./styles/rail.css', import.meta.url), 'utf8');
const TOKENS = readFileSync(new URL('./styles/astrolabe-tokens.css', import.meta.url), 'utf8');

const run: Run = {
  id: 'msg-d78ca105',
  conversation_id: 'conv-551bcd7f-75d5-420a-877d-9ec1a8f6a3d1',
  prompt: 'Compare daily engagement by title.',
  stakeholder: 'sam@example.com',
  status: 'complete',
  duration_ms: 1,
  rating: null,
  created_at: '2026-08-21T00:00:00Z',
};

describe('ADAPT Ask presentation', () => {
  it('uses a static background instead of a star field', () => {
    expect(TOKENS).toContain('--ast-sky-spackle: none');
    expect(RAIL).not.toMatch(/background-image:\s*var\(--ast-sky-spackle\)/);
  });

  it('keeps the conversation rail on the normal card surface', () => {
    expect(RAIL).toMatch(/\.conversation-rail\s*\{[^}]*background:\s*var\(--card\)/s);
  });

  it('abbreviates conversation ids while retaining the full value', () => {
    const full = run.conversation_id!;
    expect(abbreviatedConversationId(full)).toBe('conv-5');
    const markup = renderToStaticMarkup(
      <RunHeader
        run={run}
        conversationId={full}
        conversationRun={1}
        toolCalls={21}
        reference={false}
        groundedness={null}
      />
    );
    expect(markup).toContain('conv-5');
    expect(markup).toContain(`title="${full}"`);
  });
});
