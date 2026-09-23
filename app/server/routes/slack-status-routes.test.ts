import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAdminRoute } from '../lib/admin-roles';
import { safeSlackStatus } from './slack-status-routes';

describe('Slack status surfaces', () => {
  it.each([
    ['disabled', 'disabled'],
    ['kill_switch', 'kill-switch'],
    ['transport_unavailable', 'transport-unavailable'],
    ['broker_unavailable', 'broker-unavailable'],
    ['invalid_configuration', 'config-invalid'],
    ['settings_unavailable', 'store-unavailable'],
  ] as const)('maps %s to safe state %s', (reason, state) => {
    expect(safeSlackStatus({ ready: false, reason })).toEqual({
      state,
      ready: false,
      acceptsNewEvents: false,
    });
  });

  it('reports running without identifiers or secret references', () => {
    const payload = safeSlackStatus({ ready: true, reason: 'running' });
    expect(payload).toEqual({ state: 'running', ready: true, acceptsNewEvents: true });
    expect(JSON.stringify(payload)).not.toMatch(/team|registration|workspace|token|secret|client/i);
  });

  it('keeps operator inspection admin-gated and available beside public health', () => {
    expect(isAdminRoute('/api/admin/slack/status')).toBe(true);
    const source = fs.readFileSync(path.join(__dirname, 'slack-status-routes.ts'), 'utf8');
    expect(source).toContain("app.get('/api/slack/status'");
    expect(source).toContain("app.get('/api/admin/slack/status'");
  });
});
