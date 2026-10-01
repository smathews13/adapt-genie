import { describe, expect, it, vi } from 'vitest';
import { hashSlackIdentifier, type SlackRuntimeConfig } from './config';
import { LakebaseSlackLinkWriter } from './lakebase-link-writer';

const config: SlackRuntimeConfig = {
  environment: 'test',
  enabled: true,
  killSwitch: false,
  allowedTeamId: 'TALLOWED',
  allowedTeamHash: hashSlackIdentifier('TALLOWED'),
  databricksWorkspaceHost: 'https://example.cloud.databricks.com',
  oauthExpectedAudience: 'adapt',
  oauthClientId: 'oauth-client',
  oauthClientSecretRef: 'OAUTH_CLIENT_SECRET',
  oauthCallbackUrl: 'https://adapt.example/api/slack/oauth/callback',
  publicBaseUrl: 'https://adapt.example',
  tokenBrokerRef: 'adapt-slack-broker',
  brokerEncryptionKeyRef: 'BROKER_KEY',
  appTokenSecretRef: 'APP_TOKEN',
  botTokenSecretRef: 'BOT_TOKEN',
  registrationId: 'registration-test',
  testRegistrationId: 'registration-test',
  productionRegistrationId: 'registration-production',
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

describe('Lakebase Slack link writer', () => {
  it('persists only opaque broker references after a proven exchange', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ link_id: 'link-1' }] });
    const writer = new LakebaseSlackLinkWriter({ query }, config, { revoke: vi.fn() });
    await writer.write({
      actor: { kind: 'broker-proven', ownerHash: 'owner-hash' },
      linkReference: 'link-1',
      intent: {
        id: 'link-1',
        state: 'state-value',
        nonce: 'nonce-value',
        slackTeamId: 'TALLOWED',
        slackUserId: 'U123',
        databricksWorkspace: config.databricksWorkspaceHost,
        databricksAudience: config.oauthExpectedAudience,
        redirectUri: config.oauthCallbackUrl,
        verifierReference: { id: 'pkce-1', provider: 'oauth-link-secret-store', fingerprint: 'fingerprint' },
        createdAt: '2026-10-01T00:00:00.000Z',
        expiresAt: '2026-10-01T00:10:00.000Z',
      },
      exchange: {
        ownerHash: 'owner-hash',
        delegatedIdentityRef: 'credential-1',
        tokenReference: { id: 'credential-1', provider: 'databricks-secret-broker', fingerprint: 'credential-fp' },
        databricksSubjectFingerprint: 'subject-fp',
        expiresAt: '2026-10-01T01:00:00.000Z',
      },
    });
    const wire = JSON.stringify(query.mock.calls);
    expect(wire).toContain('credential-1');
    expect(wire).toContain('credential-fp');
    expect(wire).not.toMatch(/access_token|refresh_token|authorization.?code|nonce-value|state-value/i);
  });

  it('revokes the previous credential before replacing a user link', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            owner_hash: 'owner-hash',
            delegated_identity_ref: 'credential-old',
            token_ref_provider: 'databricks-secret-broker',
            token_ref_fingerprint: 'old-fingerprint',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ link_id: 'link-new' }] });
    const revoke = vi.fn().mockResolvedValue(undefined);
    const writer = new LakebaseSlackLinkWriter({ query }, config, { revoke });
    await writer.write({
      actor: { kind: 'broker-proven', ownerHash: 'owner-hash' },
      linkReference: 'link-new',
      intent: {
        id: 'link-new',
        state: 'state-value',
        nonce: 'nonce-value',
        slackTeamId: 'TALLOWED',
        slackUserId: 'U123',
        databricksWorkspace: config.databricksWorkspaceHost,
        databricksAudience: config.oauthExpectedAudience,
        redirectUri: config.oauthCallbackUrl,
        verifierReference: { id: 'pkce-1', provider: 'oauth-link-secret-store', fingerprint: 'fingerprint' },
        createdAt: '2026-10-01T00:00:00.000Z',
        expiresAt: '2026-10-01T00:10:00.000Z',
      },
      exchange: {
        ownerHash: 'owner-hash',
        delegatedIdentityRef: 'credential-new',
        tokenReference: {
          id: 'credential-new',
          provider: 'databricks-secret-broker',
          fingerprint: 'new-fingerprint',
        },
        databricksSubjectFingerprint: 'subject-fp',
        expiresAt: null,
      },
    });
    expect(revoke.mock.invocationCallOrder[0]).toBeLessThan(query.mock.invocationCallOrder[1] ?? 0);
    expect(revoke).toHaveBeenCalledWith({
      id: 'credential-old',
      provider: 'databricks-secret-broker',
      fingerprint: 'old-fingerprint',
    });
  });

  it('revokes the link before deleting broker-held credential material', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          delegated_identity_ref: 'credential-1',
          token_ref_provider: 'databricks-secret-broker',
          token_ref_fingerprint: 'credential-fp',
        },
      ],
    });
    const revoke = vi.fn().mockResolvedValue(undefined);
    const writer = new LakebaseSlackLinkWriter({ query }, config, { revoke });
    await expect(writer.revoke({ actor: 'person@example.com', linkReference: 'link-1' })).resolves.toBe('revoked');
    expect(revoke).toHaveBeenCalledWith({
      id: 'credential-1',
      provider: 'databricks-secret-broker',
      fingerprint: 'credential-fp',
    });
  });
});
