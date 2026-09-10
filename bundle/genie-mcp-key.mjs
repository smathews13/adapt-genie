#!/usr/bin/env node
import crypto from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';

function valueAfter(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return process.argv[index + 1];
}

function encoded(value) {
  return Buffer.from(value).toString('base64url');
}

function privateKey(value) {
  return crypto.createPrivateKey({
    key: Buffer.from(value.trim(), 'base64url'),
    format: 'der',
    type: 'pkcs8',
  });
}

function publicValue(privateValue) {
  return encoded(crypto.createPublicKey(privateKey(privateValue)).export({ format: 'der', type: 'spki' }));
}

async function protectedWrite(path, value) {
  await writeFile(path, value, { encoding: 'utf8', mode: 0o600 });
  await chmod(path, 0o600);
}

async function generate() {
  const privateFile = valueAfter('--private-json');
  const publicFile = valueAfter('--public-file');
  const scope = valueAfter('--scope');
  const key = valueAfter('--key');
  const { privateKey: generated } = crypto.generateKeyPairSync('ed25519');
  const privateValue = encoded(generated.export({ format: 'der', type: 'pkcs8' }));
  await protectedWrite(privateFile, `${JSON.stringify({ scope, key, string_value: privateValue })}\n`);
  await protectedWrite(publicFile, `${publicValue(privateValue)}\n`);
}

async function derive() {
  const secretFile = valueAfter('--secret-json');
  const publicFile = valueAfter('--public-file');
  const body = JSON.parse(await readFile(secretFile, 'utf8'));
  if (typeof body.value !== 'string' || !body.value) throw new Error('secret response has no value');
  const privateValue = Buffer.from(body.value, 'base64').toString('utf8').trim();
  await protectedWrite(publicFile, `${publicValue(privateValue)}\n`);
}

try {
  if (process.argv[2] === 'generate') await generate();
  else if (process.argv[2] === 'derive') await derive();
  else throw new Error('expected generate or derive');
} catch (error) {
  console.error(`Genie MCP key helper failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
