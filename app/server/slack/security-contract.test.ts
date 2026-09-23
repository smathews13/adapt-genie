import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { logSlackOperationalAudit } from './audit';

describe('Slack security contracts', () => {
  it('uses only the scanner-safe native protocol runtime', () => {
    const root = path.join(__dirname, '..', '..');
    const runtime = [
      fs.readFileSync(path.join(__dirname, 'socket-mode-adapter.ts'), 'utf8'),
      fs.readFileSync(path.join(__dirname, 'message-client.ts'), 'utf8'),
    ].join('\n');
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const lock = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8');
    expect(runtime).toContain('apps.connections.open');
    expect(runtime).toContain('chat.postMessage');
    expect(runtime).not.toMatch(/@slack\/(?:bolt|socket-mode|web-api)|\bundici\b|receiver/i);
    for (const dependency of ['@slack/bolt', '@slack/socket-mode', '@slack/web-api']) {
      expect(packageJson.dependencies).not.toHaveProperty(dependency);
      expect(lock).not.toContain(`node_modules/${dependency}`);
    }
  });

  it.each(['development.manifest.json', 't2-production.manifest.json'])('keeps %s at the DM-only minimum', (name) => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'bundle', 'slack', name), 'utf8');
    const manifest = JSON.parse(source) as {
      oauth_config: { scopes: { bot: string[] } };
      settings: {
        socket_mode_enabled: boolean;
        org_deploy_enabled: boolean;
        event_subscriptions: { bot_events: string[] };
      };
    };
    const appTokenName = name.replace('.manifest.json', '.app-token.json');
    const appTokenSource = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'bundle', 'slack', appTokenName),
      'utf8'
    );
    const appToken = JSON.parse(appTokenSource) as { token_type: string; scopes: string[]; value: string };
    expect(manifest.settings.socket_mode_enabled).toBe(true);
    expect(manifest.settings.org_deploy_enabled).toBe(false);
    expect(appToken.token_type).toBe('app-level');
    expect(appToken.scopes).toEqual(['connections:write']);
    expect(appToken.value).toMatch(/^REQUIRED:/);
    expect(manifest.oauth_config.scopes.bot).toEqual(['chat:write', 'im:history']);
    expect(manifest.settings.event_subscriptions.bot_events).toEqual(['message.im']);
    expect(source).not.toMatch(/(?:channels|files|admin|search|users|groups|mpim):/i);
    expect(`${source}\n${appTokenSource}`).not.toMatch(/https?:|redirect|client_id|team_id|xox[baprs]-|xapp-/i);
  });

  it('keeps Databricks delegated OAuth scopes separate from Slack scopes', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'bundle', 'slack', 'databricks-oauth.contract.json'),
      'utf8'
    );
    const contract = JSON.parse(source) as {
      authorization_scopes: string[];
      callback_parameters: string[];
      nonce_verification: string;
    };
    expect(contract.authorization_scopes).toEqual(['all-apis', 'offline_access', 'openid', 'profile', 'email']);
    expect(contract.callback_parameters).toEqual(['state', 'code']);
    expect(contract.nonce_verification).toBe('required-in-broker-exchanged-token-proof');
    expect(source).not.toMatch(/chat:write|im:history|connections:write|message\.im/);
  });

  it('logs only safe hashes, references, and error classes', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    void logSlackOperationalAudit({
      event: 'delivery_failed',
      workspaceHash: 'workspace-hash',
      eventHash: 'event-hash',
      runId: 'run-1',
      deliveryId: 'delivery-1',
      safeErrorClass: 'rate_limited',
    });
    const output = info.mock.calls.flat().join(' ');
    expect(output).toContain('workspace-hash');
    expect(output).not.toMatch(/xox[baprs]-|authorization|prompt|answer|payload/i);
    info.mockRestore();
  });
});
