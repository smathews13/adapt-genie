import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import {
  RuntimeDatabricksSecret,
  type DatabricksSecretManager,
  type DatabricksSecretRecord,
} from './databricks-secret-manager';
import { SLACK_BROKER_SECRETS_TABLE } from './schema';
import type { SlackStore } from './state-store';

interface SecretEnvelope {
  version: 1;
  value: string;
  expiresAt: string | null;
}

function keyHash(logicalKey: string): string {
  return createHash('sha256').update(logicalKey, 'utf8').digest('hex');
}

function encryptionKey(value: string): Buffer {
  const decoded = Buffer.from(value.trim(), 'base64');
  if (decoded.length !== 32) throw new Error('Slack broker encryption key must be 32 base64-encoded bytes.');
  return decoded;
}

function text(row: Record<string, unknown>, key: string): string {
  return typeof row[key] === 'string' ? row[key] : '';
}

export class LakebaseEncryptedSecretManager implements DatabricksSecretManager {
  readonly #store: SlackStore;
  readonly #key: Buffer;

  constructor(store: SlackStore, encodedKey: string) {
    this.#store = store;
    this.#key = encryptionKey(encodedKey);
  }

  async putSecret(key: string, secret: RuntimeDatabricksSecret, expiresAt: string | null): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    const plaintext = Buffer.from(
      JSON.stringify({ version: 1, value: secret.value(), expiresAt } satisfies SecretEnvelope)
    );
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    await this.#store.query(
      `INSERT INTO ${SLACK_BROKER_SECRETS_TABLE}
         (key_hash, ciphertext, initialization_vector, authentication_tag, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key_hash) DO UPDATE
          SET ciphertext = EXCLUDED.ciphertext,
              initialization_vector = EXCLUDED.initialization_vector,
              authentication_tag = EXCLUDED.authentication_tag,
              expires_at = EXCLUDED.expires_at,
              updated_at = now()`,
      [
        keyHash(key),
        ciphertext.toString('base64'),
        iv.toString('base64'),
        cipher.getAuthTag().toString('base64'),
        expiresAt,
      ]
    );
  }

  async readSecret(key: string): Promise<DatabricksSecretRecord | null> {
    const result = await this.#store.query(
      `SELECT ciphertext, initialization_vector, authentication_tag, expires_at
         FROM ${SLACK_BROKER_SECRETS_TABLE}
        WHERE key_hash = $1`,
      [keyHash(key)]
    );
    return result.rows[0] ? this.#decrypt(result.rows[0]) : null;
  }

  async takeSecret(key: string): Promise<DatabricksSecretRecord | null> {
    const result = await this.#store.query(
      `DELETE FROM ${SLACK_BROKER_SECRETS_TABLE}
        WHERE key_hash = $1
      RETURNING ciphertext, initialization_vector, authentication_tag, expires_at`,
      [keyHash(key)]
    );
    return result.rows[0] ? this.#decrypt(result.rows[0]) : null;
  }

  async deleteSecret(key: string): Promise<void> {
    await this.#store.query(`DELETE FROM ${SLACK_BROKER_SECRETS_TABLE} WHERE key_hash = $1`, [keyHash(key)]);
  }

  #decrypt(row: Record<string, unknown>): DatabricksSecretRecord {
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.#key,
        Buffer.from(text(row, 'initialization_vector'), 'base64')
      );
      decipher.setAuthTag(Buffer.from(text(row, 'authentication_tag'), 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(text(row, 'ciphertext'), 'base64')),
        decipher.final(),
      ]);
      const parsed = JSON.parse(plaintext.toString('utf8')) as Partial<SecretEnvelope>;
      if (
        parsed.version !== 1 ||
        typeof parsed.value !== 'string' ||
        (parsed.expiresAt !== null && typeof parsed.expiresAt !== 'string')
      ) {
        throw new Error('invalid envelope');
      }
      return { secret: new RuntimeDatabricksSecret(parsed.value), expiresAt: parsed.expiresAt };
    } catch {
      throw new Error('Slack broker secret could not be decrypted.');
    }
  }
}
