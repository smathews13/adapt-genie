import { createHash, timingSafeEqual } from 'node:crypto';
import { inspect } from 'node:util';

import type { TokenReference } from '../../shared/channel/delegated-identity';
import { RuntimePkceVerifier } from '../lib/slack-link-intent';
import type { DurablePkceVerifierStore } from './oauth-service';

/**
 * A secret value that can only be deliberately unwrapped by a secret-manager
 * implementation. Accidental JSON serialization and diagnostic inspection are
 * always redacted.
 */
export class RuntimeDatabricksSecret {
  readonly #value: string;

  constructor(value: string) {
    if (!value) throw new Error('Secret material is empty.');
    this.#value = value;
  }

  value(): string {
    return this.#value;
  }

  toJSON(): { kind: 'databricks-secret'; redacted: true } {
    return { kind: 'databricks-secret', redacted: true };
  }

  [inspect.custom](): string {
    return 'RuntimeDatabricksSecret <redacted>';
  }
}

export interface DatabricksSecretRecord {
  secret: RuntimeDatabricksSecret;
  expiresAt: string | null;
}

/**
 * Minimal boundary implemented by the production Databricks secret manager.
 *
 * `takeSecret` must atomically read and delete a value. That guarantee is what
 * makes PKCE verifiers single-use across app processes.
 */
export interface DatabricksSecretManager {
  putSecret(key: string, secret: RuntimeDatabricksSecret, expiresAt: string | null): Promise<void>;
  readSecret(key: string): Promise<DatabricksSecretRecord | null>;
  takeSecret(key: string): Promise<DatabricksSecretRecord | null>;
  deleteSecret(key: string): Promise<void>;
}

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function sameFingerprint(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function safeNamespace(value: string): string {
  const namespace = value.trim().replace(/^\/+|\/+$/g, '');
  const segments = namespace.split('/');
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(namespace) ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('Secret namespace is invalid.');
  }
  return namespace;
}

export function secretKeyForReference(namespace: string, reference: TokenReference, part: string): string {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(part)) throw new Error('Secret part is invalid.');
  const opaqueId = createHash('sha256').update(reference.id).digest('base64url');
  return `${safeNamespace(namespace)}/${opaqueId}/${part}`;
}

export interface DatabricksSecretManagerPkceVerifierStoreOptions {
  namespace?: string;
  now?: () => Date;
}

/** Durable one-time PKCE storage backed exclusively by the supplied secret manager. */
export class DatabricksSecretManagerPkceVerifierStore implements DurablePkceVerifierStore {
  readonly #secretManager: DatabricksSecretManager;
  readonly #namespace: string;
  readonly #now: () => Date;

  constructor(secretManager: DatabricksSecretManager, options: DatabricksSecretManagerPkceVerifierStoreOptions = {}) {
    this.#secretManager = secretManager;
    this.#namespace = safeNamespace(options.namespace ?? 'slack-obo/pkce');
    this.#now = options.now ?? (() => new Date());
  }

  async put(verifier: RuntimePkceVerifier, expiresAt: string): Promise<void> {
    const expiration = new Date(expiresAt);
    if (!Number.isFinite(expiration.getTime()) || expiration.getTime() <= this.#now().getTime()) {
      throw new Error('PKCE verifier expiration is invalid.');
    }
    if (!sameFingerprint(fingerprint(verifier.value()), verifier.reference.fingerprint)) {
      throw new Error('PKCE verifier reference does not match the secret.');
    }
    await this.#secretManager.putSecret(
      secretKeyForReference(this.#namespace, verifier.reference, 'verifier'),
      new RuntimeDatabricksSecret(verifier.value()),
      expiration.toISOString()
    );
  }

  async take(reference: TokenReference): Promise<RuntimePkceVerifier | null> {
    const key = secretKeyForReference(this.#namespace, reference, 'verifier');
    const record = await this.#secretManager.takeSecret(key);
    if (!record) return null;
    if (
      (record.expiresAt !== null && Date.parse(record.expiresAt) <= this.#now().getTime()) ||
      !sameFingerprint(fingerprint(record.secret.value()), reference.fingerprint)
    ) {
      return null;
    }
    return new RuntimePkceVerifier(record.secret.value(), reference);
  }
}
