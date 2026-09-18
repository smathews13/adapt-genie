/**
 * App groups: named sets of people an administrator maintains so Monitoring can
 * be sliced by who asked.
 *
 * WHAT THIS PANEL CHANGES, AND WHAT IT DOES NOT. It edits one shared document —
 * the deployment's app groups and their members. It grants nothing: a group is a
 * label for filtering, never a permission or a Unity Catalog grant, exactly as an
 * ADAPT role is not (see the note in shared/app-groups.ts and UserRoleEditor).
 *
 * WHO SEES IT. Rendered in the Identity section for an administrator or super
 * administrator (`canManage`). The server is authoritative: every write goes to
 * an `/api/admin` route the admin guard covers, so a consumer who reached this
 * markup would be refused by the route regardless of what the screen drew.
 *
 * MEMBERS COME FROM THE ROSTER. New members are chosen from the people this
 * deployment already knows (`/api/users`), so a group cannot accumulate typos or
 * addresses nobody here recognises.
 *
 * EVERY EDIT IS A FULL SAVE. The document is small and the store merges a patch's
 * arrays as a unit, so each change sends the whole next group list with the
 * revision this editor last read. A second administrator's concurrent change is
 * caught by that revision (409) rather than silently overwritten.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trash2, UserPlus, UsersRound } from 'lucide-react';
import { Button, Input } from './ui';
import { AppSelect } from './AppSelect';
import { AdaptBusyButtonContent, AdaptLoader } from './AdaptLoadingAnimation';
import { UserDrilldownLink } from './UserDrilldownLink';
import type { AppGroup, AppGroupsSettings } from '../../shared/app-groups';
import { normalizeMemberEmail } from '../../shared/app-groups';
import { AppGroupsError, loadAppGroups, saveAppGroups } from './app-groups-api';
import { loadHumanRoster } from './identity-settings-api';
import { rosterEmailError } from './user-roster';

/** The unselected value for the add-member menu; Radix refuses the empty string. */
const ADD_MEMBER = '__add_member__';

/** A stable id for a new group. `crypto.randomUUID` is available in every target browser. */
function newGroupId(): string {
  return `grp_${crypto.randomUUID()}`;
}

function memberCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'member' : 'members'}`;
}

/** One group card: its name, its members, and the controls to change both. */
function AppGroupCard({
  group,
  roster,
  rosterReadable,
  busy,
  onRename,
  onAddMember,
  onRemoveMember,
  onDelete,
}: {
  group: AppGroup;
  roster: readonly string[];
  /**
   * Whether the individual-user roster could be read. It is a super-admin-only
   * endpoint, so a plain administrator gets none of it — and then the members are
   * typed rather than picked, because the requirement is that administrators as
   * well as super administrators can add people.
   */
  rosterReadable: boolean;
  busy: boolean;
  onRename: (id: string, name: string) => void;
  onAddMember: (id: string, email: string) => Promise<boolean>;
  onRemoveMember: (id: string, email: string) => void;
  onDelete: (id: string) => void;
}) {
  const [emailDraft, setEmailDraft] = useState('');
  const [emailError, setEmailError] = useState('');

  // Validate a typed address before it can become a member. The roster-select
  // path cannot produce a bad value, but this typed fallback (a plain admin who
  // cannot read the super-admin-only roster) otherwise could, and a member that
  // is not a real address can never match an asker.
  const submitTypedEmail = () => {
    const problem = rosterEmailError(emailDraft);
    if (problem) {
      setEmailError(problem);
      return;
    }
    setEmailError('');
    void onAddMember(group.id, emailDraft).then((saved) => {
      if (saved) setEmailDraft('');
    });
  };
  const [nameDraft, setNameDraft] = useState(group.name);
  // When a save changes the stored name, adopt it as the new draft. Adjusting
  // state during render (the documented React pattern) rather than in an effect:
  // the input tracks the last-seen stored name without a cascading re-render.
  const [seenName, setSeenName] = useState(group.name);
  if (group.name !== seenName) {
    setSeenName(group.name);
    setNameDraft(group.name);
  }

  // People the deployment knows who are not already in this group.
  const addable = useMemo(() => {
    const present = new Set(group.members);
    return roster.filter((email) => !present.has(email));
  }, [group.members, roster]);

  const commitName = () => {
    const next = nameDraft.trim();
    if (!next || next === group.name) {
      setNameDraft(group.name);
      return;
    }
    onRename(group.id, next);
  };

  return (
    <div className="app-group-card settings-table-frame">
      <div className="app-group-head">
        <Input
          className="app-group-name"
          value={nameDraft}
          disabled={busy}
          aria-label={`Name of team ${group.name}`}
          onChange={(event) => setNameDraft(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitName();
            }
          }}
        />
        <span className="app-group-count">{memberCountLabel(group.members.length)}</span>
        <Button
          type="button"
          variant="destructive"
          data-variant="destructive"
          size="icon"
          className="settings-destructive"
          disabled={busy}
          aria-label={`Delete team ${group.name}`}
          title="Delete team"
          onClick={() => onDelete(group.id)}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>

      {group.members.length > 0 ? (
        <ul className="app-group-members">
          {group.members.map((email) => (
            <li key={email} className="app-group-member">
              <UserDrilldownLink identity={email} variant="text" canOpen>
                {email}
              </UserDrilldownLink>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={busy}
                aria-label={`Remove ${email} from ${group.name}`}
                title="Remove from group"
                onClick={() => onRemoveMember(group.id, email)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="admin-list-note">No members yet. Add people from the roster below.</p>
      )}

      <div className="app-group-add-member">
        {rosterReadable ? (
          <AppSelect
            label="Add member"
            ariaLabel={`Add a member to ${group.name}`}
            value={ADD_MEMBER}
            disabled={busy || addable.length === 0}
            onValueChange={(email) => {
              if (email !== ADD_MEMBER) void onAddMember(group.id, email);
            }}
            options={[
              {
                value: ADD_MEMBER,
                label: addable.length === 0 ? 'Everyone on the roster is a member' : 'Add member…',
              },
              ...addable.map((email) => ({ value: email, label: email })),
            ]}
            className="app-group-member-select"
          />
        ) : (
          <>
            <Input
              type="email"
              className="app-group-member-select"
              value={emailDraft}
              disabled={busy}
              placeholder="name@example.com"
              aria-label={`Add a member to ${group.name} by email`}
              aria-invalid={Boolean(emailError)}
              onChange={(event) => {
                setEmailDraft(event.target.value);
                if (emailError) setEmailError('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && emailDraft.trim()) {
                  event.preventDefault();
                  submitTypedEmail();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              data-variant="outline"
              disabled={busy || !emailDraft.trim()}
              onClick={submitTypedEmail}
            >
              <UserPlus aria-hidden="true" />
              Add
            </Button>
            {emailError ? (
              <span className="admin-list-error" role="alert">
                {emailError}
              </span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export function AppGroupEditor({ canManage = false }: { canManage?: boolean }) {
  const [settings, setSettings] = useState<AppGroupsSettings | null>(null);
  const [revision, setRevision] = useState(0);
  const [roster, setRoster] = useState<string[]>([]);
  const [rosterReadable, setRosterReadable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState('');
  const [notice, setNotice] = useState('');
  const [newName, setNewName] = useState('');
  const mutationInFlight = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const [groupsResult, rosterResult] = await Promise.allSettled([loadAppGroups(), loadHumanRoster()]);
    if (groupsResult.status === 'fulfilled') {
      setSettings(groupsResult.value.settings);
      setRevision(groupsResult.value.revision);
    } else {
      setError(groupsResult.reason instanceof Error ? groupsResult.reason.message : 'Teams could not be read.');
    }
    if (rosterResult.status === 'fulfilled') {
      setRoster(
        [...new Set(rosterResult.value.entries.map((entry) => normalizeMemberEmail(entry.email)))]
          .filter(Boolean)
          .sort()
      );
      setRosterReadable(true);
    } else {
      // A plain administrator cannot read the super-admin-only roster. That is
      // not an error here: the card falls back to typing an email address.
      setRosterReadable(false);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Persist the next group list, guarding against a second concurrent click and
   * keeping the server's confirmed revision for the next save.
   */
  const commit = useCallback(
    async (nextGroups: AppGroup[], said: string): Promise<boolean> => {
      if (mutationInFlight.current || !canManage) return false;
      mutationInFlight.current = true;
      setBusy(true);
      setWriteError('');
      setNotice('');
      try {
        const document = await saveAppGroups({ groups: nextGroups }, revision);
        setSettings(document.settings);
        setRevision(document.revision);
        setNotice(said);
        return true;
      } catch (cause) {
        const conflict = cause instanceof AppGroupsError && cause.kind === 'conflict';
        setWriteError(cause instanceof Error ? cause.message : 'The teams were not saved. Try again.');
        // A conflict means somebody else wrote; reload so the editor rebases on
        // the current truth rather than repeatedly refusing.
        if (conflict) await load();
        return false;
      } finally {
        mutationInFlight.current = false;
        setBusy(false);
      }
    },
    [canManage, load, revision]
  );

  const groups = settings?.groups ?? [];

  const createGroup = () => {
    const name = newName.trim();
    if (!name || busy) return;
    // Clear the input only once the save is confirmed. A 409/503 keeps the typed
    // name so the administrator can retry without retyping it.
    void commit([...groups, { id: newGroupId(), name, members: [] }], `Created the “${name}” team.`).then((saved) => {
      if (saved) setNewName('');
    });
  };

  const renameGroup = (id: string, name: string) =>
    void commit(
      groups.map((group) => (group.id === id ? { ...group, name } : group)),
      `Renamed the team to “${name}”.`
    );

  const deleteGroup = (id: string) => {
    const removed = groups.find((group) => group.id === id);
    void commit(
      groups.filter((group) => group.id !== id),
      removed ? `Deleted the “${removed.name}” team.` : 'Deleted the team.'
    );
  };

  const addMember = (id: string, email: string): Promise<boolean> => {
    const address = normalizeMemberEmail(email);
    if (!address) return Promise.resolve(false);
    return commit(
      groups.map((group) =>
        group.id === id && !group.members.includes(address) ? { ...group, members: [...group.members, address] } : group
      ),
      `Added ${address} to the group.`
    );
  };

  const removeMember = (id: string, email: string) =>
    void commit(
      groups.map((group) =>
        group.id === id ? { ...group, members: group.members.filter((member) => member !== email) } : group
      ),
      `Removed ${email} from the group.`
    );

  return (
    <section className="settings-identity-section app-groups" aria-labelledby="app-groups-title">
      <h4 id="app-groups-title" className="settings-section-title">
        Teams
      </h4>
      <p className="admin-list-note">
        Organize people so Monitoring can be filtered by who asked. A team is app-specific and grants no access or
        Databricks permission.
      </p>

      {loading ? <AdaptLoader label="Reading teams" className="admin-list-note" /> : null}
      {error ? (
        <p className="admin-list-note admin-list-error" role="alert">
          {error} Reload the page to try again.
        </p>
      ) : null}

      {settings ? (
        <>
          {groups.length > 0 ? (
            <div className="app-group-list">
              {groups.map((group) => (
                <AppGroupCard
                  key={group.id}
                  group={group}
                  roster={roster}
                  rosterReadable={rosterReadable}
                  busy={busy || !canManage}
                  onRename={renameGroup}
                  onAddMember={addMember}
                  onRemoveMember={removeMember}
                  onDelete={deleteGroup}
                />
              ))}
            </div>
          ) : (
            <p className="admin-list-note">No teams yet.</p>
          )}

          {canManage ? (
            <div className="app-group-create">
              <Input
                value={newName}
                disabled={busy}
                placeholder="New team name"
                aria-label="New team name"
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && newName.trim()) {
                    event.preventDefault();
                    createGroup();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                data-variant="outline"
                disabled={busy || !newName.trim()}
                aria-busy={busy || undefined}
                onClick={createGroup}
              >
                <AdaptBusyButtonContent
                  busy={busy}
                  label="Add team"
                  busyLabel="Saving"
                  icon={<UsersRound aria-hidden="true" />}
                />
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      <p className="admin-list-note admin-list-outcome" role="status" aria-live="polite">
        {writeError || notice}
      </p>
      {!canManage && settings ? (
        <p className="admin-list-note">
          <UserPlus aria-hidden="true" /> Only administrators can change teams.
        </p>
      ) : null}
    </section>
  );
}
