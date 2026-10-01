import { createHash } from 'node:crypto';

import { mintAppScopeToken } from '../lib/ops-scope-check';
import {
  RuntimeDatabricksSecret,
  type DatabricksSecretManager,
  type DatabricksSecretRecord,
} from './databricks-secret-manager';

interface StoredSecretEnvelope {
  version: 1;
  value: string;
  expiresAt: string | null;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function keyFor(logicalKey: string): string {
  return `slack-obo-${createHash('sha256').update(logicalKey).digest('hex')}`;
}

/**
 * Databricks Secrets-backed broker storage.
 *
 * Values are available only to the app service principal through the approved
 * scope. Lakebase stores opaque references and safe status metadata only.
 */
export class WorkspaceDatabricksSecretManager implements DatabricksSecretManager {
  readonly #scope: string;
  readonly #fetch: typeof fetch;
  readonly #token: (signal: AbortSignal) => Promise<{ host: string; token: string }>;

  constructor(input: {
    scope: string;
    fetchImpl?: typeof fetch;
    tokenProvider?: (signal: AbortSignal) => Promise<{ host: string; token: string }>;
  }) {
    const scope = input.scope.trim();
    if (!scope || scope.length > 128) throw new Error('Databricks broker secret scope is invalid.');
    this.#scope = scope;
    this.#fetch = input.fetchImpl ?? fetch;
    this.#token = input.tokenProvider ?? ((signal) => mintAppScopeToken(signal));
  }

  async putSecret(key: string, secret: RuntimeDatabricksSecret, expiresAt: string | null): Promise<void> {
    const envelope: StoredSecretEnvelope = { version: 1, value: secret.value(), expiresAt };
    await this.#request('/api/2.0/secrets/put', {
      method: 'POST',
      body: JSON.stringify({
        scope: this.#scope,
        key: keyFor(key),
        string_value: JSON.stringify(envelope),
      }),
    });
  }

  async readSecret(key: string): Promise<DatabricksSecretRecord | null> {
    const response = await this.#request(
      `/api/2.0/secrets/get?scope=${encodeURIComponent(this.#scope)}&key=${encodeURIComponent(keyFor(key))}`,
      { method: 'GET' },
      true
    );
    if (!response) return null;
    const payload = object(await response.json().catch(() => null));
    const encoded = typeof payload?.value === 'string' ? payload.value : '';
    if (!encoded) throw new Error('Databricks broker secret response was invalid.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    } catch {
      throw new Error('Databricks broker secret response was invalid.');
    }
    const envelope = object(parsed);
    if (
      envelope?.version !== 1 ||
      typeof envelope.value !== 'string' ||
      (envelope.expiresAt !== null && typeof envelope.expiresAt !== 'string')
    ) {
      throw new Error('Databricks broker secret response was invalid.');
    }
    return {
      secret: new RuntimeDatabricksSecret(envelope.value),
      expiresAt: envelope.expiresAt,
    };
  }

  async takeSecret(key: string): Promise<DatabricksSecretRecord | null> {
    // The Lakebase intent is atomically consumed before this method is reached,
    // so only one callback can take the verifier. Delete immediately after read.
    const record = await this.readSecret(key);
    if (!record) return null;
    await this.deleteSecret(key);
    return record;
  }

  async deleteSecret(key: string): Promise<void> {
    await this.#request(
      '/api/2.0/secrets/delete',
      {
        method: 'POST',
        body: JSON.stringify({ scope: this.#scope, key: keyFor(key) }),
      },
      true
    );
  }

  async #request(
    path: string,
    init: { method: 'GET' | 'POST'; body?: string },
    missingIsNull = false
  ): Promise<Response | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), 15_000);
    try {
      const credential = await this.#token(controller.signal);
      const response = await this.#fetch(`${credential.host}${path}`, {
        method: init.method,
        headers: {
          authorization: `Bearer ${credential.token}`,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
        },
        body: init.body,
        signal: controller.signal,
      });
      if (missingIsNull && response.status === 404) return null;
      if (!response.ok) throw new Error('Databricks broker secret operation failed.');
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}
