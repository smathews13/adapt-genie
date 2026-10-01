import { describe, expect, it, vi } from 'vitest';

import type { SlackLinkIntentMetadata } from '../../shared/channel/delegated-identity';
import { LakebaseDurableSlackLinkIntentStore } from './durable-link-intent-store';

const intent: SlackLinkIntentMetadata = {
  id: 'link-1',
  state: 'state-1',
  nonce: 'nonce-1',
  slackTeamId: 'T123',
  slackUserId: 'U123',
  databricksWorkspace: 'https://dbc.example.com',
  databricksAudience: 'adapt',
  redirectUri: 'https://adapt.example.com/api/slack/oauth/callback',
  verifierReference: {
    id: 'pkce-1',
    provider: 'databricks-secret-manager',
    fingerprint: 'verifier-fingerprint',
  },
  createdAt: '2026-10-01T10:00:00.000Z',
  expiresAt: '2026-10-01T10:10:00.000Z',
};

function rowFor(value: SlackLinkIntentMetadata): Record<string, unknown> {
  return {
    intent_id: value.id,
    state: value.state,
    nonce: value.nonce,
    slack_team_id: value.slackTeamId,
    slack_user_id: value.slackUserId,
    databricks_workspace: value.databricksWorkspace,
    databricks_audience: value.databricksAudience,
    redirect_uri: value.redirectUri,
    verifier_ref_id: value.verifierReference.id,
    verifier_ref_provider: value.verifierReference.provider,
    verifier_ref_fingerprint: value.verifierReference.fingerprint,
    created_at: new Date(value.createdAt),
    expires_at: new Date(value.expiresAt),
  };
}

describe('LakebaseDurableSlackLinkIntentStore', () => {
  it('writes only strict intent metadata with parameterized values', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ intent_id: intent.id }] });
    const store = new LakebaseDurableSlackLinkIntentStore({ query }, 'adapt.slack_link_intents');

    await store.put(intent);

    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toMatch(
      /INSERT INTO adapt\.slack_link_intents[\s\S]+ON CONFLICT DO NOTHING[\s\S]+RETURNING intent_id/i
    );
    expect(query.mock.calls[0]?.[1]).toEqual([
      intent.id,
      intent.state,
      intent.nonce,
      intent.slackTeamId,
      intent.slackUserId,
      intent.databricksWorkspace,
      intent.databricksAudience,
      intent.redirectUri,
      intent.verifierReference.id,
      intent.verifierReference.provider,
      intent.verifierReference.fingerprint,
      intent.createdAt,
      intent.expiresAt,
    ]);
    expect(JSON.stringify(query.mock.calls)).not.toMatch(/code_verifier|access_token|refresh_token/i);
  });

  it('reads by state without consuming and parses Date timestamps', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [rowFor(intent)] });
    const store = new LakebaseDurableSlackLinkIntentStore({ query }, 'adapt.slack_link_intents');

    await expect(store.readByState(intent.state)).resolves.toEqual(intent);
    expect(query.mock.calls[0]?.[0]).toMatch(/SELECT[\s\S]+WHERE state = \$1[\s\S]+LIMIT 1/i);
    expect(query.mock.calls[0]?.[1]).toEqual([intent.state]);
  });

  it.each([
    ['id', 'take', intent.id, /DELETE FROM adapt\.slack_link_intents[\s\S]+WHERE intent_id = \$1[\s\S]+RETURNING/i],
    [
      'state',
      'takeByState',
      intent.state,
      /DELETE FROM adapt\.slack_link_intents[\s\S]+WHERE state = \$1[\s\S]+RETURNING/i,
    ],
  ] as const)('atomically consumes by %s with DELETE RETURNING', async (_label, method, value, sql) => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [rowFor(intent)] })
      .mockResolvedValueOnce({ rows: [] });
    const store = new LakebaseDurableSlackLinkIntentStore({ query }, 'adapt.slack_link_intents');

    await expect(store[method](value)).resolves.toEqual(intent);
    await expect(store[method](value)).resolves.toBeNull();
    expect(query.mock.calls[0]?.[0]).toMatch(sql);
    expect(query.mock.calls[0]?.[1]).toEqual([value]);
  });

  it('fails closed on conflicts, malformed rows, and unsafe table identifiers', async () => {
    const conflict = new LakebaseDurableSlackLinkIntentStore(
      { query: vi.fn().mockResolvedValue({ rows: [] }) },
      'adapt.slack_link_intents'
    );
    await expect(conflict.put(intent)).rejects.toThrow('could not be stored');

    const malformed = new LakebaseDurableSlackLinkIntentStore(
      { query: vi.fn().mockResolvedValue({ rows: [{ ...rowFor(intent), state: '' }] }) },
      'adapt.slack_link_intents'
    );
    await expect(malformed.readByState(intent.state)).rejects.toThrow();

    expect(
      () =>
        new LakebaseDurableSlackLinkIntentStore(
          { query: vi.fn() },
          'adapt.slack_link_intents; DROP TABLE slack_user_links'
        )
    ).toThrow('table name is invalid');
  });

  it('does not query for empty lookup keys', async () => {
    const query = vi.fn();
    const store = new LakebaseDurableSlackLinkIntentStore({ query }, 'adapt.slack_link_intents');

    await expect(store.readByState(' ')).resolves.toBeNull();
    await expect(store.take(' ')).resolves.toBeNull();
    await expect(store.takeByState(' ')).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
