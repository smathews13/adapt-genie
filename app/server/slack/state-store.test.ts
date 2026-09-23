import { describe, expect, it, vi } from 'vitest';
import {
  claimSlackEvent,
  cleanupExpiredSlackEvents,
  createSlackConversationBinding,
  createSlackDelivery,
  createSlackInstallation,
  createSlackUserLink,
  readSlackConversationBinding,
  readSlackInstallation,
  resolveOrCreateSlackConversationBinding,
  recordSlackDeliveryAttempt,
} from './state-store';

describe('Slack state stores', () => {
  it('refuses cross-environment installations before touching Lakebase', async () => {
    const query = vi.fn();
    await expect(
      createSlackInstallation(
        { query },
        {
          environment: 'production',
          expectedEnvironment: 'test',
          expectedRegistrationId: 'test-registration',
          registrationId: 'production-registration',
          workspaceHash: 'workspace-hash',
          botUserHash: null,
          botTokenRef: 'secret://test/bot-token',
          appTokenRef: 'secret://test/app-token',
          clientSecretRef: 'secret://test/client-secret',
          signingSecretRef: 'secret://test/signing-secret',
          grantedScopes: ['chat:write', 'im:history'],
        }
      )
    ).resolves.toEqual({ outcome: 'environment_mismatch' });
    expect(query).not.toHaveBeenCalled();
  });

  it('stores only installation secret references and canonical granted scopes', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          installation_id: 'installation-1',
          environment: 'test',
          workspace_hash: 'workspace',
          registration_id: 'registration-test',
          status: 'active',
          bot_user_hash: 'bot-hash',
          bot_token_ref: 'secret://test/bot',
          app_token_ref: 'secret://test/app',
          client_secret_ref: null,
          signing_secret_ref: 'secret://test/signing',
          granted_scopes: ['chat:write', 'im:history'],
          granted_scopes_hash: 'scope-hash',
          revision: 1,
        },
      ],
    });
    await createSlackInstallation(
      { query },
      {
        environment: 'test',
        expectedEnvironment: 'test',
        expectedRegistrationId: 'registration-test',
        registrationId: 'registration-test',
        workspaceHash: 'workspace',
        botUserHash: 'bot-hash',
        botTokenRef: 'secret://test/bot',
        appTokenRef: 'secret://test/app',
        clientSecretRef: null,
        signingSecretRef: 'secret://test/signing',
        grantedScopes: ['im:history', 'chat:write', 'chat:write'],
      }
    );
    expect(query.mock.calls[0]?.[1]).toContain('secret://test/bot');
    expect(query.mock.calls[0]?.[1]).not.toEqual(expect.arrayContaining(['xoxb-value', 'xapp-value']));
    expect(query.mock.calls[0]?.[1]).toContain(JSON.stringify(['chat:write', 'im:history']));
  });

  it('refuses token values passed where opaque installation references belong', async () => {
    const query = vi.fn();
    await expect(
      createSlackInstallation(
        { query },
        {
          environment: 'test',
          expectedEnvironment: 'test',
          expectedRegistrationId: 'registration-test',
          registrationId: 'registration-test',
          workspaceHash: 'workspace',
          botUserHash: null,
          botTokenRef: 'xoxb-value',
          appTokenRef: 'xapp-value',
          clientSecretRef: null,
          signingSecretRef: null,
          grantedScopes: [],
        }
      )
    ).resolves.toEqual({ outcome: 'invalid_secret_reference' });
    expect(query).not.toHaveBeenCalled();
  });

  it('treats an uninstalled or revoked installation as absent', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(
      readSlackInstallation(
        { query },
        {
          environment: 'production',
          workspaceHash: 'workspace-hash',
        }
      )
    ).resolves.toBeNull();
    expect(query.mock.calls[0]?.[0]).toContain("status = 'active'");
    expect(query.mock.calls[0]?.[1]).toEqual(['production', 'workspace-hash']);
  });

  it('claims dedup keys with one atomic statement and returns the existing run on retry', async () => {
    const expiresAt = '2026-09-22T00:00:00.000Z';
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ claimed: true, status: 'claimed', run_id: null, delivery_id: null, expires_at: expiresAt }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            claimed: false,
            status: 'completed',
            run_id: 'run-1',
            delivery_id: 'delivery-1',
            expires_at: expiresAt,
          },
        ],
      });
    const store = { query };
    const input = {
      environment: 'test' as const,
      workspaceHash: 'workspace',
      eventHash: 'event',
      eventKind: 'message.im' as const,
    };
    expect(await claimSlackEvent(store, input)).toEqual({
      claimed: true,
      status: 'claimed',
      runId: null,
      deliveryId: null,
      expiresAt,
    });
    expect(await claimSlackEvent(store, input)).toEqual({
      claimed: false,
      status: 'completed',
      runId: 'run-1',
      deliveryId: 'delivery-1',
      expiresAt,
    });
    expect(query.mock.calls[0]?.[0]).toMatch(/ON CONFLICT[\s\S]+DO UPDATE[\s\S]+RETURNING/i);
    expect(query.mock.calls[0]?.[0]).toContain('expires_at');
    expect(query.mock.calls[0]?.[0]).toContain('expires_at <=');
  });

  it('atomically reclaims an expired key and clamps retention to seven days', async () => {
    const now = new Date('2026-09-22T00:00:00.000Z');
    const expiresAt = new Date('2026-09-29T00:00:00.000Z');
    const query = vi.fn().mockResolvedValue({
      rows: [{ claimed: true, status: 'claimed', run_id: null, delivery_id: null, expires_at: expiresAt }],
    });
    await expect(
      claimSlackEvent(
        { query },
        {
          environment: 'test',
          workspaceHash: 'workspace',
          eventHash: 'event',
          eventKind: 'message.im',
          now,
          ttlMs: 30 * 24 * 60 * 60 * 1000,
        }
      )
    ).resolves.toMatchObject({ claimed: true, expiresAt: expiresAt.toISOString() });
    expect(query.mock.calls[0]?.[1]).toEqual(['test', 'workspace', 'event', 'message.im', now, expiresAt]);
    expect(query.mock.calls[0]?.[0]).toMatch(/run_id = CASE WHEN[\s\S]+expires_at <= \$5[\s\S]+THEN NULL/);
  });

  it('scopes binding reads to environment, workspace, channel, thread, and owner', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await readSlackConversationBinding(
      { query },
      { environment: 'test', workspaceHash: 'w', channelHash: 'c', threadHash: 't1', ownerHash: 'owner' }
    );
    expect(query.mock.calls[0]?.[0]).toMatch(
      /environment = \$1[\s\S]+workspace_hash = \$2[\s\S]+channel_hash = \$3[\s\S]+thread_hash = \$4[\s\S]+owner_hash = \$5/
    );
    expect(query.mock.calls[0]?.[1]).toEqual(['test', 'w', 'c', 't1', 'owner']);
  });

  it('keeps separate bindings for two threads in the same DM channel', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          binding_id: 'binding',
          environment: 'test',
          workspace_hash: 'w',
          channel_hash: 'c',
          thread_hash: 't',
          owner_hash: 'owner',
          app_conversation_id: 'app-c',
          status: 'active',
          revision: 1,
        },
      ],
    });
    for (const threadHash of ['thread-one', 'thread-two']) {
      await createSlackConversationBinding(
        { query },
        {
          environment: 'test',
          workspaceHash: 'w',
          channelHash: 'same-channel',
          threadHash,
          ownerHash: 'owner',
          appConversationId: `app-${threadHash}`,
        }
      );
    }
    expect(query.mock.calls.map((call) => (call[1] as unknown[])[4])).toEqual(['thread-one', 'thread-two']);
    expect(query.mock.calls[0]?.[0]).toContain(
      'binding_id, environment, workspace_hash, channel_hash, thread_hash, owner_hash'
    );
  });

  it('cleans up expired dedup rows in a bounded indexed batch', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ event_hash: 'e1' }, { event_hash: 'e2' }] });
    await expect(
      cleanupExpiredSlackEvents({ query }, { now: new Date('2026-09-22T00:00:00Z'), limit: 2 })
    ).resolves.toBe(2);
    expect(query.mock.calls[0]?.[0]).toMatch(/WHERE expires_at <= \$1[\s\S]+LIMIT \$2[\s\S]+DELETE FROM/);
    expect(query.mock.calls[0]?.[1]).toEqual([new Date('2026-09-22T00:00:00Z'), 2]);
  });

  it('reuses a delivery and fences retry updates to the original run', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            created: false,
            delivery_id: 'delivery-1',
            run_id: 'run-1',
            channel_hash: 'channel',
            thread_hash: 'thread',
            status: 'failed',
            message_id: null,
            attempt_count: 1,
            revision: 2,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            delivery_id: 'delivery-1',
            run_id: 'run-1',
            channel_hash: 'channel',
            thread_hash: 'thread',
            status: 'sent',
            message_id: 'message-1',
            attempt_count: 2,
            revision: 3,
          },
        ],
      });
    const created = await createSlackDelivery(
      { query },
      {
        environment: 'test',
        workspaceHash: 'w',
        eventHash: 'e',
        channelHash: 'channel',
        threadHash: 'thread',
        userHash: 'u',
        runId: 'new-run-must-not-win',
      }
    );
    expect(created).toMatchObject({ outcome: 'existing', value: { runId: 'run-1' } });
    await recordSlackDeliveryAttempt(
      { query },
      {
        deliveryId: 'delivery-1',
        runId: 'run-1',
        revision: 2,
        status: 'sent',
        messageId: 'message-1',
      }
    );
    expect(query.mock.calls[1]?.[0]).toContain(
      'WHERE delivery_id = $1 AND run_id IS NOT DISTINCT FROM $2 AND revision = $3'
    );
  });

  it('rejects contradictory delivery status/state pairs before storage', async () => {
    const query = vi.fn();
    await expect(
      recordSlackDeliveryAttempt(
        { query },
        {
          deliveryId: 'delivery-1',
          runId: 'run-1',
          revision: 1,
          status: 'sent',
          deliveryState: 'transient_failed',
        }
      )
    ).rejects.toThrow('inconsistent');
    await expect(
      recordSlackDeliveryAttempt(
        { query },
        {
          deliveryId: 'delivery-1',
          runId: 'run-1',
          revision: 1,
          status: 'failed',
          deliveryState: 'final_sent',
        }
      )
    ).rejects.toThrow('inconsistent');
    expect(query).not.toHaveBeenCalled();
  });

  it('stores reconstructible delegated-link metadata without raw identity or tokens', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          link_id: 'link-1',
          environment: 'test',
          workspace_hash: 'workspace-hash',
          slack_user_hash: 'user-hash',
          owner_hash: 'owner-hash',
          delegated_identity_ref: 'token-ref-id',
          token_ref_provider: 'vault',
          token_ref_fingerprint: 'fingerprint',
          databricks_subject_fingerprint: 'subject-fingerprint',
          databricks_workspace: 'https://example.cloud.databricks.com',
          databricks_audience: 'adapt',
          status: 'active',
          created_at: '2026-09-21T20:00:00.000Z',
          updated_at: '2026-09-21T20:00:00.000Z',
          expires_at: null,
          revoked_at: null,
          revision: 1,
        },
      ],
    });
    await createSlackUserLink(
      { query },
      {
        environment: 'test',
        workspaceHash: 'workspace-hash',
        slackUserHash: 'user-hash',
        ownerHash: 'owner-hash',
        delegatedIdentityRef: 'token-ref-id',
        tokenRefProvider: 'vault',
        tokenRefFingerprint: 'fingerprint',
        databricksSubjectFingerprint: 'subject-fingerprint',
        databricksWorkspace: 'https://example.cloud.databricks.com',
        databricksAudience: 'adapt',
        expiresAt: null,
      }
    );
    const serialized = JSON.stringify(query.mock.calls);
    expect(serialized).toContain('token_ref_provider');
    expect(serialized).not.toContain('reader@example.com');
    expect(serialized).not.toContain('dapi');
  });

  it('atomically refuses a thread binding owned by somebody else', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(
      resolveOrCreateSlackConversationBinding(
        { query },
        {
          environment: 'test',
          workspaceHash: 'w',
          channelHash: 'c',
          threadHash: 't',
          ownerHash: 'owner-a',
          appConversationId: 'conversation-a',
        }
      )
    ).resolves.toEqual({ outcome: 'conflict' });
    expect(query.mock.calls[0]?.[0]).toMatch(
      /ON CONFLICT \(environment, workspace_hash, channel_hash, thread_hash\)[\s\S]+owner_hash = EXCLUDED.owner_hash/
    );
  });
});
