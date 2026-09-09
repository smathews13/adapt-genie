import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RosterEntry, RosterPayload } from '../../shared/user-roster-contract';
import { GroupRoleDefaults, RosterRows } from './UserRoleEditor';

function entry(email: string): RosterEntry {
  return {
    email,
    isDeploymentOwner: false,
    role: 'consumer',
    seedFloor: 'consumer',
    setBy: 'owner@databricks.com',
    setAt: '2026-09-01T00:00:00.000Z',
    isYou: false,
    assignable: ['admin', 'consumer'],
    canRemove: true,
  };
}

const payload: RosterPayload = {
  entries: [entry('engineer@databricks.com'), entry('partner@take2games.com'), entry('external@studio.example')],
  groupRoleDefaults: [
    {
      displayName: 'adapt-admins',
      groupName: 'adapt-admins',
      role: 'admin',
      appPermission: 'CAN_MANAGE',
      source: 'bundle',
      identityManagementUrl: '',
      scimConfirmed: false,
      setBy: '',
      setAt: '',
    },
    {
      displayName: 'adapt-users',
      groupName: 'adapt-users',
      role: 'consumer',
      appPermission: 'CAN_USE',
      source: 'bundle',
      identityManagementUrl: '',
      scimConfirmed: false,
      setBy: '',
      setAt: '',
    },
  ],
  storedRosterReadable: true,
  roleColumnPresent: true,
  pendingSchemaStatement: '',
  superAdminCount: 0,
  recoveryStatement: '',
};

describe('Identity role roster', () => {
  it('keeps workspace group role floors above the individual-user table', () => {
    const markup = renderToStaticMarkup(
      <>
        <GroupRoleDefaults payload={payload} />
        <RosterRows payload={payload} busy={false} onChange={() => {}} onRemove={() => {}} />
      </>
    );
    expect(markup.indexOf('Workspace group')).toBeLessThan(markup.indexOf('<th scope="col">Email</th>'));
  });

  it('places the resolved organization in each user row without organization header rows', () => {
    const markup = renderToStaticMarkup(
      <RosterRows payload={payload} busy={false} onChange={() => {}} onRemove={() => {}} />
    );
    const takeTwo = markup.indexOf('Take-Two Interactive');
    const databricks = markup.indexOf('Databricks');
    const external = markup.indexOf('studio.example');
    expect(markup).toContain('<th scope="col">Organization</th>');
    expect(markup).not.toContain('roster-organization-heading');
    expect(markup.indexOf('engineer@databricks.com')).toBeLessThan(databricks);
    expect(markup.indexOf('partner@take2games.com')).toBeLessThan(takeTwo);
    expect(markup.indexOf('external@studio.example')).toBeLessThan(external);
  });

  it('renders organization beside email, role, provenance, and actions', () => {
    const markup = renderToStaticMarkup(
      <RosterRows payload={payload} busy={false} onChange={() => {}} onRemove={() => {}} />
    );
    expect(markup).toContain('<th scope="col">Email</th>');
    expect(markup).toContain('<th scope="col">Organization</th>');
    expect(markup).toContain('<th scope="col">User role</th>');
    expect(markup).not.toMatch(/persona/i);
  });
});
