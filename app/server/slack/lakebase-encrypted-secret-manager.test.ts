import { describe, expect, it, vi } from 'vitest';
import { RuntimeDatabricksSecret } from './databricks-secret-manager';
import { LakebaseEncryptedSecretManager } from './lakebase-encrypted-secret-manager';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('Lakebase encrypted Slack broker storage', () => {
  it('persists ciphertext and never sends plaintext or logical keys to Lakebase', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const manager = new LakebaseEncryptedSecretManager({ query }, KEY);
    await manager.putSecret('logical/token/reference', new RuntimeDatabricksSecret('raw-token-value'), null);
    const wire = JSON.stringify(query.mock.calls);
    expect(wire).not.toContain('logical/token/reference');
    expect(wire).not.toContain('raw-token-value');
    expect(wire).toContain('slack_broker_secrets');
  });

  it('round-trips and atomically takes encrypted material', async () => {
    let row: Record<string, unknown> | null = null;
    const query = vi.fn((sql: string, params: unknown[] = []) => {
      if (sql.startsWith('INSERT')) {
        row = {
          ciphertext: params[1],
          initialization_vector: params[2],
          authentication_tag: params[3],
          expires_at: params[4],
        };
        return Promise.resolve({ rows: [] });
      }
      if (sql.startsWith('DELETE') && sql.includes('RETURNING')) {
        const returned = row;
        row = null;
        return Promise.resolve({ rows: returned ? [returned] : [] });
      }
      return Promise.resolve({ rows: row ? [row] : [] });
    });
    const manager = new LakebaseEncryptedSecretManager({ query }, KEY);
    await manager.putSecret('credential', new RuntimeDatabricksSecret('secret-value'), '2026-10-02T00:00:00Z');
    expect((await manager.takeSecret('credential'))?.secret.value()).toBe('secret-value');
    expect(await manager.takeSecret('credential')).toBeNull();
  });
});
