import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RosterPayload } from '../../shared/user-roster-contract';
import { RosterAddRow, RosterRows } from './UserRoleEditor';

const DIALOG = readFileSync(new URL('Dialog.tsx', import.meta.url), 'utf8');
const SELECT = readFileSync(new URL('AppSelect.tsx', import.meta.url), 'utf8');

const payload: RosterPayload = {
  entries: [
    {
      email: 'admin@databricks.com',
      isDeploymentOwner: false,
      role: 'admin',
      seedFloor: 'consumer',
      setBy: 'owner@take2games.com',
      setAt: '',
      isYou: false,
      assignable: ['super_admin', 'consumer'],
      canRemove: true,
    },
  ],
  storedRosterReadable: true,
  roleColumnPresent: true,
  pendingSchemaStatement: '',
  superAdminCount: 0,
  recoveryStatement: '',
};

describe('Settings Identity controls', () => {
  it('keeps select portals inside the non-inert dialog branch', () => {
    expect(DIALOG).toContain('<PortalContainerProvider container={portalContainer}>');
    expect(SELECT).toContain('<PopoverContent');
  });

  it('offers only the individual user role control and removal action', () => {
    const markup = renderToStaticMarkup(
      <RosterRows payload={payload} busy={false} onChange={() => {}} onRemove={() => {}} />
    );
    expect(markup).toContain('aria-label="User role for admin@databricks.com: Admin"');
    expect(markup).toContain('data-variant="destructive"');
    expect(markup).not.toMatch(/persona/i);
  });

  it('preserves add-user validation and role selection', () => {
    const markup = renderToStaticMarkup(
      <table>
        <tfoot>
          <RosterAddRow
            draft=""
            role="admin"
            busy={false}
            onDraftChange={() => {}}
            onRoleChange={() => {}}
            onAdd={() => {}}
          />
        </tfoot>
      </table>
    );
    expect(markup).toContain('placeholder="name@example.com"');
    expect(markup).toContain('aria-label="User role to give them');
    expect(markup).not.toMatch(/persona/i);
  });
});
