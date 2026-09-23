import { createHash } from 'node:crypto';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';

import {
  InMemoryLinkIntentStore,
  consumeSlackLinkIntent,
  createSlackLinkIntent,
  slackLinkUrl,
} from './slack-link-intent';

const CREATED_AT = new Date('2026-09-21T10:00:00.000Z');
const CALLBACK = 'https://app.example.com/oauth/callback';
const WORKSPACE = 'https://dbc-test.cloud.databricks.com';

async function create(store: InMemoryLinkIntentStore, ttlMs = 60_000) {
  return createSlackLinkIntent(
    {
      slackTeamId: 'T_TEST',
      slackUserId: 'U_TEST',
      databricksWorkspace: WORKSPACE,
      databricksAudience: 'databricks',
      redirectUri: CALLBACK,
      now: CREATED_AT,
      ttlMs,
    },
    store
  );
}

describe('Slack link URL', () => {
  it('contains one opaque state and no Slack or Databricks identity values', () => {
    const url = slackLinkUrl('https://adapt.example/app', { state: 'opaque-state-value' });
    const parsed = new URL(url);
    expect([...parsed.searchParams.keys()]).toEqual(['state']);
    expect(parsed.searchParams.get('state')).toBe('opaque-state-value');
    expect(url).not.toContain('T_TEST');
    expect(url).not.toContain('U_TEST');
    expect(url).not.toContain('dbc-test');
  });
});

function callback(intentId: string, state: string) {
  return {
    intentId,
    state,
    redirectUri: CALLBACK,
    databricksWorkspace: WORKSPACE,
    databricksAudience: 'databricks',
    now: new Date(CREATED_AT.getTime() + 1_000),
  };
}

describe('Slack OAuth PKCE link intents', () => {
  it('generates S256 PKCE, nonce/state, and token-free persistable metadata', async () => {
    const store = new InMemoryLinkIntentStore();
    const created = await create(store);
    const verifier = created.verifier.value();

    expect(verifier.length).toBeGreaterThan(43);
    expect(created.codeChallenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(created.metadata.state).not.toBe(created.metadata.nonce);
    expect(JSON.stringify(created.metadata)).not.toContain(verifier);
    expect(JSON.stringify(created.verifier)).not.toContain(verifier);
    expect(inspect(created.verifier)).not.toContain(verifier);
  });

  it('consumes a matching intent exactly once', async () => {
    const store = new InMemoryLinkIntentStore();
    const created = await create(store);
    const first = await consumeSlackLinkIntent(callback(created.metadata.id, created.metadata.state), store);
    const replay = await consumeSlackLinkIntent(callback(created.metadata.id, created.metadata.state), store);

    expect(first).toMatchObject({ ok: true, intent: { id: created.metadata.id } });
    expect(replay).toEqual({
      ok: false,
      reason: 'intent_not_found',
      message: 'The link intent is missing or already used.',
    });
  });

  it('invalidates an intent after a state mismatch', async () => {
    const store = new InMemoryLinkIntentStore();
    const created = await create(store);

    expect(await consumeSlackLinkIntent(callback(created.metadata.id, 'wrong-state'), store)).toMatchObject({
      ok: false,
      reason: 'state_mismatch',
    });
    expect(await consumeSlackLinkIntent(callback(created.metadata.id, created.metadata.state), store)).toMatchObject({
      ok: false,
      reason: 'intent_not_found',
    });
  });

  it('rejects expired, redirect-mismatched, workspace-mismatched, and audience-mismatched intents', async () => {
    const expiredStore = new InMemoryLinkIntentStore();
    const expired = await create(expiredStore, 500);
    const redirectStore = new InMemoryLinkIntentStore();
    const redirect = await create(redirectStore);
    const workspaceStore = new InMemoryLinkIntentStore();
    const workspace = await create(workspaceStore);
    const audienceStore = new InMemoryLinkIntentStore();
    const audience = await create(audienceStore);

    expect(
      await consumeSlackLinkIntent(callback(expired.metadata.id, expired.metadata.state), expiredStore)
    ).toMatchObject({
      ok: false,
      reason: 'intent_expired',
    });
    expect(
      await consumeSlackLinkIntent(
        {
          ...callback(redirect.metadata.id, redirect.metadata.state),
          redirectUri: 'https://other.example.com/callback',
        },
        redirectStore
      )
    ).toMatchObject({ ok: false, reason: 'redirect_mismatch' });
    expect(
      await consumeSlackLinkIntent(
        {
          ...callback(workspace.metadata.id, workspace.metadata.state),
          databricksWorkspace: 'https://dbc-other.cloud.databricks.com',
        },
        workspaceStore
      )
    ).toMatchObject({ ok: false, reason: 'workspace_mismatch' });
    expect(
      await consumeSlackLinkIntent(
        { ...callback(audience.metadata.id, audience.metadata.state), databricksAudience: 'other' },
        audienceStore
      )
    ).toMatchObject({ ok: false, reason: 'audience_mismatch' });
  });
});
