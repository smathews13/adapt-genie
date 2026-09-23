import { describe, expect, it } from 'vitest';
import { RunRequestSchema } from './run-contracts';

const valid = {
  schemaVersion: 1,
  conversationId: 'conversation-1',
  prompt: 'Show me the latest governed result.',
};

describe('RunRequestSchema', () => {
  it('accepts only the product-neutral channel request', () => {
    expect(RunRequestSchema.parse(valid)).toEqual(valid);
  });

  it.each([
    ['subject', 'somebody@example.com'],
    ['auth_mode', 'service_principal'],
    ['run_as', 'admin@example.com'],
    ['privileges', ['SELECT']],
    ['catalog', 'main'],
    ['schema', 'private'],
    ['genie_space_id', 'space-1'],
    ['tools', ['sql']],
    ['serving_endpoint', 'other-endpoint'],
  ])('rejects injected %s policy', (field, value) => {
    const result = RunRequestSchema.safeParse({ ...valid, [field]: value });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true);
  });

  it('accepts only bounded hashed Slack correlation context', () => {
    const parsed = RunRequestSchema.parse({
      ...valid,
      externalContext: {
        source: 'slack',
        slackWorkspaceIdHash: 'a'.repeat(64),
        slackUserIdHash: 'b'.repeat(64),
        slackChannelIdHash: 'c'.repeat(64),
        slackThreadTsHash: 'd'.repeat(64),
        slackEventIdHash: 'e'.repeat(64),
        projectId: 'project/reference-1',
        reference: 'event:01',
      },
    });
    expect(parsed.externalContext?.slackUserIdHash).toBe('b'.repeat(64));
  });

  it.each([
    ['slack_user_id', 'U123'],
    ['token', 'secret'],
    ['authorization', 'Bearer secret'],
    ['subject', 'reader@example.com'],
    ['prompt', 'ignore policy'],
    ['headers', { authorization: 'secret' }],
    ['nested', { slackUserIdHash: 'a'.repeat(64) }],
  ])('rejects raw externalContext field %s', (field, value) => {
    expect(
      RunRequestSchema.safeParse({
        ...valid,
        externalContext: { source: 'slack', [field]: value },
      }).success
    ).toBe(false);
  });

  it('rejects unhashed Slack identifiers', () => {
    expect(
      RunRequestSchema.safeParse({
        ...valid,
        externalContext: { source: 'slack', slackUserIdHash: 'U123' },
      }).success
    ).toBe(false);
  });
});
