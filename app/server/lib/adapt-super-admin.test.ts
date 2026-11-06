import { describe, expect, it, vi } from 'vitest';
import {
  adaptSuperAdminEmails,
  resolveRole,
  seedAdminEmails,
  seedSuperAdminEmails,
  type AdminStore,
} from './admin-roles';

describe('the immutable ADAPT operator', () => {
  it('remains a super admin even when the stored roster is unavailable', async () => {
    const query = vi.fn(() => Promise.reject(new Error('Lakebase unavailable')));
    const store = { query } as AdminStore;
    const email = adaptSuperAdminEmails()[0];

    await expect(resolveRole(store, email)).resolves.toMatchObject({
      role: 'super_admin',
      addedAdminsReadable: true,
    });
    expect(seedAdminEmails()).toContain(email);
    expect(seedSuperAdminEmails()).toContain(email);
    expect(query).not.toHaveBeenCalled();
  });
});
