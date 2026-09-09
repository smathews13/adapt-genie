import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ASK_STARTER_SETTINGS } from '../../shared/ask-starters';
import { isAdminRoute } from '../lib/admin-roles';
import { setupAskStarterRoutes } from './ask-starter-routes';

let closeServer: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (closeServer) await closeServer();
  closeServer = null;
});

async function start(rows: unknown[] = []) {
  const app = express();
  app.use(express.json());
  const query = vi.fn((sql: string) => {
    if (sql.includes('SELECT settings, revision')) return Promise.resolve({ rows });
    if (sql.includes('INSERT INTO') && sql.includes('ask_starter_settings')) {
      return Promise.resolve({ rows: [{ settings: {}, revision: 1 }] });
    }
    return Promise.resolve({ rows: [] });
  });
  const appkit = {
    lakebase: { query },
    query,
    server: { extend: (register: (application: express.Application) => void) => register(app) },
  };
  setupAskStarterRoutes(appkit as never);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  closeServer = () => new Promise((resolve) => server.close(() => resolve()));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    query,
  };
}

describe('starter question routes', () => {
  it('keeps reads consumer-visible and writes behind the admin namespace', () => {
    expect(isAdminRoute('/api/ask-starters')).toBe(false);
    expect(isAdminRoute('/api/admin/ask-starters')).toBe(true);
  });

  it('returns deployment defaults before an administrator saves a row', async () => {
    const { origin } = await start();
    const response = await fetch(`${origin}/api/ask-starters`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ settings: DEFAULT_ASK_STARTER_SETTINGS, revision: 0 });
  });

  it('validates edited starter questions before writing', async () => {
    const { origin, query } = await start();
    const response = await fetch(`${origin}/api/admin/ask-starters`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-forwarded-email': 'admin@example.com' },
      body: JSON.stringify({
        revision: 0,
        patch: { questions: [{ id: 'one', kicker: '', question: 'A real question?' }] },
      }),
    });
    expect(response.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('keeps at least one starter card on the Ask landing page', async () => {
    const { origin, query } = await start();
    const response = await fetch(`${origin}/api/admin/ask-starters`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-forwarded-email': 'admin@example.com' },
      body: JSON.stringify({ revision: 0, patch: { questions: [] } }),
    });
    expect(response.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('persists an ordered deployment-wide list for administrators', async () => {
    const { origin, query } = await start();
    const questions = [
      { id: 'second', kicker: 'Second', question: 'What came second?' },
      { id: 'first', kicker: 'First', question: 'What came first?' },
    ];
    const response = await fetch(`${origin}/api/admin/ask-starters`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-forwarded-email': 'admin@example.com' },
      body: JSON.stringify({ revision: 0, patch: { questions } }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ settings: { questions }, revision: 1 });
    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO'))).toBe(true);
  });
});
