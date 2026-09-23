import { describe, expect, it } from 'vitest';

import {
  BrokeredCredentialMetadataSchema,
  SlackLinkIntentMetadataSchema,
  SlackUserLinkMetadataSchema,
  TokenReferenceSchema,
} from './delegated-identity';

const tokenReference = {
  id: 'opaque-reference',
  provider: 'test-broker',
  fingerprint: 'sha256-safe-fingerprint',
};

const link = {
  id: 'link-1',
  slackTeamId: 'T_TEST',
  slackUserId: 'U_TEST',
  databricksWorkspace: 'https://dbc-test.cloud.databricks.com',
  databricksAudience: 'databricks',
  databricksSubjectFingerprint: 'subject-fingerprint',
  tokenReference,
  status: 'active' as const,
  createdAt: '2026-09-21T10:00:00.000Z',
  updatedAt: '2026-09-21T10:00:00.000Z',
  expiresAt: '2026-09-21T11:00:00.000Z',
  revokedAt: null,
};

describe('delegated identity persistence contracts', () => {
  it('serializes only opaque references and safe metadata', () => {
    const parsed = SlackUserLinkMetadataSchema.parse(link);
    const wire = JSON.stringify(parsed);

    expect(wire).toContain('opaque-reference');
    expect(wire).not.toContain('person@example.com');
    expect(wire).not.toMatch(/access.?token|refresh.?token|authorization|client.?secret/i);
  });

  it.each([
    ['accessToken', 'dapi-secret'],
    ['refreshToken', 'refresh-secret'],
    ['oauthCode', 'oauth-code-secret'],
    ['codeVerifier', 'verifier-secret'],
    ['slackBotToken', 'xoxb-secret'],
    ['slackAppToken', 'xapp-secret'],
    ['databricksSubjectEmail', 'person@example.com'],
  ])('rejects the raw secret field %s', (field, value) => {
    expect(() => SlackUserLinkMetadataSchema.parse({ ...link, [field]: value })).toThrow();
    expect(() => TokenReferenceSchema.parse({ ...tokenReference, [field]: value })).toThrow();
  });

  it('keeps PKCE verifier material out of persisted link intents', () => {
    const intent = {
      id: 'intent-1',
      state: 'state',
      nonce: 'nonce',
      slackTeamId: 'T_TEST',
      slackUserId: 'U_TEST',
      databricksWorkspace: link.databricksWorkspace,
      databricksAudience: 'databricks',
      redirectUri: 'https://app.example.com/oauth/callback',
      verifierReference: tokenReference,
      createdAt: link.createdAt,
      expiresAt: link.expiresAt,
    };

    expect(SlackLinkIntentMetadataSchema.parse(intent)).toEqual(intent);
    expect(() => SlackLinkIntentMetadataSchema.parse({ ...intent, codeVerifier: 'raw-verifier' })).toThrow();
  });

  it('rejects raw bearer material from broker metadata', () => {
    const metadata = {
      tokenReference,
      tokenStatus: {
        state: 'active' as const,
        expiresAt: link.expiresAt,
        revokedAt: null,
        checkedAt: link.createdAt,
      },
      workspace: link.databricksWorkspace,
      audience: 'databricks',
      subjectFingerprint: link.databricksSubjectFingerprint,
      subjectKind: 'opaque' as const,
      issuerBackedSubjectVerified: true,
    };

    expect(BrokeredCredentialMetadataSchema.parse(metadata)).toEqual(metadata);
    expect(() => BrokeredCredentialMetadataSchema.parse({ ...metadata, accessToken: 'dapi-secret' })).toThrow();
    expect(() => BrokeredCredentialMetadataSchema.parse({ ...metadata, subjectEmail: 'person@example.com' })).toThrow();
  });
});
