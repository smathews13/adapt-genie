import { describe, expect, it, vi } from 'vitest';
import { SlackAdmissionController } from './admission';
import { RuntimeBrokeredCredential } from '../lib/databricks-token-broker';
import { createDefaultSlackEventProcessor, createSlackEventProcessor } from './event-processor';
import { SafeSlackDirectMessage } from './socket-mode-adapter';
import type { SlackRuntimeConfig } from './config';
import type { SlackDelivery } from './state-store';

const event = new SafeSlackDirectMessage({
  workspaceHash: 'w',
  eventHash: 'e',
  userHash: 'u',
  channelHash: 'c',
  threadHash: 't',
  messageTimestampHash: 'm',
  runtime: {
    teamId: 'team',
    userId: 'user',
    channelId: 'channel',
    threadId: 'thread',
    messageTimestamp: '123.456',
    prompt: 'memory only',
  },
});

const admission = () =>
  new SlackAdmissionController({
    globalConcurrency: 1,
    workspaceConcurrency: 1,
    userConcurrency: 1,
    conversationConcurrency: 1,
    globalPerMinute: 10,
    workspacePerMinute: 10,
    userPerMinute: 10,
    conversationPerMinute: 10,
  });

const config: SlackRuntimeConfig = {
  environment: 'test',
  enabled: true,
  killSwitch: false,
  allowedTeamId: 'team',
  allowedTeamHash: 'w',
  databricksWorkspaceHost: 'https://adapt.cloud.databricks.com',
  oauthExpectedAudience: 'adapt',
  oauthClientId: 'oauth-client',
  oauthCallbackUrl: 'https://adapt.example/api/slack/oauth/callback',
  publicBaseUrl: 'https://adapt.example',
  tokenBrokerRef: 'broker-registration',
  appTokenSecretRef: 'APP_TOKEN',
  botTokenSecretRef: 'BOT_TOKEN',
  clientSecretRef: 'CLIENT_SECRET',
  signingSecretRef: 'SIGNING_SECRET',
  registrationId: 'registration-1',
  testRegistrationId: 'registration-1',
  productionRegistrationId: 'registration-2',
  caps: {
    globalConcurrency: 1,
    workspaceConcurrency: 1,
    userConcurrency: 1,
    conversationConcurrency: 1,
    globalPerMinute: 10,
    workspacePerMinute: 10,
    userPerMinute: 10,
    conversationPerMinute: 10,
  },
};

describe('Slack event processor', () => {
  it.each(['completed', 'failed'])(
    'returns an existing %s event without starting a new run before expiry',
    async (status) => {
      const query = vi.fn().mockResolvedValue({
        rows: [
          {
            claimed: false,
            status,
            run_id: 'run-1',
            delivery_id: 'delivery-1',
            expires_at: '2026-09-22T00:00:00.000Z',
          },
        ],
      });
      const startRun = vi.fn();
      const audit = vi.fn();
      const process = createSlackEventProcessor({
        store: { query },
        environment: 'test',
        admission: admission(),
        audit,
        resolveIdentity: vi.fn(),
        startRun,
      });
      await expect(process(event)).resolves.toEqual({
        outcome: 'deduped',
        runId: 'run-1',
        deliveryId: 'delivery-1',
      });
      expect(startRun).not.toHaveBeenCalled();
      expect(audit).toHaveBeenCalledWith(expect.objectContaining({ event: 'deduped', runId: 'run-1' }));
    }
  );

  it('does not start a second run when an expired dedup claim still has a delivery', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            claimed: true,
            status: 'claimed',
            run_id: null,
            delivery_id: null,
            expires_at: '2026-09-23T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            delivery_id: 'delivery-1',
            run_id: 'run-1',
            channel_hash: 'c',
            thread_hash: 't',
            status: 'failed',
            message_id: null,
            attempt_count: 1,
            revision: 2,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ event_hash: 'e' }] });
    const startRun = vi.fn();
    const process = createSlackEventProcessor({
      store: { query },
      environment: 'test',
      admission: admission(),
      audit: vi.fn(),
      resolveIdentity: vi.fn(),
      startRun,
    });
    await expect(process(event)).resolves.toEqual({
      outcome: 'deduped',
      runId: 'run-1',
      deliveryId: 'delivery-1',
    });
    expect(startRun).not.toHaveBeenCalled();
  });

  it('records an identity denial without persisting the prompt', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            claimed: true,
            status: 'claimed',
            run_id: null,
            delivery_id: null,
            expires_at: '2026-09-22T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ event_hash: 'e' }] });
    const audit = vi.fn();
    const process = createSlackEventProcessor({
      store: { query },
      environment: 'test',
      admission: admission(),
      audit,
      resolveIdentity: vi.fn().mockResolvedValue({ allowed: false, safeErrorClass: 'link_missing' }),
      startRun: vi.fn(),
    });
    await expect(process(event)).resolves.toEqual({ outcome: 'identity_denied' });
    expect(JSON.stringify(query.mock.calls)).not.toContain('memory only');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ event: 'identity_denied' }));
  });

  it('posts an unlinked link-out delivery without creating a governed run', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            claimed: true,
            status: 'claimed',
            run_id: null,
            delivery_id: null,
            expires_at: '2026-09-22T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            created: true,
            delivery_id: 'blocked-delivery',
            run_id: null,
            channel_hash: 'c',
            thread_hash: 't',
            status: 'pending',
            delivery_kind: 'link_out',
            delivery_state: 'pending',
            safe_error_class: null,
            message_id: null,
            attempt_count: 0,
            revision: 1,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ event_hash: 'e' }] });
    const startRun = vi.fn();
    const deliverBlocked = vi.fn().mockResolvedValue({
      deliveryId: 'blocked-delivery',
      runId: null,
      channelHash: 'c',
      threadHash: 't',
      status: 'sent',
      deliveryKind: 'link_out',
      deliveryState: 'final_sent',
      safeErrorClass: null,
      messageId: 'message-1',
      attemptCount: 1,
      revision: 2,
    });
    const process = createSlackEventProcessor({
      store: { query },
      environment: 'test',
      admission: admission(),
      audit: vi.fn(),
      resolveIdentity: vi.fn().mockResolvedValue({ allowed: false, safeErrorClass: 'link_missing' }),
      startRun,
      deliverBlocked,
    });
    await expect(process(event)).resolves.toEqual({ outcome: 'identity_denied' });
    expect(startRun).not.toHaveBeenCalled();
    const blockedInput = deliverBlocked.mock.calls[0]?.[0] as
      | { safeErrorClass: string; delivery: { runId: string | null; deliveryKind: string } }
      | undefined;
    expect(blockedInput?.safeErrorClass).toBe('link_missing');
    expect(blockedInput?.delivery).toMatchObject({ runId: null, deliveryKind: 'link_out' });
    expect(JSON.stringify(query.mock.calls)).not.toContain('memory only');
  });

  it('settles a missing link-out URL as transient-failed without orphaning the claim', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            claimed: true,
            status: 'claimed',
            run_id: null,
            delivery_id: null,
            expires_at: '2026-09-22T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            created: true,
            delivery_id: 'blocked-delivery',
            run_id: null,
            channel_hash: 'c',
            thread_hash: 't',
            status: 'pending',
            delivery_kind: 'link_out',
            delivery_state: 'pending',
            safe_error_class: null,
            message_id: null,
            attempt_count: 0,
            revision: 1,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            delivery_id: 'blocked-delivery',
            run_id: null,
            channel_hash: 'c',
            thread_hash: 't',
            status: 'failed',
            delivery_kind: 'link_out',
            delivery_state: 'transient_failed',
            safe_error_class: 'link_out_unavailable',
            message_id: null,
            attempt_count: 1,
            revision: 2,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ event_hash: 'e' }] });
    const audit = vi.fn();
    const process = createSlackEventProcessor({
      store: { query },
      environment: 'test',
      admission: admission(),
      audit,
      resolveIdentity: vi.fn().mockResolvedValue({ allowed: false, safeErrorClass: 'link_missing' }),
      startRun: vi.fn(),
      deliverBlocked: vi.fn().mockRejectedValue(new Error('app URL missing')),
    });
    await expect(process(event)).resolves.toEqual({ outcome: 'identity_denied' });
    expect(query.mock.calls[3]?.[0]).toContain('delivery_state = $7');
    expect(query.mock.calls[3]?.[1]).toContain('transient_failed');
    expect(query.mock.calls[4]?.[1]).toContain('link_out_unavailable');
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'delivery_failed', safeErrorClass: 'link_out_unavailable' })
    );
  });

  it('reposts only a transient-failed prior delivery and never starts another run', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            claimed: false,
            status: 'failed',
            run_id: 'run-1',
            delivery_id: 'delivery-1',
            expires_at: '2026-09-22T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            delivery_id: 'delivery-1',
            run_id: 'run-1',
            channel_hash: 'c',
            thread_hash: 't',
            status: 'failed',
            delivery_kind: 'run',
            delivery_state: 'transient_failed',
            safe_error_class: 'ratelimited',
            message_id: null,
            attempt_count: 3,
            revision: 4,
          },
        ],
      });
    const startRun = vi.fn();
    const resumeDelivery = vi.fn();
    const process = createSlackEventProcessor({
      store: { query },
      environment: 'test',
      admission: admission(),
      audit: vi.fn(),
      resolveIdentity: vi.fn(),
      startRun,
      resumeDelivery,
    });
    await expect(process(event)).resolves.toMatchObject({
      outcome: 'deduped',
      runId: 'run-1',
      deliveryId: 'delivery-1',
    });
    expect(resumeDelivery).toHaveBeenCalledOnce();
    expect(startRun).not.toHaveBeenCalled();
  });

  it('submits once, creates one delivery, then enters delivery without serializing the prompt', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            claimed: true,
            status: 'claimed',
            run_id: null,
            delivery_id: null,
            expires_at: '2026-09-22T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            created: true,
            delivery_id: 'delivery-1',
            run_id: 'run-1',
            channel_hash: 'c',
            thread_hash: 't',
            status: 'pending',
            delivery_kind: 'run',
            delivery_state: 'pending',
            safe_error_class: null,
            message_id: null,
            attempt_count: 0,
            revision: 1,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ event_hash: 'e' }] });
    const startRun = vi.fn().mockResolvedValue({ runId: 'run-1', owner: 'reader@example.com' });
    const deliverRun = vi.fn().mockResolvedValue({
      deliveryId: 'delivery-1',
      runId: 'run-1',
      channelHash: 'c',
      threadHash: 't',
      status: 'sent',
      deliveryKind: 'run',
      deliveryState: 'final_sent',
      safeErrorClass: null,
      messageId: 'message-1',
      attemptCount: 1,
      revision: 2,
    });
    const process = createSlackEventProcessor({
      store: { query },
      environment: 'test',
      admission: admission(),
      audit: vi.fn(),
      resolveIdentity: vi.fn().mockResolvedValue({
        allowed: true,
        ownerHash: 'owner-hash',
        delegatedIdentityRef: 'token-ref',
      }),
      startRun,
      deliverRun,
    });
    await expect(process(event)).resolves.toEqual({ outcome: 'admitted', runId: 'run-1' });
    expect(startRun).toHaveBeenCalledOnce();
    expect(deliverRun).toHaveBeenCalledWith(expect.objectContaining({ owner: 'reader@example.com' }));
    expect(JSON.stringify(query.mock.calls)).not.toContain('memory only');
  });

  it('composes identity, owner binding, governed submit, and delivery end to end', async () => {
    const now = '2026-09-21T20:00:00.000Z';
    // The fake mirrors an asynchronous Lakebase client while dispatching from SQL text.
    // eslint-disable-next-line @typescript-eslint/require-await
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO player_insights.slack_event_dedup')) {
        return {
          rows: [{ claimed: true, status: 'claimed', run_id: null, delivery_id: null, expires_at: now }],
        };
      }
      if (sql.includes('FROM player_insights.slack_deliveries')) return { rows: [] };
      if (sql.includes('FROM player_insights.slack_installations')) {
        return {
          rows: [
            {
              installation_id: 'installation-1',
              environment: 'test',
              workspace_hash: 'w',
              registration_id: 'registration-1',
              status: 'active',
              bot_user_hash: null,
              bot_token_ref: 'BOT_TOKEN',
              app_token_ref: 'APP_TOKEN',
              client_secret_ref: null,
              signing_secret_ref: null,
              granted_scopes: ['chat:write', 'im:history'],
              granted_scopes_hash: 'scope-hash',
              revision: 1,
            },
          ],
        };
      }
      if (sql.includes('FROM player_insights.slack_user_links')) {
        return {
          rows: [
            {
              link_id: 'link-1',
              environment: 'test',
              workspace_hash: 'w',
              slack_user_hash: 'u',
              owner_hash: 'owner-hash',
              delegated_identity_ref: 'token-ref',
              token_ref_provider: 'test-broker',
              token_ref_fingerprint: 'token-fingerprint',
              databricks_subject_fingerprint: 'subject-fingerprint',
              databricks_workspace: config.databricksWorkspaceHost,
              databricks_audience: 'adapt',
              status: 'active',
              created_at: now,
              updated_at: now,
              expires_at: null,
              revoked_at: null,
              revision: 1,
            },
          ],
        };
      }
      if (sql.includes('INSERT INTO player_insights.slack_conversation_bindings')) {
        return {
          rows: [
            {
              created: true,
              binding_id: 'binding-1',
              environment: 'test',
              workspace_hash: 'w',
              channel_hash: 'c',
              thread_hash: 't',
              owner_hash: 'owner-hash',
              app_conversation_id: 'slack-conversation-deterministic',
              status: 'active',
              revision: 1,
            },
          ],
        };
      }
      if (sql.includes('INSERT INTO player_insights.slack_deliveries')) {
        return {
          rows: [
            {
              created: true,
              delivery_id: 'delivery-1',
              run_id: 'run-1',
              channel_hash: 'c',
              thread_hash: 't',
              status: 'pending',
              delivery_kind: 'run',
              delivery_state: 'pending',
              safe_error_class: null,
              message_id: null,
              attempt_count: 0,
              revision: 1,
            },
          ],
        };
      }
      return { rows: [{ event_hash: 'e' }] };
    });
    const submit = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      runId: 'run-1',
      conversationId: 'slack-conversation-deterministic',
      state: 'running',
      createdAt: now,
      updatedAt: now,
      correlationId: null,
      answer: null,
      clarification: null,
      blocked: null,
      error: null,
    });
    const deliverRun = vi.fn().mockResolvedValue({
      deliveryId: 'delivery-1',
      runId: 'run-1',
      channelHash: 'c',
      threadHash: 't',
      status: 'sent',
      deliveryKind: 'run',
      deliveryState: 'final_sent',
      safeErrorClass: null,
      messageId: 'message-1',
      attemptCount: 1,
      revision: 2,
    });
    const process = createDefaultSlackEventProcessor({
      store: { query },
      config,
      governedRuns: { submit, get: vi.fn() },
      delivery: { deliverRun, deliverLinkOut: vi.fn() },
      audit: vi.fn(),
      expectedAudience: 'adapt',
      broker: {
        broker: vi.fn().mockResolvedValue({
          ok: true,
          credential: new RuntimeBrokeredCredential('dapi-runtime-only', 'reader@example.com', {
            tokenReference: {
              id: 'token-ref',
              provider: 'test-broker',
              fingerprint: 'token-fingerprint',
            },
            tokenStatus: { state: 'active', expiresAt: null, revokedAt: null, checkedAt: now },
            workspace: config.databricksWorkspaceHost,
            audience: 'adapt',
            subjectFingerprint: 'subject-fingerprint',
            subjectKind: 'email',
            issuerBackedSubjectVerified: true,
          }),
        }),
      },
      linkOutUrl: vi.fn(),
    });
    await expect(process(event)).resolves.toEqual({ outcome: 'admitted', runId: 'run-1' });
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      prompt: 'memory only',
      idempotencyKey: 'slack:e',
      externalContext: {
        source: 'slack',
        slackWorkspaceIdHash: 'w',
        slackEventIdHash: 'e',
      },
    });
    expect(submit.mock.calls[0]?.[1]).toMatchObject({
      email: 'reader@example.com',
      verified: true,
      mode: 'signed_in_user',
    });
    expect(deliverRun).toHaveBeenCalledOnce();
    expect(JSON.stringify(query.mock.calls)).not.toContain('memory only');
    expect(JSON.stringify(query.mock.calls)).not.toContain('dapi-runtime-only');
  });

  it('re-brokers a duplicate retry and fetches the existing run by verified email without submit', async () => {
    const now = '2026-09-21T20:00:00.000Z';
    const query = vi.fn((sql: string) => {
      if (sql.includes('INSERT INTO player_insights.slack_event_dedup')) {
        return Promise.resolve({
          rows: [
            {
              claimed: false,
              status: 'failed',
              run_id: 'run-1',
              delivery_id: 'delivery-1',
              expires_at: now,
            },
          ],
        });
      }
      if (sql.includes('FROM player_insights.slack_deliveries')) {
        return Promise.resolve({
          rows: [
            {
              delivery_id: 'delivery-1',
              run_id: 'run-1',
              channel_hash: 'c',
              thread_hash: 't',
              status: 'failed',
              delivery_kind: 'run',
              delivery_state: 'transient_failed',
              safe_error_class: 'ratelimited',
              message_id: null,
              attempt_count: 1,
              revision: 2,
            },
          ],
        });
      }
      if (sql.includes('FROM player_insights.slack_installations')) {
        return Promise.resolve({
          rows: [
            {
              installation_id: 'installation-1',
              environment: 'test',
              workspace_hash: 'w',
              registration_id: 'registration-1',
              status: 'active',
              bot_user_hash: null,
              bot_token_ref: 'BOT_TOKEN',
              app_token_ref: 'APP_TOKEN',
              client_secret_ref: null,
              signing_secret_ref: null,
              granted_scopes: ['chat:write', 'im:history'],
              granted_scopes_hash: 'scope-hash',
              revision: 1,
            },
          ],
        });
      }
      if (sql.includes('FROM player_insights.slack_user_links')) {
        return Promise.resolve({
          rows: [
            {
              link_id: 'link-1',
              environment: 'test',
              workspace_hash: 'w',
              slack_user_hash: 'u',
              owner_hash: 'not-an-email-owner-hash',
              delegated_identity_ref: 'token-ref',
              token_ref_provider: 'test-broker',
              token_ref_fingerprint: 'token-fingerprint',
              databricks_subject_fingerprint: 'subject-fingerprint',
              databricks_workspace: config.databricksWorkspaceHost,
              databricks_audience: 'adapt',
              status: 'active',
              created_at: now,
              updated_at: now,
              expires_at: null,
              revoked_at: null,
              revision: 1,
            },
          ],
        });
      }
      return Promise.resolve({ rows: [{ event_hash: 'e' }] });
    });
    const submit = vi.fn();
    const get = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      runId: 'run-1',
      conversationId: 'conversation-1',
      state: 'complete',
      createdAt: now,
      updatedAt: now,
      correlationId: null,
      answer: null,
      clarification: null,
      blocked: null,
      error: null,
    });
    const delivered: SlackDelivery = {
      deliveryId: 'delivery-1',
      runId: 'run-1',
      channelHash: 'c',
      threadHash: 't',
      status: 'sent',
      deliveryKind: 'run',
      deliveryState: 'final_sent',
      safeErrorClass: null,
      messageId: 'message-1',
      attemptCount: 2,
      revision: 3,
    };
    const deliverRun = vi.fn(async (input: { delivery: SlackDelivery; owner: string }) => {
      await get(input.delivery.runId, input.owner);
      return delivered;
    });
    const broker = vi.fn().mockResolvedValue({
      ok: true,
      credential: new RuntimeBrokeredCredential('runtime-token', 'verified@example.com', {
        tokenReference: { id: 'token-ref', provider: 'test-broker', fingerprint: 'token-fingerprint' },
        tokenStatus: { state: 'active', expiresAt: null, revokedAt: null, checkedAt: now },
        workspace: config.databricksWorkspaceHost,
        audience: 'adapt',
        subjectFingerprint: 'subject-fingerprint',
        subjectKind: 'email',
        issuerBackedSubjectVerified: true,
      }),
    });
    const process = createDefaultSlackEventProcessor({
      store: { query },
      config,
      governedRuns: { submit, get },
      delivery: { deliverRun, deliverLinkOut: vi.fn() },
      audit: vi.fn(),
      expectedAudience: 'adapt',
      broker: { broker },
      linkOutUrl: vi.fn(),
    });

    await expect(process(event)).resolves.toMatchObject({
      outcome: 'deduped',
      runId: 'run-1',
      deliveryId: 'delivery-1',
    });
    expect(broker).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith('run-1', 'verified@example.com');
    expect(get).not.toHaveBeenCalledWith('run-1', 'not-an-email-owner-hash');
  });
});
