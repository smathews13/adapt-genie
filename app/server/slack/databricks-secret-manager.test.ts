import { createHash } from 'node:crypto';
import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';

import type { TokenReference } from '../../shared/channel/delegated-identity';
import { RuntimePkceVerifier } from '../lib/slack-link-intent';
import {
  DatabricksSecretManagerPkceVerifierStore,
  RuntimeDatabricksSecret,
  secretKeyForReference,
  type DatabricksSecretManager,
  type DatabricksSecretRecord,
} from './databricks-secret-manager';

const NOW = new Date('2026-10-01T10:00:00.000Z');
const VERIFIER = 'raw-pkce-verifier-never-persist-in-lakebase';
const reference: TokenReference = {
  id: 'pkce-reference-1',
  provider: 'oauth-link-secret-store',
  fingerprint: createHash('sha256').update(VERIFIER).digest('base64url'),
};

function manager() {
  const records = new Map<string, DatabricksSecretRecord>();
  const putSecret = vi.fn((key: string, secret: RuntimeDatabricksSecret, expiresAt: string | null): Promise<void> => {
    records.set(key, { secret, expiresAt });
    return Promise.resolve();
  });
  const readSecret = vi.fn(
    (key: string): Promise<DatabricksSecretRecord | null> => Promise.resolve(records.get(key) ?? null)
  );
  const takeSecret = vi.fn((key: string): Promise<DatabricksSecretRecord | null> => {
    const value = records.get(key) ?? null;
    records.delete(key);
    return Promise.resolve(value);
  });
  const deleteSecret = vi.fn((key: string): Promise<void> => {
    records.delete(key);
    return Promise.resolve();
  });
  const secretManager: DatabricksSecretManager = {
    putSecret,
    readSecret,
    takeSecret,
    deleteSecret,
  };
  return { records, secretManager, putSecret, takeSecret };
}

describe('DatabricksSecretManagerPkceVerifierStore', () => {
  it('stores the verifier only through the supplied secret manager and consumes it once', async () => {
    const state = manager();
    const store = new DatabricksSecretManagerPkceVerifierStore(state.secretManager, {
      namespace: 'adapt/slack/pkce',
      now: () => NOW,
    });
    const verifier = new RuntimePkceVerifier(VERIFIER, reference);

    await store.put(verifier, '2026-10-01T10:10:00.000Z');

    expect(state.putSecret).toHaveBeenCalledOnce();
    const [key, secret, expiresAt] = state.putSecret.mock.calls[0] ?? [];
    expect(key).toMatch(/^adapt\/slack\/pkce\/[A-Za-z0-9_-]+\/verifier$/);
    expect(key).not.toContain(reference.id);
    expect(secret?.value()).toBe(VERIFIER);
    expect(expiresAt).toBe('2026-10-01T10:10:00.000Z');

    const taken = await store.take(reference);
    expect(taken?.value()).toBe(VERIFIER);
    await expect(store.take(reference)).resolves.toBeNull();
    expect(state.takeSecret).toHaveBeenCalledTimes(2);
  });

  it('rejects expired input and fingerprint mismatches before writing', async () => {
    const state = manager();
    const store = new DatabricksSecretManagerPkceVerifierStore(state.secretManager, { now: () => NOW });
    const mismatch = new RuntimePkceVerifier('different-secret', reference);

    await expect(store.put(mismatch, '2026-10-01T10:10:00.000Z')).rejects.toThrow('does not match');
    await expect(store.put(new RuntimePkceVerifier(VERIFIER, reference), '2026-10-01T09:59:59.000Z')).rejects.toThrow(
      'expiration is invalid'
    );
    expect(state.putSecret).not.toHaveBeenCalled();
  });

  it('atomically burns expired or corrupted records without returning secret material', async () => {
    const state = manager();
    const store = new DatabricksSecretManagerPkceVerifierStore(state.secretManager, {
      namespace: 'adapt/slack/pkce',
      now: () => NOW,
    });
    const key = secretKeyForReference('adapt/slack/pkce', reference, 'verifier');
    state.records.set(key, {
      secret: new RuntimeDatabricksSecret('tampered-verifier'),
      expiresAt: '2026-10-01T10:10:00.000Z',
    });

    await expect(store.take(reference)).resolves.toBeNull();
    expect(state.records.has(key)).toBe(false);

    state.records.set(key, {
      secret: new RuntimeDatabricksSecret(VERIFIER),
      expiresAt: '2026-10-01T09:59:59.000Z',
    });
    await expect(store.take(reference)).resolves.toBeNull();
    expect(state.records.has(key)).toBe(false);
  });

  it('redacts secret material from JSON and inspection', () => {
    const secret = new RuntimeDatabricksSecret(VERIFIER);

    expect(JSON.stringify(secret)).toBe('{"kind":"databricks-secret","redacted":true}');
    expect(JSON.stringify(secret)).not.toContain(VERIFIER);
    expect(inspect(secret)).not.toContain(VERIFIER);
    expect(secret.value()).toBe(VERIFIER);
  });

  it('rejects unsafe namespaces and key parts', () => {
    const state = manager();
    expect(
      () => new DatabricksSecretManagerPkceVerifierStore(state.secretManager, { namespace: '../outside' })
    ).toThrow('namespace is invalid');
    expect(() => secretKeyForReference('adapt/slack', reference, '../token')).toThrow('part is invalid');
  });
});
