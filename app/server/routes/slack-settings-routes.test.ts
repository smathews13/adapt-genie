import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAdminRoute } from '../lib/admin-roles';

describe('Slack settings route contract', () => {
  it('admin-gates reads and optimistic writes and records the mutation', () => {
    expect(isAdminRoute('/api/admin/slack/settings')).toBe(true);
    const source = fs.readFileSync(path.join(__dirname, 'slack-settings-routes.ts'), 'utf8');
    expect(source).toContain("app.get('/api/admin/slack/settings'");
    expect(source).toContain("app.put('/api/admin/slack/settings'");
    expect(source).toContain('revision: z.number().int().nonnegative()');
    expect(source).toContain("action: 'slack-settings-updated'");
  });
});
