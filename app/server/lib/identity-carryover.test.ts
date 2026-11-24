import { describe, expect, it, vi } from 'vitest';

import { adaptSuperAdminEmails, applyLegacyAdaptSuperAdmins } from './adapt-super-admin-floor';
import type { DecisionStore } from './deployment-decisions';
import { IDENTITY_CARRYOVER_DECISION, recordIdentityCarryover, restoreIdentityCarryover } from './identity-carryover';
import { applyLegacyPreferenceDefaultOwner, ownsPreferenceDefaults } from './preference-default-owner';

const GIT_DEPLOY = {
  LAKEBASE_ENDPOINT: 'projects/example/branches/production',
  ADAPT_ADMIN_GROUP: 'Example_Admins_Group',
  ADAPT_USER_GROUP: 'Example_Users_Group',
};

function storeWith(value: string | null) {
  const calls: { text: string; params: unknown[] }[] = [];
  const store: DecisionStore = {
    query: vi.fn((text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      return Promise.resolve({ rows: text.startsWith('SELECT') && value !== null ? [{ value }] : [] });
    }),
  };
  return { store, calls };
}

const RECORDED = JSON.stringify({
  ADAPT_ADMIN_GROUP_LABEL: 'Example_Admins',
  ADAPT_USER_GROUP_LABEL: 'Example_Users',
  ADAPT_SUPER_ADMIN_EMAILS: 'owner@example.test',
  PLAYER_INSIGHTS_PREFERENCE_DEFAULT_OWNER: 'designer@example.test',
  labelGroups: { ADAPT_ADMIN_GROUP_LABEL: 'Example_Admins_Group', ADAPT_USER_GROUP_LABEL: 'Example_Users_Group' },
});

function written(calls: { text: string; params: unknown[] }[]): Record<string, unknown> | undefined {
  const write = calls.find((call) => call.text.startsWith('INSERT'));
  return write ? (JSON.parse(String(write.params[1])) as Record<string, unknown>) : undefined;
}

describe('identity configuration carryover', () => {
  it('restores every key a Git deploy leaves empty', async () => {
    const { store } = storeWith(RECORDED);
    const env: Record<string, string | undefined> = {
      ...GIT_DEPLOY,
      ADAPT_ADMIN_GROUP_LABEL: '',
      ADAPT_USER_GROUP_LABEL: '  ',
    };

    await expect(restoreIdentityCarryover(store, env)).resolves.toBe(4);
    expect(env).toMatchObject({
      ADAPT_ADMIN_GROUP_LABEL: 'Example_Admins',
      ADAPT_USER_GROUP_LABEL: 'Example_Users',
      ADAPT_SUPER_ADMIN_EMAILS: 'owner@example.test',
      PLAYER_INSIGHTS_PREFERENCE_DEFAULT_OWNER: 'designer@example.test',
    });
  });

  it('keeps a value the artifact states instead of the record', async () => {
    const { store } = storeWith(RECORDED);
    const env: Record<string, string | undefined> = { ...GIT_DEPLOY, ADAPT_ADMIN_GROUP_LABEL: 'New_Admins' };

    await expect(restoreIdentityCarryover(store, env)).resolves.toBe(3);
    expect(env.ADAPT_ADMIN_GROUP_LABEL).toBe('New_Admins');
  });

  it('merges stated values over the record so silent keys keep their value', async () => {
    const { store, calls } = storeWith(RECORDED);
    const env = { ...GIT_DEPLOY, ADAPT_ADMIN_GROUP_LABEL: 'New_Admins' };

    await expect(recordIdentityCarryover(store, env)).resolves.toBe(true);
    const write = calls.find((call) => call.text.startsWith('INSERT'));
    expect(write?.params[0]).toBe(IDENTITY_CARRYOVER_DECISION);
    expect(JSON.parse(String(write?.params[1]))).toEqual({
      ...JSON.parse(RECORDED),
      ADAPT_ADMIN_GROUP_LABEL: 'New_Admins',
    });
  });

  it('restores a group label only while the deployment names the group it was recorded with', async () => {
    const { store } = storeWith(RECORDED);
    const env: Record<string, string | undefined> = { ...GIT_DEPLOY, ADAPT_ADMIN_GROUP: 'Recovered_Admins' };

    await restoreIdentityCarryover(store, env);
    expect(env.ADAPT_ADMIN_GROUP_LABEL).toBeUndefined();
    expect(env.ADAPT_USER_GROUP_LABEL).toBe('Example_Users');
  });

  it('never restores a label from a record that does not say which group it belongs to', async () => {
    const { labelGroups: _ignored, ...legacy } = JSON.parse(RECORDED) as Record<string, unknown>;
    const { store } = storeWith(JSON.stringify(legacy));
    const env: Record<string, string | undefined> = { ...GIT_DEPLOY };

    await expect(restoreIdentityCarryover(store, env)).resolves.toBe(2);
    expect(env.ADAPT_ADMIN_GROUP_LABEL).toBeUndefined();
    expect(env.ADAPT_SUPER_ADMIN_EMAILS).toBe('owner@example.test');
  });

  it('keeps a recorded value over a code default filled on a boot that could not restore it', async () => {
    const { store, calls } = storeWith(RECORDED);
    const env = { ...GIT_DEPLOY, ADAPT_SUPER_ADMIN_EMAILS: 'legacy@example.test' };

    await recordIdentityCarryover(store, env, ['ADAPT_SUPER_ADMIN_EMAILS']);
    expect(written(calls)?.ADAPT_SUPER_ADMIN_EMAILS).toBe('owner@example.test');
  });

  it('seeds an empty record from code defaults', async () => {
    const { store, calls } = storeWith(null);
    const env = { ...GIT_DEPLOY, ADAPT_SUPER_ADMIN_EMAILS: 'legacy@example.test' };

    await recordIdentityCarryover(store, env, ['ADAPT_SUPER_ADMIN_EMAILS']);
    expect(written(calls)?.ADAPT_SUPER_ADMIN_EMAILS).toBe('legacy@example.test');
  });

  it('never adds a code default to an existing record that lacks the key', async () => {
    const { store, calls } = storeWith(JSON.stringify({ ADAPT_ADMIN_GROUP_LABEL: 'Example_Admins' }));
    const env = { ...GIT_DEPLOY, ADAPT_SUPER_ADMIN_EMAILS: 'legacy@example.test', ADAPT_USER_GROUP_LABEL: 'Users' };

    await recordIdentityCarryover(store, env, ['ADAPT_SUPER_ADMIN_EMAILS']);
    expect(written(calls)).not.toHaveProperty('ADAPT_SUPER_ADMIN_EMAILS');
  });

  it('writes nothing when the previous record cannot be read', async () => {
    const calls: string[] = [];
    const store: DecisionStore = {
      query: vi.fn((text: string) => {
        calls.push(text);
        return text.startsWith('SELECT') ? Promise.reject(new Error('waking up')) : Promise.resolve({ rows: [] });
      }),
    };
    const env = { ...GIT_DEPLOY, ADAPT_SUPER_ADMIN_EMAILS: 'legacy@example.test' };

    await expect(recordIdentityCarryover(store, env, ['ADAPT_SUPER_ADMIN_EMAILS'])).resolves.toBe(false);
    expect(calls.some((text) => text.startsWith('INSERT'))).toBe(false);
  });

  it('records each stated label beside the group it was stated with', async () => {
    const { store, calls } = storeWith(null);
    const env = { ...GIT_DEPLOY, ADAPT_ADMIN_GROUP_LABEL: 'Shown_Admins' };

    await recordIdentityCarryover(store, env);
    expect(written(calls)?.labelGroups).toEqual({ ADAPT_ADMIN_GROUP_LABEL: 'Example_Admins_Group' });
  });

  it('never touches the store on a local run', async () => {
    const { store, calls } = storeWith(RECORDED);
    const env: Record<string, string | undefined> = { ADAPT_ADMIN_GROUP_LABEL: 'Local_Admins' };

    await expect(restoreIdentityCarryover(store, env)).resolves.toBe(0);
    await expect(recordIdentityCarryover(store, env)).resolves.toBe(false);
    expect(calls).toEqual([]);
  });

  it('ignores an unreadable record', async () => {
    const { store } = storeWith('not json');
    const env: Record<string, string | undefined> = { ...GIT_DEPLOY };

    await expect(restoreIdentityCarryover(store, env)).resolves.toBe(0);
    expect(env.ADAPT_SUPER_ADMIN_EMAILS).toBeUndefined();
  });
});

describe('preference default owner', () => {
  it('follows the configured owner and fills the legacy owner only when none is named', () => {
    const env: Record<string, string | undefined> = {
      PLAYER_INSIGHTS_PREFERENCE_DEFAULT_OWNER: 'Designer@Example.test',
    };
    applyLegacyPreferenceDefaultOwner(env);
    expect(env.PLAYER_INSIGHTS_PREFERENCE_DEFAULT_OWNER).toBe('Designer@Example.test');

    const previous = process.env.PLAYER_INSIGHTS_PREFERENCE_DEFAULT_OWNER;
    process.env.PLAYER_INSIGHTS_PREFERENCE_DEFAULT_OWNER = 'designer@example.test';
    try {
      expect(ownsPreferenceDefaults(' DESIGNER@example.test ')).toBe(true);
      expect(ownsPreferenceDefaults('someone@example.test')).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.PLAYER_INSIGHTS_PREFERENCE_DEFAULT_OWNER;
      else process.env.PLAYER_INSIGHTS_PREFERENCE_DEFAULT_OWNER = previous;
    }

    const empty: Record<string, string | undefined> = {};
    applyLegacyPreferenceDefaultOwner(empty);
    expect(empty.PLAYER_INSIGHTS_PREFERENCE_DEFAULT_OWNER).toMatch(/@/);
  });
});

describe('ADAPT super-admin floor', () => {
  it('follows the configured list and fills the legacy floor only when none is named', () => {
    const previous = process.env.ADAPT_SUPER_ADMIN_EMAILS;
    process.env.ADAPT_SUPER_ADMIN_EMAILS = ' Owner@Example.test, deputy@example.test,owner@example.test ';
    try {
      expect(adaptSuperAdminEmails()).toEqual(['owner@example.test', 'deputy@example.test']);
    } finally {
      if (previous === undefined) delete process.env.ADAPT_SUPER_ADMIN_EMAILS;
      else process.env.ADAPT_SUPER_ADMIN_EMAILS = previous;
    }

    const empty: Record<string, string | undefined> = {};
    applyLegacyAdaptSuperAdmins(empty);
    expect(empty.ADAPT_SUPER_ADMIN_EMAILS?.split(',').length).toBeGreaterThan(0);
  });
});
