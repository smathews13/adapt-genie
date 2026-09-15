import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';

import { readAdaptMonitoringRoster } from './adapt-monitoring-roster';

const saved = {
  admin: process.env.ADAPT_ADMIN_GROUP,
  adminLabel: process.env.ADAPT_ADMIN_GROUP_LABEL,
  user: process.env.ADAPT_USER_GROUP,
  userLabel: process.env.ADAPT_USER_GROUP_LABEL,
};

afterEach(() => {
  for (const [name, value] of [
    ['ADAPT_ADMIN_GROUP', saved.admin],
    ['ADAPT_ADMIN_GROUP_LABEL', saved.adminLabel],
    ['ADAPT_USER_GROUP', saved.user],
    ['ADAPT_USER_GROUP_LABEL', saved.userLabel],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('ADAPT monitoring roster', () => {
  it('expands authorization labels and gives the admin group precedence', async () => {
    process.env.ADAPT_ADMIN_GROUP = 'internal-admin-id';
    process.env.ADAPT_ADMIN_GROUP_LABEL = 'Exact Admin Display Name';
    process.env.ADAPT_USER_GROUP = 'internal-user-id';
    process.env.ADAPT_USER_GROUP_LABEL = 'Exact User Display Name';
    const store = {
      query: vi.fn(() =>
        Promise.resolve({
          rows: [
            {
              email: 'neha@example.test',
              role: 'consumer',
              added_by: 'bootstrap',
              added_at: new Date('2026-09-01T00:00:00Z'),
            },
          ],
        })
      ),
    };
    const readGroupMembers = vi.fn((groupName: string) =>
      Promise.resolve({
        groupName,
        readable: true,
        detail: '',
        members: [{ email: 'neha@example.test', displayName: 'Neha' }],
      })
    );

    const roster = await readAdaptMonitoringRoster(
      store,
      {} as Request,
      { superAdmins: [], admins: [] },
      readGroupMembers
    );

    expect(readGroupMembers.mock.calls.map(([groupName]) => groupName)).toEqual([
      'Exact Admin Display Name',
      'Exact User Display Name',
    ]);
    expect(roster.entries).toContainEqual({ email: 'neha@example.test', role: 'admin' });
    expect(roster.revision).toMatch(/^[a-f0-9]{24}$/);
  });

  it('marks a readable but truncated group roster as partial', async () => {
    process.env.ADAPT_USER_GROUP_LABEL = 'Exact User Display Name';
    const store = { query: vi.fn(() => Promise.resolve({ rows: [] })) };
    const members = [{ email: 'included@example.test', displayName: 'Included User' }];
    const roster = await readAdaptMonitoringRoster(store, {} as Request, { superAdmins: [], admins: [] }, (groupName) =>
      Promise.resolve({
        groupName,
        readable: true,
        detail: 'Showing the first 500 members.',
        members,
      })
    );
    const completeRoster = await readAdaptMonitoringRoster(
      store,
      {} as Request,
      { superAdmins: [], admins: [] },
      (groupName) => Promise.resolve({ groupName, readable: true, detail: '', members })
    );

    expect(roster.complete).toBe(false);
    expect(roster.reason).toBe('Showing the first 500 members.');
    expect(roster.revision).not.toBe(completeRoster.revision);
  });
});
