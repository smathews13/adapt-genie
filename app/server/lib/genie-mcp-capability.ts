import crypto from 'node:crypto';

export const GENIE_MCP_CAPABILITY_ENV = 'ADAPT_GENIE_MCP_SIGNING_PRIVATE_KEY';
export const GENIE_MCP_CAPABILITY_VERSION = 1;
export const GENIE_MCP_CAPABILITY_PURPOSE = 'genie:mcp';
export const GENIE_MCP_CAPABILITY_TTL_SECONDS = 30;

export interface GenieMcpCapabilityClaims {
  v: 1;
  aud: string;
  purpose: typeof GENIE_MCP_CAPABILITY_PURPOSE;
  sub: string;
  request_id: string;
  iat: number;
  exp: number;
  transport: 'mcp';
  kid: string;
}

export interface GenieMcpCapability {
  claims: GenieMcpCapabilityClaims;
  signature: string;
}

function base64Url(value: Buffer): string {
  return value.toString('base64url');
}

/** RFC-8785-compatible for this contract's strings, integers, and objects. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('Capability numbers must be safe integers.');
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  throw new Error('Capability contains an unsupported value.');
}

export function capabilityKeyId(publicKey: crypto.KeyObject): string {
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return base64Url(crypto.createHash('sha256').update(der).digest().subarray(0, 16));
}

export function publicKeyDer(privateKeyValue: string): string {
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(privateKeyValue.trim(), 'base64url'),
    format: 'der',
    type: 'pkcs8',
  });
  return base64Url(crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }));
}

export function generatePrivateKeyValue(): string {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  return base64Url(privateKey.export({ format: 'der', type: 'pkcs8' }));
}

export function issueGenieMcpCapability(input: {
  privateKeyValue?: string;
  audience: string;
  user: string;
  requestId: string;
  now?: Date;
}): GenieMcpCapability | null {
  const privateKeyValue = input.privateKeyValue ?? process.env[GENIE_MCP_CAPABILITY_ENV] ?? '';
  const audience = input.audience.trim();
  const subject = input.user.trim().toLocaleLowerCase('en-US');
  const requestId = input.requestId.trim();
  if (!privateKeyValue.trim() || !audience || !subject || !requestId) return null;

  try {
    const privateKey = crypto.createPrivateKey({
      key: Buffer.from(privateKeyValue.trim(), 'base64url'),
      format: 'der',
      type: 'pkcs8',
    });
    if (privateKey.asymmetricKeyType !== 'ed25519') return null;
    const publicKey = crypto.createPublicKey(privateKey);
    const iat = Math.floor((input.now ?? new Date()).getTime() / 1000);
    const claims: GenieMcpCapabilityClaims = {
      v: GENIE_MCP_CAPABILITY_VERSION,
      aud: audience,
      purpose: GENIE_MCP_CAPABILITY_PURPOSE,
      sub: subject,
      request_id: requestId,
      iat,
      exp: iat + GENIE_MCP_CAPABILITY_TTL_SECONDS,
      transport: 'mcp',
      kid: capabilityKeyId(publicKey),
    };
    const signature = crypto.sign(null, Buffer.from(canonicalJson(claims), 'utf8'), privateKey);
    return { claims, signature: base64Url(signature) };
  } catch {
    return null;
  }
}
