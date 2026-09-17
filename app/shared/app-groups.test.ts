import { describe, expect, it } from 'vitest';
import { appGroupOptions, appGroupsForEmail, memberEmailsForGroup, parseAppGroupsSettings } from './app-groups';

describe('parseAppGroupsSettings', () => {
  it('lower-cases and de-duplicates member emails within a group', () => {
    const parsed = parseAppGroupsSettings({
      groups: [{ id: 'g1', name: 'Trading', members: ['A@X.com', 'a@x.com', 'b@x.COM'] }],
    });
    expect(parsed.groups[0].members).toEqual(['a@x.com', 'b@x.com']);
  });

  it('drops a group whose id repeats rather than merging two under one id', () => {
    const parsed = parseAppGroupsSettings({
      groups: [
        { id: 'dup', name: 'First', members: ['a@x.com'] },
        { id: 'dup', name: 'Second', members: ['b@x.com'] },
      ],
    });
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0].name).toBe('First');
    expect(parsed.groups[0].members).toEqual(['a@x.com']);
  });

  it('trims the group name', () => {
    expect(parseAppGroupsSettings({ groups: [{ id: 'g', name: '  Ops  ', members: [] }] }).groups[0].name).toBe('Ops');
  });
});

describe('membership helpers', () => {
  const settings = parseAppGroupsSettings({
    groups: [
      { id: 'g1', name: 'Trading', members: ['ann@x.com', 'bob@x.com'] },
      { id: 'g2', name: 'Risk', members: ['ANN@x.com'] },
    ],
  });

  it('resolves every group an email belongs to, matched case-insensitively', () => {
    expect(appGroupsForEmail(settings, 'Ann@X.com')).toEqual(['g1', 'g2']);
    expect(appGroupsForEmail(settings, 'bob@x.com')).toEqual(['g1']);
    expect(appGroupsForEmail(settings, 'nobody@x.com')).toEqual([]);
    expect(appGroupsForEmail(settings, '')).toEqual([]);
  });

  it('returns a group’s members, or nothing for an unknown group', () => {
    expect(memberEmailsForGroup(settings, 'g1')).toEqual(['ann@x.com', 'bob@x.com']);
    expect(memberEmailsForGroup(settings, 'missing')).toEqual([]);
  });

  it('orders the filter options by name', () => {
    expect(appGroupOptions(settings)).toEqual([
      { id: 'g2', name: 'Risk' },
      { id: 'g1', name: 'Trading' },
    ]);
  });
});
