import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';

import type { BrokeredCredentialMetadata, SlackUserLinkMetadata } from '../../shared/channel/delegated-identity';
import {
  RuntimeBrokeredCredential,
  UnavailableDatabricksTokenBroker,
  type DatabricksTokenBroker,
} from './databricks-token-broker';
import { APP_SERVICE_PRINCIPAL, SIGNED_IN_USER } from './identity-binding';
import { resolveSlackDelegatedIdentity } from './slack-delegated-identity';

const ACCESS_TOKEN = 'dapi-never-serialize-this-token';
const SUBJECT_EMAIL = 'person@example.com';
const WORKSPACE = 'https://dbc-test.cloud.databricks.com';
const NOW = new Date('2026-09-21T10:00:00.000Z');
const tokenReference = {
  id: 'credential-ref',
  provider: 'test-broker',
  fingerprint: 'token-fingerprint',
};
const link: SlackUserLinkMetadata = {
  id: 'link-1',
  slackTeamId: 'T_TEST',
  slackUserId: 'U_TEST',
  databricksWorkspace: WORKSPACE,
  databricksAudience: 'databricks',
  databricksSubjectFingerprint: 'subject-fingerprint',
  tokenReference,
  status: 'active',
  createdAt: '2026-09-21T09:00:00.000Z',
  updatedAt: '2026-09-21T09:00:00.000Z',
  expiresAt: '2026-09-21T12:00:00.000Z',
  revokedAt: null,
};
const metadata: BrokeredCredentialMetadata = {
  tokenReference,
  tokenStatus: {
    state: 'active',
    expiresAt: '2026-09-21T11:00:00.000Z',
    revokedAt: null,
    checkedAt: NOW.toISOString(),
  },
  workspace: WORKSPACE,
  audience: 'databricks',
  subjectFingerprint: link.databricksSubjectFingerprint,
  subjectKind: 'opaque',
  issuerBackedSubjectVerified: true,
};
const registration = {
  id: 'slack-test',
  environment: 'test' as const,
  slackTeamId: 'T_TEST',
  allowedDatabricksWorkspaces: [WORKSPACE],
};

function brokerWith(
  overrides: Partial<BrokeredCredentialMetadata> = {},
  subjectEmail = SUBJECT_EMAIL
): DatabricksTokenBroker {
  return {
    broker: () =>
      Promise.resolve({
        ok: true,
        credential: new RuntimeBrokeredCredential(ACCESS_TOKEN, subjectEmail, { ...metadata, ...overrides }),
      }),
  };
}

function resolve(overrides: Partial<Parameters<typeof resolveSlackDelegatedIdentity>[0]> = {}) {
  return resolveSlackDelegatedIdentity({
    installationSlackTeamId: 'T_TEST',
    link,
    registration,
    expectedDatabricksWorkspace: WORKSPACE,
    expectedDatabricksAudience: 'databricks',
    broker: brokerWith(),
    requestId: 'req-11111111-1111-4111-8111-111111111111',
    correlationId: 'req-22222222-2222-4222-8222-222222222222',
    now: NOW,
    ...overrides,
  });
}

describe('Slack delegated Databricks identity', () => {
  it('returns an existing-compatible signed-in-user identity only after issuer-backed proof', async () => {
    const decision = await resolve();

    expect(decision).toEqual({
      ok: true,
      email: SUBJECT_EMAIL,
      token: ACCESS_TOKEN,
      verified: true,
      mode: SIGNED_IN_USER,
      requestId: 'req-11111111-1111-4111-8111-111111111111',
      correlationId: 'req-22222222-2222-4222-8222-222222222222',
    });
    expect(decision.ok && decision.mode).not.toBe(APP_SERVICE_PRINCIPAL);
  });

  it('fails closed when the production broker is unavailable', async () => {
    const decision = await resolve({ broker: new UnavailableDatabricksTokenBroker() });

    expect(decision).toEqual({
      ok: false,
      reason: 'broker_unavailable',
      message: 'Delegated Databricks credentials are unavailable.',
    });
  });

  it.each([
    ['wrong installation', { installationSlackTeamId: 'T_PROD' }, 'registration_not_allowed'],
    [
      'workspace outside allowlist',
      { expectedDatabricksWorkspace: 'https://dbc-other.cloud.databricks.com' },
      'target_workspace_not_allowed',
    ],
    ['audience mismatch', { expectedDatabricksAudience: 'other-audience' }, 'audience_mismatch'],
    ['expired link', { link: { ...link, expiresAt: '2026-09-21T09:59:59.000Z' } }, 'link_expired'],
    [
      'revoked link',
      { link: { ...link, status: 'revoked' as const, revokedAt: '2026-09-21T09:30:00.000Z' } },
      'link_revoked',
    ],
  ])('blocks %s', async (_label, overrides, reason) => {
    const decision = await resolve(overrides);
    expect(decision).toMatchObject({ ok: false, reason });
  });

  it('rejects expired, revoked, mismatched, and unverified broker results', async () => {
    const missing = await resolve({
      broker: brokerWith({
        tokenStatus: { ...metadata.tokenStatus, state: 'unavailable' },
      }),
    });
    const expired = await resolve({
      broker: brokerWith({
        tokenStatus: { ...metadata.tokenStatus, state: 'expired' },
      }),
    });
    const revoked = await resolve({
      broker: brokerWith({
        tokenStatus: { ...metadata.tokenStatus, state: 'revoked', revokedAt: NOW.toISOString() },
      }),
    });
    const mismatched = await resolve({ broker: brokerWith({ subjectFingerprint: 'other-fingerprint' }) });
    const opaqueUnverified = await resolve({ broker: brokerWith({ issuerBackedSubjectVerified: false }) });

    expect(missing).toMatchObject({ ok: false, reason: 'token_missing' });
    expect(expired).toMatchObject({ ok: false, reason: 'token_expired' });
    expect(revoked).toMatchObject({ ok: false, reason: 'token_revoked' });
    expect(mismatched).toMatchObject({ ok: false, reason: 'subject_mismatch' });
    expect(opaqueUnverified).toMatchObject({ ok: false, reason: 'subject_unverified' });
  });

  it('never serializes or inspects runtime bearer material', () => {
    const credential = new RuntimeBrokeredCredential(ACCESS_TOKEN, SUBJECT_EMAIL, metadata);
    const serialized = JSON.stringify(credential);
    const inspected = inspect(credential);

    expect(() => new RuntimeBrokeredCredential(' ', SUBJECT_EMAIL, metadata)).toThrow('empty credential material');
    expect(() => new RuntimeBrokeredCredential(ACCESS_TOKEN, ' ', metadata)).toThrow('no verified credential subject');
    expect(serialized).not.toContain(ACCESS_TOKEN);
    expect(inspected).not.toContain(ACCESS_TOKEN);
    expect(serialized).not.toContain(SUBJECT_EMAIL);
    expect(inspected).not.toContain(SUBJECT_EMAIL);
    expect(serialized).toContain(tokenReference.id);
    expect(credential.verifiedSubjectEmail()).toBe(SUBJECT_EMAIL);
  });

  it('keeps secret values out of all blocked error messages', async () => {
    const leakingBlockedBroker: DatabricksTokenBroker = {
      broker: () =>
        Promise.resolve({
          ok: false,
          reason: 'token_missing',
          message: `broker failed for ${ACCESS_TOKEN}`,
        }),
    };
    const throwingBroker: DatabricksTokenBroker = {
      broker: () => Promise.reject(new Error(`broker failed for ${ACCESS_TOKEN}`)),
    };
    const decisions = await Promise.all([
      resolve({ broker: new UnavailableDatabricksTokenBroker() }),
      resolve({ broker: brokerWith({ issuerBackedSubjectVerified: false }) }),
      resolve({ broker: brokerWith({ subjectFingerprint: 'other-fingerprint' }) }),
      resolve({ broker: leakingBlockedBroker }),
      resolve({ broker: throwingBroker }),
    ]);

    expect(JSON.stringify(decisions)).not.toContain(ACCESS_TOKEN);
    expect(decisions[3]).toMatchObject({ ok: false, reason: 'token_missing' });
    expect(decisions[4]).toMatchObject({ ok: false, reason: 'broker_unavailable' });
  });
});
