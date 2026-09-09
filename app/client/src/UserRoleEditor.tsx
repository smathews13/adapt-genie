/**
 * The roster: who this deployment knows, and what each of them may open.
 *
 * DRAWN ONLY FOR THE SUPER ADMIN, AND THAT IS NOT THE PERMISSION. `/api/users`
 * refuses a plain administrator with 403 whatever this component does. Not drawing
 * it is why an administrator does not meet a panel every control on which the server
 * would refuse.
 *
 * WHAT MAY BE DONE TO A ROW COMES FROM THE SERVER, never from a rule written here.
 * Each row arrives with the roles it may be changed to and whether it may be
 * removed, because the control on screen and the refusal on the route have to be one
 * rule rather than two implementations of one. A menu offering a change the route
 * would refuse is the failure that shape prevents.
 *
 * A PROMOTION IS ONE FACT: A ROW IN LAKEBASE. It used to be two. Appointing an
 * administrator also asked Unity Catalog for read on the telemetry schema and the
 * `system.billing` tables, and each row carried the outcome. Granting on `system`
 * needs an account admin who is also a metastore admin, so the panel's usual state
 * was a refusal beside a person who had just been promoted successfully. Read access
 * to billing is a separate request to a metastore admin, and it is not a condition
 * of the role, so it is no longer on this screen.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, ExternalLink, Trash2, UserPlus, UsersRound } from 'lucide-react';
import { Button, Input } from './ui';
import { AdaptBusyButtonContent } from './AdaptLoadingAnimation';
import { ConceptFlicker } from './ConceptFlicker';
import { CopyableCommand } from './AdminListEditor';
import {
  addDisabledReason,
  canSubmit,
  claimRosterMutation,
  normalizeRosterEmail,
  roleWord,
  rosterEmailError,
  stepsDownFrom,
  submittedDraftIsCurrent,
  type RosterEntry,
} from './user-roster';
import type { Role, RosterPayload } from '../../shared/user-roster-contract';
import { AppSelect } from './AppSelect';
import { roleOptions } from './user-role-options';
import { RoleBadgePill } from './RoleBadge';
import { OrganizationAvatar } from './OrganizationAvatar';
import { UserDrilldownLink } from './UserDrilldownLink';
import { organizationForEmail } from '../../shared/organization-mapping';
import { notifyIdentitySettingsChanged } from './identity-settings-events';
import {
  changeHumanRole,
  loadGroupMembers,
  loadHumanRoster,
  loadWorkspaceGroups,
  writeGroupRoleMapping,
  writeHumanRoster,
} from './identity-settings-api';

/** A super admin may appoint any role directly from the add row. The server
 * remains authoritative for promotion and last-super-admin safeguards. */
const ADDABLE_ROLES: readonly Role[] = ['super_admin', 'admin', 'consumer'];

/**
 * One row's role control, or the line saying why there is none.
 *
 * ABSENT RATHER THAN DISABLED, which is the decision this app already made for the
 * navigation: a greyed control a reader can never enable is a permanent invitation
 * to ask why. The line in its place says what to change instead.
 *
 * The shared app dropdown keeps the current role visible and preserves Radix's
 * keyboard navigation and typeahead.
 */
function RoleControl({
  entry,
  busy,
  onChange,
}: {
  entry: RosterEntry;
  busy: boolean;
  onChange: (entry: RosterEntry, role: Role) => void;
}) {
  if (entry.assignable.length === 0) {
    return <RoleBadgePill state={entry.role} />;
  }
  return (
    <AppSelect
      label="User role"
      ariaLabel={`User role for ${entry.email}`}
      value={entry.role}
      disabled={busy}
      onValueChange={(role) => onChange(entry, role)}
      options={roleOptions(entry).map((option) => ({
        ...option,
        content: <RoleBadgePill state={option.value} />,
      }))}
      className="roster-control roster-role-select"
    />
  );
}

/** The table footer is a row, not a floating form, so every control shares the
 * same explicit column geometry as the identities above it. Exported to keep
 * enabled, disabled and alignment states render-tested without a network read. */
export function RosterAddRow({
  draft,
  role,
  busy,
  adding = false,
  error = '',
  descriptionId = 'roster-add-description',
  onDraftChange,
  onRoleChange,
  onAdd,
}: {
  draft: string;
  role: Role;
  busy: boolean;
  adding?: boolean;
  error?: string;
  descriptionId?: string;
  onDraftChange: (value: string) => void;
  onRoleChange: (role: Role) => void;
  onAdd: () => void;
}) {
  const validationError = draft.trim() ? rosterEmailError(draft) : '';
  const feedback = error || (draft.trim() ? validationError : '');
  const disabledReason = addDisabledReason(draft, role, busy);
  return (
    <tr className="roster-add-row">
      <td className="roster-email">
        <Input
          type="email"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || !canSubmit(draft, busy, role)) return;
            event.preventDefault();
            onAdd();
          }}
          placeholder="name@example.com"
          aria-label="Email address to put on the roster"
          aria-invalid={Boolean(feedback)}
          aria-describedby={descriptionId}
        />
        <span
          id={descriptionId}
          className={`roster-add-feedback${feedback ? ' admin-list-error' : ''}`}
          role={feedback ? 'alert' : undefined}
        >
          {feedback}
        </span>
      </td>
      <td className="roster-organization">—</td>
      <td className="roster-role">
        <AppSelect<Role>
          label="User role"
          ariaLabel="User role to give them"
          value={role}
          disabled={busy}
          onValueChange={onRoleChange}
          options={ADDABLE_ROLES.map((option) => ({
            value: option,
            label: roleWord(option),
            content: <RoleBadgePill state={option} />,
          }))}
          className="roster-control roster-role-select"
        />
      </td>
      <td className="roster-action">
        <Button
          type="button"
          variant="outline"
          data-variant="outline"
          className="roster-control roster-action-button"
          disabled={Boolean(disabledReason)}
          title={disabledReason || `Add ${normalizeRosterEmail(draft)} as ${roleWord(role)}`}
          aria-describedby={descriptionId}
          aria-busy={adding || undefined}
          onClick={onAdd}
        >
          <AdaptBusyButtonContent
            busy={adding}
            label="Add"
            busyLabel="Adding"
            icon={<UserPlus className="roster-action-icon" aria-hidden="true" />}
          />
        </Button>
      </td>
    </tr>
  );
}

/**
 * The rows, as a function of the payload and nothing else.
 *
 * Split from the editor below so they can be rendered in a test without a fetch or
 * an effect. That matters more here than it usually does: the claims worth defending
 * are about which controls a row offers in each state, and asserting them against
 * the source of a component nobody rendered is how this repository has shipped
 * screens that were wrong while every test passed.
 */
export function RosterRows({
  payload,
  busy,
  onChange,
  onRemove,
  manageHumanRoles = true,
  footer,
}: {
  payload: RosterPayload;
  busy: boolean;
  onChange: (entry: RosterEntry, role: Role) => void;
  onRemove: (entry: RosterEntry) => void;
  manageHumanRoles?: boolean;
  footer?: ReactNode;
}) {
  const rows = payload.entries
    .map((entry) => ({
      entry,
      organization: organizationForEmail(entry.email, payload.organizations ?? []),
    }))
    .sort(
      (left, right) =>
        right.organization.name.localeCompare(left.organization.name) ||
        left.entry.email.localeCompare(right.entry.email)
    );

  return (
    <>
      {/* The way back into a deployment nobody can administer. Present only when
          nobody can act at all, which is the one state where there is nobody to
          withhold it from. */}
      {payload.recoveryStatement ? (
        <CopyableCommand command={payload.recoveryStatement} label="Appoint a super admin" />
      ) : null}

      {payload.pendingSchemaStatement ? (
        <CopyableCommand command={payload.pendingSchemaStatement} label="Add the role column" />
      ) : null}

      <div className="settings-table-frame roster-frame">
        <table
          className={`settings-data-table roles-table roles-table--${
            manageHumanRoles ? 'editable' : 'assignment-only'
          }${manageHumanRoles ? ' settings-actions-table' : ''}`}
        >
          <colgroup>
            <col className="roster-email-column" />
            <col className="roster-organization-column" />
            <col className="roster-role-column" />
            {manageHumanRoles ? <col className="roster-action-column" /> : null}
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Organization</th>
              <th scope="col">User role</th>
              {manageHumanRoles ? <th scope="col">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ entry, organization }) => {
              return (
                <tr key={entry.email} className="admin-row">
                  <td className="roster-email" title={entry.email}>
                    <span className="admin-row-email">
                      <span className="roster-email-details">
                        <UserDrilldownLink
                          identity={entry.email}
                          variant="text"
                          className="admin-row-address"
                          title={entry.email}
                          canOpen
                        >
                          {entry.email}
                        </UserDrilldownLink>
                      </span>
                      {entry.isYou ? <span className="admin-row-you">you</span> : null}
                      {entry.isDeploymentOwner ? (
                        <span
                          title="Owner: creator of this app's earliest successful deployment"
                          className="ast-pill roster-owner-badge"
                        >
                          Owner
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="roster-organization">
                    <span className="roster-organization-value">
                      <OrganizationAvatar organization={organization} />
                      <span>{organization.name}</span>
                    </span>
                  </td>
                  <td className="roster-role">
                    <RoleControl
                      entry={manageHumanRoles ? entry : { ...entry, assignable: [] }}
                      busy={busy}
                      onChange={onChange}
                    />
                  </td>
                  {manageHumanRoles ? (
                    <td className="roster-action">
                      {entry.canRemove ? (
                        <Button
                          variant="destructive"
                          data-variant="destructive"
                          className="roster-control settings-destructive roster-action-button"
                          size="sm"
                          disabled={busy}
                          onClick={() => onRemove(entry)}
                          aria-label={`Remove ${entry.email}`}
                        >
                          <Trash2 className="roster-action-icon" aria-hidden="true" />
                          Remove
                        </Button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
          {footer ? <tfoot>{footer}</tfoot> : null}
        </table>
      </div>
    </>
  );
}

type GroupRoleEntry = NonNullable<RosterPayload['groupRoleDefaults']>[number];

function GroupIdentityLink({ entry, label }: { entry: GroupRoleEntry; label: string }) {
  if (!entry.scimConfirmed || !entry.identityManagementUrl) return <>{label}</>;
  return (
    <a
      className="admin-row-address group-role-link"
      href={entry.identityManagementUrl}
      target="_blank"
      rel="noreferrer"
      title={`Open Databricks identity management for ${entry.groupName}`}
    >
      {label}
      <ExternalLink aria-hidden="true" />
    </a>
  );
}

function GroupRoleRow({ entry }: { entry: GroupRoleEntry }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<Array<{ email: string; displayName: string }> | null>(null);
  const [detail, setDetail] = useState('');

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || members) return;
    setLoading(true);
    setDetail('');
    try {
      const result = await loadGroupMembers(entry.groupName);
      setMembers(result.members);
      setDetail(result.detail);
    } catch (cause) {
      setDetail(cause instanceof Error ? cause.message : 'Workspace membership could not be read.');
      setMembers(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <tr className="admin-row group-role-row">
        <td className="roster-email" title={entry.displayName}>
          <div className="group-role-identity">
            <button
              type="button"
              className="group-role-toggle"
              aria-expanded={open}
              aria-label={`${open ? 'Hide' : 'Show'} members of ${entry.displayName}`}
              onClick={() => void toggle()}
            >
              <ChevronRight className={open ? 'rotate-90' : ''} aria-hidden="true" />
            </button>
            <span className="roster-email-details">
              {entry.displayName === entry.groupName ? (
                <GroupIdentityLink entry={entry} label={entry.groupName} />
              ) : (
                <span className="admin-row-address">{entry.displayName}</span>
              )}
              <span className="roster-organization-name">
                {entry.displayName !== entry.groupName ? (
                  <>
                    Workspace mapping: <GroupIdentityLink entry={entry} label={entry.groupName} />
                  </>
                ) : entry.source === 'bundle' ? (
                  `${entry.scimConfirmed ? 'Databricks identity management · ' : ''}Deployment bundle`
                ) : (
                  `${entry.scimConfirmed ? 'Databricks identity management · ' : ''}Mapped by ${
                    entry.setBy || 'a super admin'
                  }`
                )}
              </span>
            </span>
          </div>
        </td>
        <td className="roster-role">
          <RoleBadgePill state={entry.role} />
        </td>
        <td>{entry.appPermission === 'CAN_MANAGE' ? 'Can manage' : 'Can use'}</td>
      </tr>
      {open ? (
        <tr className="group-role-members-row">
          <td colSpan={3}>
            {loading ? (
              <p className="settings-status">
                <ConceptFlicker seat="inline" /> <span>Reading group members</span>
              </p>
            ) : null}
            {!loading && members ? (
              <div className="group-role-members">
                <p>
                  {members.length} individual {members.length === 1 ? 'member' : 'members'}
                </p>
                {members.length > 0 ? (
                  <ul>
                    {members.map((member) => (
                      <li key={member.email}>
                        <UserDrilldownLink identity={member.email} variant="text" canOpen>
                          {member.email}
                        </UserDrilldownLink>
                        {member.displayName && member.displayName !== member.email ? (
                          <span>{member.displayName}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {detail ? <p className="settings-status">{detail}</p> : null}
              </div>
            ) : null}
            {!loading && !members && detail ? (
              <p className="settings-status settings-error" role="alert">
                {detail} Close and reopen this group to retry.
              </p>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function GroupMappingAddRow({
  draft,
  role,
  busy,
  error,
  excludedGroups = [],
  onDraftChange,
  onRoleChange,
  onAdd,
}: {
  draft: string;
  role: Extract<Role, 'admin' | 'consumer'>;
  busy: boolean;
  error: string;
  excludedGroups?: readonly string[];
  onDraftChange: (value: string) => void;
  onRoleChange: (role: Extract<Role, 'admin' | 'consumer'>) => void;
  onAdd: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<Array<{ id: string; displayName: string }>>([]);
  const [groupState, setGroupState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const disabled = busy || !draft.trim();
  const openPicker = async () => {
    setOpen(true);
    if (groupState === 'ready' || groupState === 'loading') return;
    setGroupState('loading');
    try {
      const excluded = new Set(excludedGroups.map((name) => name.toLocaleLowerCase()));
      setGroups((await loadWorkspaceGroups()).filter((group) => !excluded.has(group.displayName.toLocaleLowerCase())));
      setGroupState('ready');
    } catch {
      setGroupState('failed');
    }
  };
  if (!open) {
    return (
      <tr className="roster-add-row group-mapping-add-row">
        <td colSpan={3}>
          <Button type="button" variant="outline" onClick={() => void openPicker()}>
            <UserPlus className="roster-action-icon" aria-hidden="true" />
            Add group
          </Button>
        </td>
      </tr>
    );
  }
  return (
    <tr className="roster-add-row group-mapping-add-row">
      <td>
        <AppSelect
          label="Workspace group"
          ariaLabel="Select a Databricks workspace group"
          value={draft}
          disabled={busy || groupState === 'loading' || groups.length === 0}
          onValueChange={onDraftChange}
          options={[
            { value: '', label: groupState === 'loading' ? 'Loading groups…' : 'Select a group' },
            ...groups.map((group) => ({
              value: group.displayName,
              label: group.displayName,
              code: group.id,
            })),
          ]}
          className="roster-control group-mapping-group-select"
        />
        {error || groupState === 'failed' ? (
          <span className={`roster-add-feedback${error ? ' admin-list-error' : ''}`} role={error ? 'alert' : undefined}>
            {error || 'Groups could not be listed with this deployment’s permissions.'}
          </span>
        ) : null}
        {groupState === 'failed' ? (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void openPicker()}>
            Retry
          </Button>
        ) : null}
      </td>
      <td className="roster-role">
        <AppSelect
          label="ADAPT role"
          ariaLabel="ADAPT role for the existing group"
          value={role}
          disabled={busy}
          onValueChange={onRoleChange}
          options={(['admin', 'consumer'] as const).map((option) => ({
            value: option,
            label: roleWord(option),
            content: <RoleBadgePill state={option} />,
          }))}
          className="roster-control roster-role-select"
        />
      </td>
      <td className="roster-action">
        <div className="group-mapping-actions">
          <Button
            type="button"
            variant="outline"
            className="roster-control roster-action-button"
            disabled={disabled}
            onClick={onAdd}
          >
            <UsersRound className="roster-action-icon" aria-hidden="true" />
            Add
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </td>
    </tr>
  );
}

export function GroupRoleDefaults({
  payload,
  canManage = false,
  footer,
}: {
  payload: RosterPayload;
  canManage?: boolean;
  footer?: ReactNode;
}) {
  if (!payload.groupRoleDefaults?.length && !footer) return null;
  return (
    <div className="settings-table-frame roster-frame">
      <table
        className={`settings-data-table roles-table group-roles-table${canManage ? ' settings-actions-table' : ''}`}
      >
        <thead>
          <tr>
            <th scope="col">Workspace group</th>
            <th scope="col">User role</th>
            <th scope="col" title="Display convention only; this does not change the Databricks App ACL.">
              App access display
            </th>
          </tr>
        </thead>
        <tbody>
          {payload.groupRoleDefaults?.map((entry) => (
            <GroupRoleRow key={entry.groupName} entry={entry} />
          ))}
        </tbody>
        {footer ? <tfoot>{footer}</tfoot> : null}
      </table>
    </div>
  );
}

export function UserRoleEditor({ canManageHumanRoles = true }: { canManageHumanRoles?: boolean }) {
  const [payload, setPayload] = useState<RosterPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [draftRole, setDraftRole] = useState<Role>('admin');
  const [busyAction, setBusyAction] = useState<'add' | 'other' | null>(null);
  const [writeError, setWriteError] = useState('');
  const [addError, setAddError] = useState('');
  const [groupDraft, setGroupDraft] = useState('');
  const [groupDraftRole, setGroupDraftRole] = useState<Extract<Role, 'admin' | 'consumer'>>('consumer');
  const [groupAddError, setGroupAddError] = useState('');
  const [notice, setNotice] = useState('');
  const loadGeneration = useRef(0);
  const mutationInFlight = useRef(false);
  const draftVersion = useRef(0);
  const addDescriptionId = useId();
  const busy = busyAction !== null;

  const load = useCallback(async (showLoading = true) => {
    const generation = ++loadGeneration.current;
    if (showLoading) setLoading(true);
    setError('');
    const humanResult = await Promise.resolve(loadHumanRoster()).then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason: unknown) => ({ status: 'rejected' as const, reason })
    );
    if (generation !== loadGeneration.current) return;
    if (humanResult.status === 'fulfilled') setPayload(humanResult.value);
    else {
      setError(
        humanResult.reason instanceof Error
          ? humanResult.reason.message
          : 'The individual-user roster could not be read.'
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * One synchronous latch sits in front of React state. Two clicks can arrive
   * before a disabled paint, but only the first may reach the server.
   */
  async function run<T>(
    work: () => Promise<T>,
    said: string,
    options: {
      action?: 'add' | 'other';
      apply?: (result: T) => void;
      onError?: (message: string) => void;
    } = {}
  ): Promise<boolean> {
    if (!claimRosterMutation(mutationInFlight)) return false;
    setBusyAction(options.action ?? 'other');
    setWriteError('');
    setNotice('');
    try {
      const result = await work();
      if (options.apply) {
        // Supersede any older read before applying the server-confirmed write
        // response. The mutation payload is the authoritative roster.
        loadGeneration.current += 1;
        options.apply(result);
      } else {
        await load(false);
      }
      notifyIdentitySettingsChanged();
      setNotice(said);
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The identity change failed. Try again.';
      if (options.onError) options.onError(message);
      else setWriteError(message);
      return false;
    } finally {
      mutationInFlight.current = false;
      setBusyAction(null);
    }
  }

  async function add() {
    const validationError = rosterEmailError(draft);
    if (validationError || busy) {
      if (validationError) setAddError(validationError);
      return;
    }
    const email = normalizeRosterEmail(draft);
    const submittedDraftVersion = draftVersion.current;
    setAddError('');
    const added = await run(
      () => writeHumanRoster('/api/users', 'POST', { email, role: draftRole }),
      `${email} is now ${roleWord(draftRole).toLowerCase()}.`,
      { action: 'add', apply: setPayload, onError: setAddError }
    );
    if (added && submittedDraftIsCurrent(submittedDraftVersion, draftVersion.current)) setDraft('');
  }

  async function addGroupMapping() {
    const groupName = groupDraft.trim();
    if (!groupName || busy) return;
    setGroupAddError('');
    const added = await run(
      () => writeGroupRoleMapping(groupName, groupDraftRole),
      `${groupName} now maps to ADAPT ${roleWord(groupDraftRole).toLowerCase()}. Databricks App access was not changed.`,
      { apply: setPayload, onError: setGroupAddError }
    );
    if (added) setGroupDraft('');
  }

  return (
    <div className="identity-table-content">
      <section className="settings-identity-section" aria-labelledby="human-roles-title">
        <h4 id="human-roles-title" className="settings-section-title">
          Identity roles
        </h4>
        {payload ? (
          <GroupRoleDefaults
            payload={payload}
            canManage={canManageHumanRoles}
            footer={
              canManageHumanRoles ? (
                <GroupMappingAddRow
                  draft={groupDraft}
                  role={groupDraftRole}
                  busy={busy}
                  error={groupAddError}
                  excludedGroups={payload.groupRoleDefaults?.map((entry) => entry.groupName) ?? []}
                  onDraftChange={(value) => {
                    setGroupDraft(value);
                    setGroupAddError('');
                  }}
                  onRoleChange={setGroupDraftRole}
                  onAdd={() => void addGroupMapping()}
                />
              ) : undefined
            }
          />
        ) : null}
        {loading ? (
          <div className="admin-list-note" role="status">
            <ConceptFlicker seat="inline" /> <span>Reading identity settings</span>
          </div>
        ) : null}
        {error ? (
          <p className="admin-list-note admin-list-error">
            The roster could not be read. Nobody has lost a role. Reload the page.
          </p>
        ) : null}
        {payload ? (
          <RosterRows
            payload={payload}
            busy={busy}
            manageHumanRoles={canManageHumanRoles}
            onChange={(entry, role) =>
              (() => {
                if (mutationInFlight.current) return;
                const before = payload;
                setPayload((current) =>
                  current
                    ? {
                        ...current,
                        entries: current.entries.map((row) => (row.email === entry.email ? { ...row, role } : row)),
                      }
                    : current
                );
                void run(
                  () => changeHumanRole(entry.email, role),
                  [`${entry.email} is now ${roleWord(role).toLowerCase()}.`, stepsDownFrom(entry, role)]
                    .filter(Boolean)
                    .join(' '),
                  {
                    apply: setPayload,
                    onError: (message) => {
                      setPayload(before);
                      setWriteError(message);
                    },
                  }
                );
              })()
            }
            onRemove={(entry) =>
              void run(
                () => writeHumanRoster(`/api/users/${encodeURIComponent(entry.email)}`, 'DELETE', {}),
                `${entry.email} is off the roster.`,
                { apply: setPayload }
              )
            }
            footer={
              canManageHumanRoles ? (
                <RosterAddRow
                  draft={draft}
                  role={draftRole}
                  busy={busy}
                  adding={busyAction === 'add'}
                  error={addError}
                  descriptionId={addDescriptionId}
                  onDraftChange={(value) => {
                    draftVersion.current += 1;
                    setDraft(value);
                    setAddError('');
                  }}
                  onRoleChange={setDraftRole}
                  onAdd={() => void add()}
                />
              ) : undefined
            }
          />
        ) : null}
      </section>

      <p className="admin-list-note admin-list-outcome" role="status" aria-live="polite">
        {writeError || notice}
      </p>
    </div>
  );
}
