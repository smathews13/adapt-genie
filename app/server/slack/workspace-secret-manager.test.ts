import { describe, expect, it, vi } from 'vitest';
import { RuntimeDatabricksSecret } from './databricks-secret-manager';
import { WorkspaceDatabricksSecretManager } from './workspace-secret-manager';

describe('workspace Databricks secret manager', () => {
  it('stores opaque envelopes without putting logical keys or values in URLs', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const manager = new WorkspaceDatabricksSecretManager({
      scope: 'adapt-slack-broker',
      fetchImpl,
      tokenProvider: vi.fn().mockResolvedValue({ host: 'https://example.cloud.databricks.com', token: 'app-token' }),
    });
    await manager.putSecret('slack-obo/pkce/reference/verifier', new RuntimeDatabricksSecret('secret-value'), null);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = typeof init.body === 'string' ? init.body : '';
    expect(url).toBe('https://example.cloud.databricks.com/api/2.0/secrets/put');
    expect(url).not.toContain('reference');
    expect(body).not.toContain('slack-obo/pkce/reference/verifier');
    expect(body).toContain('secret-value');
    expect(init.headers).toMatchObject({ authorization: 'Bearer app-token' });
  });

  it('decodes a secret and deletes it on one-time take', async () => {
    const encoded = Buffer.from(JSON.stringify({ version: 1, value: 'pkce-value', expiresAt: null })).toString(
      'base64'
    );
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: encoded }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const manager = new WorkspaceDatabricksSecretManager({
      scope: 'adapt-slack-broker',
      fetchImpl,
      tokenProvider: vi.fn().mockResolvedValue({ host: 'https://example.cloud.databricks.com', token: 'app-token' }),
    });
    const record = await manager.takeSecret('logical-key');
    expect(record?.secret.value()).toBe('pkce-value');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe('https://example.cloud.databricks.com/api/2.0/secrets/delete');
  });
});
