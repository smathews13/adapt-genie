import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { canonicalJson, generatePrivateKeyValue, issueGenieMcpCapability, publicKeyDer } from './genie-mcp-capability';

describe('Genie MCP app capability', () => {
  it('signs a short-lived request-bound Ed25519 grant without returning the private key', () => {
    const privateKeyValue = generatePrivateKeyValue();
    const capability = issueGenieMcpCapability({
      privateKeyValue,
      audience: 'adapt-orchestrator',
      user: 'Admin@Example.Test',
      requestId: 'req-123',
      now: new Date('2026-09-10T05:00:00Z'),
    });

    expect(capability).toMatchObject({
      claims: {
        v: 1,
        aud: 'adapt-orchestrator',
        purpose: 'genie:mcp',
        sub: 'admin@example.test',
        request_id: 'req-123',
        iat: 1789016400,
        exp: 1789016430,
        transport: 'mcp',
      },
    });
    expect(JSON.stringify(capability)).not.toContain(privateKeyValue);

    const publicKey = crypto.createPublicKey({
      key: Buffer.from(publicKeyDer(privateKeyValue), 'base64url'),
      format: 'der',
      type: 'spki',
    });
    expect(
      crypto.verify(
        null,
        Buffer.from(canonicalJson(capability?.claims), 'utf8'),
        publicKey,
        Buffer.from(capability?.signature ?? '', 'base64url')
      )
    ).toBe(true);
  });

  it('fails closed when signing material or request bindings are absent', () => {
    expect(
      issueGenieMcpCapability({
        privateKeyValue: '',
        audience: 'adapt-orchestrator',
        user: 'admin@example.test',
        requestId: 'req-123',
      })
    ).toBeNull();
    expect(
      issueGenieMcpCapability({
        privateKeyValue: generatePrivateKeyValue(),
        audience: '',
        user: 'admin@example.test',
        requestId: 'req-123',
      })
    ).toBeNull();
  });
});
