import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADAPT_ADMIN_GROUP,
  ADAPT_USER_GROUP,
  adaptGroupRole,
  forgetAdaptGroupRoles,
  groupRoleForRequest,
  mergeGroupRoleMappings,
  roleFromAdaptGroups,
  scimGroupNames,
  seedRolesWithGroupFloors,
} from './adapt-group-roles';
import { groupRoleLookupForStore, rolePayload, type AdminStore, type Role } from './admin-roles';

const EMAIL = 'person@databricks.com';

function scim(groups: string[]) {
  return {
    Resources: [
      {
        userName: EMAIL,
        groups: groups.map((display) => ({ display, value: display.toLowerCase() })),
      },
    ],
  };
}

describe('ADAPT group roles', () => {
  beforeEach(() => forgetAdaptGroupRoles());
  afterEach(() => vi.unstubAllEnvs());

  it('maps the customer admin group to admin and the user group to consumer', () => {
    expect(roleFromAdaptGroups([ADAPT_ADMIN_GROUP])).toBe('admin');
    expect(roleFromAdaptGroups([ADAPT_USER_GROUP])).toBe('consumer');
    expect(roleFromAdaptGroups(['unrelated'])).toBeNull();
  });

  it('honors customer-specific group overrides from the deployment', async () => {
    vi.stubEnv('ADAPT_ADMIN_GROUP', 'customer-adapt-admins');
    vi.stubEnv('ADAPT_USER_GROUP', 'customer-adapt-users');
    vi.resetModules();
    const configured = await import('./adapt-group-roles');
    expect(configured.roleFromAdaptGroups(['customer-adapt-admins'])).toBe('admin');
    expect(configured.roleFromAdaptGroups(['customer-adapt-users'])).toBe('consumer');
    vi.resetModules();
  });

  it('gives the admin group precedence when a person belongs to both groups', () => {
    expect(roleFromAdaptGroups([ADAPT_USER_GROUP, ADAPT_ADMIN_GROUP])).toBe('admin');
  });

  it('does not let a stored edit weaken a configured group role', () => {
    expect(
      mergeGroupRoleMappings(
        [{ groupName: ADAPT_ADMIN_GROUP, role: 'admin' }],
        [{ groupName: ADAPT_ADMIN_GROUP.toLowerCase(), role: 'consumer' }]
      )
    ).toEqual([{ groupName: ADAPT_ADMIN_GROUP, role: 'admin' }]);
  });

  it('matches group and user names without case sensitivity', () => {
    const body = {
      Resources: [
        { userName: EMAIL.toUpperCase(), groups: [{ display: ADAPT_ADMIN_GROUP.toLowerCase() }] },
        { userName: 'someone-else@databricks.com', groups: [{ display: ADAPT_USER_GROUP }] },
      ],
    };
    expect(scimGroupNames(body, EMAIL)).toEqual([ADAPT_ADMIN_GROUP.toLowerCase()]);
    expect(roleFromAdaptGroups(scimGroupNames(body, EMAIL))).toBe('admin');
  });

  it('reads the exact signed-in user through SCIM and caches the role briefly', async () => {
    const reader = vi.fn(() => Promise.resolve(scim([ADAPT_ADMIN_GROUP])));
    await expect(adaptGroupRole(EMAIL, reader)).resolves.toBe('admin');
    await expect(adaptGroupRole(EMAIL, reader)).resolves.toBe('admin');
    expect(reader).toHaveBeenCalledTimes(1);
    expect(reader).toHaveBeenCalledWith('/api/2.0/preview/scim/v2/Users', {
      filter: `userName eq "${EMAIL}"`,
    });
  });

  it('does not promote anyone when SCIM is unavailable', async () => {
    const reader = vi.fn(() => Promise.reject(new Error('forbidden')));
    await expect(adaptGroupRole(EMAIL, reader)).resolves.toBeNull();
  });

  it('uses the admin group as an in-app role floor', async () => {
    const store = {
      query: vi.fn(() => Promise.resolve({ rows: [] })),
    } as AdminStore;
    await expect(rolePayload(store, EMAIL, () => Promise.resolve('admin'))).resolves.toMatchObject({
      role: 'admin',
      addedAdminsReadable: true,
    });
  });

  it('includes Lakebase-stored mappings in role resolution', async () => {
    const store = {
      query: vi.fn(() =>
        Promise.resolve({
          rows: [
            {
              group_name: 'existing-workspace-team',
              role: 'admin',
              added_by: 'owner@example.invalid',
              added_at: '2026-09-08T00:00:00.000Z',
            },
          ],
        })
      ),
    } as AdminStore;
    const reader = vi.fn(() => Promise.resolve(scim(['existing-workspace-team'])));
    await expect(groupRoleLookupForStore(store, reader)(EMAIL)).resolves.toBe('admin');
    expect(reader).toHaveBeenCalledWith('/api/2.0/preview/scim/v2/Users', { filter: `userName eq "${EMAIL}"` });
  });

  it('keeps the configured admin group as an authorization floor', async () => {
    const store = {
      query: vi.fn(() =>
        Promise.resolve({
          rows: [
            {
              group_name: ADAPT_ADMIN_GROUP,
              role: 'consumer',
              added_by: 'owner@example.invalid',
              added_at: '2026-09-08T00:00:00.000Z',
            },
          ],
        })
      ),
    } as AdminStore;
    const reader = vi.fn(() => Promise.resolve(scim([ADAPT_ADMIN_GROUP])));
    await expect(groupRoleLookupForStore(store, reader)(EMAIL)).resolves.toBe('admin');
  });

  it('reuses one injected group answer throughout a request', async () => {
    const req = {};
    const lookup = vi.fn(() => Promise.resolve<Role | null>('admin'));
    await expect(groupRoleForRequest(req, EMAIL, lookup)).resolves.toBe('admin');
    await expect(groupRoleForRequest(req, EMAIL.toUpperCase(), lookup)).resolves.toBe('admin');
    expect(lookup).toHaveBeenCalledOnce();
  });

  it('merges group admin and super-admin floors without lowering seed floors', async () => {
    const seededSuper = 'operator@example.invalid';
    const groupSuper = 'group-super@example.invalid';
    const floors = await seedRolesWithGroupFloors(
      { superAdmins: [seededSuper], admins: [seededSuper] },
      [EMAIL, EMAIL.toUpperCase(), groupSuper],
      (email) => Promise.resolve(email === groupSuper ? 'super_admin' : 'admin')
    );
    expect(floors).toEqual({
      superAdmins: [seededSuper, groupSuper],
      admins: [seededSuper, EMAIL, groupSuper],
    });
  });
});
