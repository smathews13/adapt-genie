import fs from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAdminRoute } from '../lib/admin-roles';
import type { SlackLinkWriter } from '../slack/oauth-service';
import { setupSlackOAuthRoutes } from './slack-oauth-routes';
import type { InsightsAppKit } from './insights-routes';

const open: Server[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('Slack OAuth route contract', () => {
  const source = fs.readFileSync(path.join(__dirname, 'slack-oauth-routes.ts'), 'utf8');

  it('exposes link, callback, status, revoke, and admin uninstall contracts', () => {
    for (const route of [
      '/api/slack/link',
      '/api/slack/oauth/callback',
      '/api/slack/link/status',
      '/api/slack/link/revoke',
      '/api/admin/slack/uninstall',
    ]) {
      expect(source).toContain(route);
    }
    expect(isAdminRoute('/api/admin/slack/uninstall')).toBe(true);
  });

  it('rejects raw identity/auth/tool fields instead of trusting request bodies', () => {
    expect(source).toContain('const EmptyBody = z.strictObject({})');
    expect(source).not.toMatch(/req\.body\.(?:subject|email|team|workspace|authorization|tool|token|code)/);
    expect(source).toContain('return userEmail(req)');
    expect(source).toContain('linkReferenceForActor(currentActor)');
    expect(source).toContain('status({ actor: currentActor, linkReference })');
    expect(source).toContain('revoke({ actor: currentActor, linkReference })');
  });

  it('accepts the standard OAuth state+code callback without a nonce query parameter', () => {
    const callbackSchema = /const CallbackQuery = z\.strictObject\(\{([\s\S]*?)\}\);/.exec(source)?.[1] ?? '';
    expect(callbackSchema).toContain('state:');
    expect(callbackSchema).toContain('code:');
    expect(callbackSchema).not.toContain('nonce:');
  });

  it('scopes uninstall from server configuration rather than a request identifier', () => {
    expect(source).toContain('readSlackInstallationScope');
    expect(source).toContain('linkWriter.uninstall(installationScope)');
    expect(source).not.toMatch(/req\.(?:body|query)\.(?:installation|registration|workspace|team)/);
  });

  it('has no app-service-principal or raw refresh-token storage fallback', () => {
    expect(source).not.toMatch(/service.?principal|refresh.?token|DATABRICKS_TOKEN/i);
  });

  it('passes server-derived actor and link references to status/revoke, and configured scope to uninstall', async () => {
    const app = express();
    app.use(express.json());
    const linkWriter: SlackLinkWriter = {
      write: vi.fn(),
      status: vi.fn().mockResolvedValue('linked'),
      revoke: vi.fn().mockResolvedValue('revoked'),
      uninstall: vi.fn().mockResolvedValue('uninstalled'),
    };
    const linkReferenceForActor = vi.fn((actor: string) => Promise.resolve(`link:${actor}`));
    setupSlackOAuthRoutes({ server: { extend: (register) => register(app) } } as InsightsAppKit, {
      linkWriter,
      linkReferenceForActor,
      readInstallationScope: () => ({
        environment: 'production',
        registrationId: 'production-registration',
        workspaceHash: 'workspace-hash',
      }),
    });
    const server = app.listen(0, '127.0.0.1');
    open.push(server);
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const headers = { 'x-forwarded-email': 'Reader@Example.COM', 'content-type': 'application/json' };

    expect((await fetch(`${base}/api/slack/link/status`, { headers })).status).toBe(200);
    expect(
      (
        await fetch(`${base}/api/slack/link/status`, {
          headers: { ...headers, 'x-forwarded-email': 'Second@Example.COM' },
        })
      ).status
    ).toBe(200);
    expect(
      (
        await fetch(`${base}/api/slack/link/revoke`, {
          method: 'POST',
          headers,
          body: '{}',
        })
      ).status
    ).toBe(200);
    expect(
      (
        await fetch(`${base}/api/admin/slack/uninstall`, {
          method: 'POST',
          headers,
          body: '{}',
        })
      ).status
    ).toBe(200);

    expect(linkReferenceForActor).toHaveBeenCalledWith('reader@example.com');
    expect(linkWriter.status).toHaveBeenCalledWith({
      actor: 'reader@example.com',
      linkReference: 'link:reader@example.com',
    });
    expect(linkWriter.status).toHaveBeenCalledWith({
      actor: 'second@example.com',
      linkReference: 'link:second@example.com',
    });
    expect(linkWriter.revoke).toHaveBeenCalledWith({
      actor: 'reader@example.com',
      linkReference: 'link:reader@example.com',
    });
    expect(linkWriter.uninstall).toHaveBeenCalledWith({
      environment: 'production',
      registrationId: 'production-registration',
      workspaceHash: 'workspace-hash',
    });
  });
});
