import { describe, expect, it } from 'vitest';
import type { RunEnvelope } from './run-contracts';
import { renderSlackRunMessage, SLACK_MAX_BLOCKS, validateSlackMessage } from './slack-message';

const now = '2026-09-21T20:00:00.000Z';
const base: RunEnvelope = {
  schemaVersion: 1,
  runId: 'run-1',
  conversationId: 'conversation-1',
  state: 'complete',
  createdAt: now,
  updatedAt: now,
  correlationId: null,
  clarification: null,
  blocked: null,
  error: null,
  answer: {
    takeaway: 'Revenue grew <safely>.',
    narrative: 'Growth was broad based & durable.',
    content: 'not projected',
    figures: [
      { label: 'Revenue', value: 42, display: '$42M', comparison: '+8% YoY' },
      { label: 'Margin', value: 0.71, display: '71%', comparison: '+2 pts' },
    ],
    charts: [{ type: 'bar', private: 'not serialized directly' }],
    sources: [{ name: 'Finance mart', freshness: 'today' }],
    caveats: ['Preliminary close'],
    derivation: [],
    sql: 'not projected',
    traceLink: null,
  },
  externalContext: { source: 'slack' },
};

describe('Slack run renderer', () => {
  it.each([
    ['complete', 'Answer complete'],
    ['partial', 'Partial answer'],
    ['cancelled', 'Run cancelled'],
    ['expired', 'Run expired'],
  ] as const)('renders %s as a distinct accessible state', (state, label) => {
    const message = renderSlackRunMessage({ ...base, state }, 'https://adapt.example/runs/run-1');
    expect(message.text).toContain(`ADAPT: ${label}`);
    expect(JSON.stringify(message.blocks)).toContain(label);
    expect(validateSlackMessage(message).ok).toBe(true);
  });

  it('renders clarification question/options and blocked web action distinctly', () => {
    const clarification = renderSlackRunMessage(
      {
        ...base,
        state: 'clarification_required',
        answer: null,
        clarification: { question: 'Which quarter?', choices: ['Q1', 'Q2'] },
      },
      'https://adapt.example/runs/run-1'
    );
    expect(JSON.stringify(clarification.blocks)).toContain('Which quarter?');
    expect(JSON.stringify(clarification.blocks)).toContain('Q1');

    const blocked = renderSlackRunMessage(
      {
        ...base,
        state: 'blocked',
        answer: null,
        blocked: { code: 'plan_approval_required', message: 'Approve this plan in ADAPT.', link: null },
      },
      'https://adapt.example/runs/run-1'
    );
    expect(blocked.text).toContain('Action needed');
    expect(JSON.stringify(blocked.blocks)).toContain('Open this run in ADAPT');
  });

  it('preserves figures with units/comparisons, caveats, source names, and escapes mrkdwn', () => {
    const message = renderSlackRunMessage(base, 'https://adapt.example/runs/run-1');
    const serialized = JSON.stringify(message);
    expect(serialized).toContain('$42M');
    expect(serialized).toContain('+8% YoY');
    expect(serialized).toContain('Preliminary close');
    expect(serialized).toContain('Finance mart');
    expect(serialized).toContain('&lt;safely&gt;');
    expect(serialized).toContain('&amp; durable');
    expect(serialized).toContain('Charts (1) are available in ADAPT');
    expect(serialized).not.toContain('not projected');
    expect(message.blocks.length).toBeLessThanOrEqual(SLACK_MAX_BLOCKS);
  });

  it('uses an explicit safe summary rather than silently truncating oversized content', () => {
    const oversized = {
      ...base,
      answer: { ...base.answer!, narrative: 'x'.repeat(4000) },
    };
    const message = renderSlackRunMessage(oversized, 'https://adapt.example/runs/run-1');
    expect(message.text).toContain('Full details are available in ADAPT');
    expect(JSON.stringify(message.blocks)).toContain(
      'No figures, units, caveats, or citations were silently truncated'
    );
    expect(JSON.stringify(message.blocks)).toContain('https://adapt.example/runs/run-1');
  });
});
