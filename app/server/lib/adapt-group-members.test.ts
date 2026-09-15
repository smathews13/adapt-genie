import { describe, expect, it, vi } from 'vitest';
import {
  listWorkspaceGroups,
  readAdaptGroupMembers,
  readWorkspaceGroup,
  SCIM_GROUPS_PATH,
} from './adapt-group-members';

describe('ADAPT workspace group members', () => {
  it('lists visible workspace groups for the settings picker', async () => {
    const reader = vi.fn(() =>
      Promise.resolve({
        Resources: [
          { id: '2', displayName: 'Zeta team' },
          { id: '1', displayName: 'Alpha team' },
        ],
      })
    );
    await expect(listWorkspaceGroups(reader)).resolves.toEqual({
      groups: [
        { id: '1', displayName: 'Alpha team' },
        { id: '2', displayName: 'Zeta team' },
      ],
      readable: true,
      detail: '',
    });
    expect(reader).toHaveBeenCalledWith(SCIM_GROUPS_PATH, { count: '500', startIndex: '1' });
  });

  it('resolves individual SCIM members to sorted email addresses', async () => {
    const reader = vi.fn((path: string) => {
      if (path === SCIM_GROUPS_PATH) {
        return Promise.resolve({
          Resources: [{ id: 'group-1', displayName: 'S_TK2_Databricks_Adapt_Genie_Users' }],
        });
      }
      if (path === `${SCIM_GROUPS_PATH}/group-1`) {
        return Promise.resolve({
          members: [
            { value: 'user-2', display: 'Second User' },
            { value: 'user-1', display: 'First User' },
          ],
        });
      }
      if (path.endsWith('/user-1'))
        return Promise.resolve({ userName: 'first@take2games.com', displayName: 'First User' });
      if (path.endsWith('/user-2'))
        return Promise.resolve({ userName: 'second@take2games.com', displayName: 'Second User' });
      throw new Error('unexpected read');
    });
    await expect(readAdaptGroupMembers('S_TK2_Databricks_Adapt_Genie_Users', reader)).resolves.toEqual({
      groupName: 'S_TK2_Databricks_Adapt_Genie_Users',
      readable: true,
      detail: '',
      members: [
        { email: 'first@take2games.com', displayName: 'First User' },
        { email: 'second@take2games.com', displayName: 'Second User' },
      ],
    });
  });

  it('does not invent an empty roster when the configured group is absent', async () => {
    const result = await readAdaptGroupMembers('missing-group', () => Promise.resolve({ Resources: [] }));
    expect(result).toMatchObject({ groupName: 'missing-group', readable: false, members: [] });
    expect(result.detail).toContain('not found');
  });

  it('never serves an injected reader from the shared cache', async () => {
    // The production identity's reads are cached to spare the SCIM fan-out, but a
    // test (or any caller with its own reader) must always see a fresh call, so a
    // second read re-runs the same lookups rather than returning a remembered answer.
    const reader = vi.fn((path: string) => {
      if (path === SCIM_GROUPS_PATH) {
        return Promise.resolve({ Resources: [{ id: 'group-1', displayName: 'Cached Team' }] });
      }
      if (path === `${SCIM_GROUPS_PATH}/group-1`) {
        return Promise.resolve({ members: [{ value: 'user-1', display: 'Only User' }] });
      }
      return Promise.resolve({ userName: 'only@take2games.com', displayName: 'Only User' });
    });
    await readAdaptGroupMembers('Cached Team', reader);
    const callsAfterFirst = reader.mock.calls.length;
    await readAdaptGroupMembers('Cached Team', reader);
    expect(reader.mock.calls.length).toBe(callsAfterFirst * 2);
  });

  it('confirms only an exact SCIM group match', async () => {
    const reader = vi.fn(() => Promise.resolve({ Resources: [{ id: 'group-1', displayName: 'Existing Team' }] }));
    await expect(readWorkspaceGroup('existing team', reader)).resolves.toEqual({
      groupName: 'Existing Team',
      groupId: 'group-1',
      exists: true,
      readable: true,
    });
    expect(reader).toHaveBeenCalledWith(SCIM_GROUPS_PATH, {
      filter: 'displayName eq "existing team"',
      count: '100',
    });
  });
});
