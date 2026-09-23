import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import type { SlackLinkIntentMetadata, TokenReference } from '../../shared/channel/delegated-identity';
import type { RuntimePkceVerifier } from '../lib/slack-link-intent';
import type { SlackRuntimeConfig } from './config';
import {
  beginSlackOAuth,
  completeSlackOAuth,
  createSlackOAuthLinkOut,
  RuntimeAuthorizationCode,
  type DurablePkceVerifierStore,
  type DurableSlackLinkIntentStore,
  type SlackLinkWriter,
} from './oauth-service';

const config: SlackRuntimeConfig = {
  environment: 'test',
  enabled: true,
  killSwitch: false,
  allowedTeamId: 'TALLOWED',
  allowedTeamHash: 'hash',
  databricksWorkspaceHost: 'https://example.cloud.databricks.com',
  oauthExpectedAudience: 'adapt',
  oauthClientId: 'oauth-client',
  oauthCallbackUrl: 'https://adapt.example/api/slack/oauth/callback',
  publicBaseUrl: 'https://adapt.example',
  tokenBrokerRef: 'approved-broker',
  appTokenSecretRef: 'APP_TOKEN',
  botTokenSecretRef: 'BOT_TOKEN',
  clientSecretRef: 'CLIENT_SECRET',
  signingSecretRef: 'SIGNING_SECRET',
  registrationId: 'test-registration',
  testRegistrationId: 'test-registration',
  productionRegistrationId: 'production-registration',
  caps: {
    globalConcurrency: 1,
    workspaceConcurrency: 1,
    userConcurrency: 1,
    conversationConcurrency: 1,
    globalPerMinute: 1,
    workspacePerMinute: 1,
    userPerMinute: 1,
    conversationPerMinute: 1,
  },
};

function stores() {
  const intents = new Map<string, SlackLinkIntentMetadata>();
  const verifiers = new Map<string, RuntimePkceVerifier>();
  const intentStore: DurableSlackLinkIntentStore = {
    put: (intent) => {
      intents.set(intent.state, intent);
      return Promise.resolve();
    },
    take: (id) => {
      const intent = [...intents.values()].find((candidate) => candidate.id === id) ?? null;
      if (intent) intents.delete(intent.state);
      return Promise.resolve(intent);
    },
    readByState: (state) => Promise.resolve(intents.get(state) ?? null),
    takeByState: (state) => {
      const intent = intents.get(state) ?? null;
      intents.delete(state);
      return Promise.resolve(intent);
    },
  };
  const verifierStore: DurablePkceVerifierStore = {
    put: (verifier) => {
      verifiers.set(verifier.reference.id, verifier);
      return Promise.resolve();
    },
    take: (reference: TokenReference) => {
      const verifier = verifiers.get(reference.id) ?? null;
      verifiers.delete(reference.id);
      return Promise.resolve(verifier);
    },
  };
  return { intents, intentStore, verifierStore };
}

function writer(): SlackLinkWriter {
  return {
    write: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockResolvedValue('linked'),
    revoke: vi.fn().mockResolvedValue('revoked'),
    uninstall: vi.fn().mockResolvedValue('uninstalled'),
  };
}

const exchangeMetadata = {
  ownerHash: 'owner-hash',
  delegatedIdentityRef: 'token-ref',
  tokenReference: { id: 'token-ref', provider: 'broker', fingerprint: 'fingerprint' },
  databricksSubjectFingerprint: 'subject-fingerprint',
  expiresAt: null,
};

function exchangeProof(overrides: Record<string, unknown> = {}) {
  return {
    issuerVerified: true,
    issuer: config.databricksWorkspaceHost,
    subjectVerified: true,
    audience: config.oauthExpectedAudience,
    clientId: config.oauthClientId,
    workspace: config.databricksWorkspaceHost,
    nonce: '',
    ...overrides,
  };
}

describe('Slack OAuth linking skeleton', () => {
  it('creates an opaque intent and redirects only with durable stores and a broker', async () => {
    const state = stores();
    const linkWriter = writer();
    const broker = {
      exchangeAndStore: vi.fn().mockResolvedValue({
        ok: true,
        metadata: exchangeMetadata,
        proof: exchangeProof(),
      }),
    };
    const created = await createSlackOAuthLinkOut({ slackTeamId: 'TALLOWED', slackUserId: 'U123' }, config, {
      ...state,
      broker,
      linkWriter,
    });
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) return;
    expect(created.url).toMatch(/^https:\/\/adapt\.example\/api\/slack\/link\?state=/);
    expect(created.url).not.toMatch(/TALLOWED|U123|oauth-client|token-ref/);
    const intent = [...state.intents.values()][0];
    if (!intent) throw new Error('intent was not stored');
    const begun = await beginSlackOAuth(intent.state, config, { ...state, broker, linkWriter });
    expect(begun).toMatchObject({ ok: true });
    if (!begun.ok) return;
    expect(new URL(begun.redirect).searchParams.get('code_challenge_method')).toBe('S256');
    expect(new URL(begun.redirect).searchParams.get('nonce')).toBe(intent.nonce);
    expect(new URL(begun.redirect).searchParams.get('scope')).toBe('all-apis offline_access openid profile email');
    expect(new URL(begun.redirect).searchParams.get('redirect_uri')).toBe(config.oauthCallbackUrl);
    expect(new URL(begun.redirect).searchParams.get('state')).toBe(intent.state);
  });

  it('fails closed without the durable store or broker and stores no code or token', async () => {
    await expect(
      createSlackOAuthLinkOut({ slackTeamId: 'TALLOWED', slackUserId: 'U123' }, config, {})
    ).resolves.toEqual({ ok: false, reason: 'store_unavailable' });
    const state = stores();
    await expect(
      createSlackOAuthLinkOut({ slackTeamId: 'TALLOWED', slackUserId: 'U123' }, config, {
        intentStore: state.intentStore,
        verifierStore: state.verifierStore,
      })
    ).resolves.toEqual({ ok: false, reason: 'broker_unavailable' });
    expect(state.intents.size).toBe(0);
  });

  it('accepts the standard state+code callback and requires broker proof before writing the link', async () => {
    const state = stores();
    const linkWriter = writer();
    const broker = {
      exchangeAndStore: vi.fn().mockImplementation((input: { expectedNonce: string }) =>
        Promise.resolve({
          ok: true,
          metadata: exchangeMetadata,
          proof: exchangeProof({ nonce: input.expectedNonce }),
        })
      ),
    };
    const created = await createSlackOAuthLinkOut({ slackTeamId: 'TALLOWED', slackUserId: 'U123' }, config, {
      ...state,
      broker,
      linkWriter,
    });
    if (!created.ok) throw new Error('fixture link-out failed');
    const intent = [...state.intents.values()][0];
    if (!intent) throw new Error('fixture intent missing');
    await expect(
      completeSlackOAuth({ state: intent.state, code: 'code-value' }, config, { ...state, broker, linkWriter })
    ).resolves.toEqual({ ok: true });
    expect(broker.exchangeAndStore).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedNonce: intent.nonce,
        expectedAudience: config.oauthExpectedAudience,
        expectedClientId: config.oauthClientId,
        expectedWorkspace: config.databricksWorkspaceHost,
      })
    );
    expect(linkWriter.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { kind: 'broker-proven', ownerHash: 'owner-hash' },
        linkReference: intent.id,
      })
    );
    await expect(
      completeSlackOAuth({ state: intent.state, code: 'replayed-code' }, config, { ...state, broker, linkWriter })
    ).resolves.toEqual({ ok: false, reason: 'intent_not_found' });
    expect(broker.exchangeAndStore).toHaveBeenCalledOnce();
  });

  it.each([
    ['missing proof', undefined, 'subject_unverified'],
    ['issuer unverified', exchangeProof({ issuerVerified: false }), 'subject_unverified'],
    ['issuer missing', exchangeProof({ issuer: '' }), 'subject_unverified'],
    ['subject unverified', exchangeProof({ subjectVerified: false }), 'subject_unverified'],
    ['wrong audience', exchangeProof({ audience: 'other-audience' }), 'audience_mismatch'],
    ['wrong client', exchangeProof({ clientId: 'other-client' }), 'audience_mismatch'],
    ['wrong workspace', exchangeProof({ workspace: 'https://other.cloud.databricks.com' }), 'workspace_mismatch'],
    ['wrong nonce', exchangeProof({ nonce: 'other-nonce' }), 'nonce_mismatch'],
  ] as const)('refuses broker success with %s', async (_label, proof, reason) => {
    const state = stores();
    const linkWriter = writer();
    const broker = {
      exchangeAndStore: vi.fn().mockImplementation((input: { expectedNonce: string }) =>
        Promise.resolve({
          ok: true,
          metadata: exchangeMetadata,
          ...(proof ? { proof: proof.nonce ? proof : { ...proof, nonce: input.expectedNonce } } : {}),
        })
      ),
    };
    await createSlackOAuthLinkOut({ slackTeamId: 'TALLOWED', slackUserId: 'U123' }, config, {
      ...state,
      broker,
      linkWriter,
    });
    const intent = [...state.intents.values()][0];
    if (!intent) throw new Error('fixture intent missing');
    await expect(
      completeSlackOAuth({ state: intent.state, code: 'code-value' }, config, { ...state, broker, linkWriter })
    ).resolves.toEqual({ ok: false, reason });
    expect(linkWriter.write).not.toHaveBeenCalled();
  });

  it('returns only typed redacted errors when broker exchange throws code-derived detail', async () => {
    const state = stores();
    const linkWriter = writer();
    const broker = {
      exchangeAndStore: vi.fn((input: { authorizationCode: RuntimeAuthorizationCode }) =>
        Promise.reject(new Error(`exchange failed for ${input.authorizationCode.value()}`))
      ),
    };
    await createSlackOAuthLinkOut({ slackTeamId: 'TALLOWED', slackUserId: 'U123' }, config, {
      ...state,
      broker,
      linkWriter,
    });
    const intent = [...state.intents.values()][0];
    if (!intent) throw new Error('fixture intent missing');
    const result = await completeSlackOAuth({ state: intent.state, code: 'sensitive-callback-code' }, config, {
      ...state,
      broker,
      linkWriter,
    });
    expect(result).toEqual({ ok: false, reason: 'broker_unavailable' });
    expect(JSON.stringify(result)).not.toContain('sensitive-callback-code');
    expect(linkWriter.write).not.toHaveBeenCalled();
  });

  it.each([
    ['databricksWorkspaceHost', 'https://forged.cloud.databricks.com', 'workspace_mismatch'],
    ['oauthExpectedAudience', 'wrong-audience', 'audience_mismatch'],
  ] as const)('refuses a forged %s', async (key, value, reason) => {
    const state = stores();
    const dependencies = {
      ...state,
      broker: { exchangeAndStore: vi.fn() },
      linkWriter: writer(),
    };
    await createSlackOAuthLinkOut({ slackTeamId: 'TALLOWED', slackUserId: 'U123' }, config, dependencies);
    const intent = [...state.intents.values()][0];
    if (!intent) throw new Error('fixture intent missing');
    await expect(beginSlackOAuth(intent.state, { ...config, [key]: value }, dependencies)).resolves.toEqual({
      ok: false,
      reason,
    });
  });

  it('redacts authorization codes from JSON, inspection, and logs', () => {
    const code = new RuntimeAuthorizationCode('sensitive-code-value');
    expect(JSON.stringify(code)).not.toContain('sensitive-code-value');
    expect(inspect(code)).not.toContain('sensitive-code-value');
    expect(code.value()).toBe('sensitive-code-value');
  });
});
