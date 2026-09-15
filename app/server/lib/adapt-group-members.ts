import type { GroupMember, GroupMembersResponse } from '../../shared/user-roster-contract';
import { workspaceControlPlaneReader, type ControlPlaneReader } from './control-plane-identity';
import { ExpiringLruCache } from './expiring-lru';

export const SCIM_GROUPS_PATH = '/api/2.0/preview/scim/v2/Groups';
const MAX_GROUP_MEMBERS = 500;
const USER_READ_CONCURRENCY = 12;

/**
 * Expanding a group is one group read plus one SCIM user read per member (up to
 * MAX_GROUP_MEMBERS, twelve at a time), and the roster screen re-asks for the same
 * group as an operator pages, filters, and reopens it. Nothing about a workspace
 * group's membership changes second to second, so a short shared cache turns that
 * repeated fan-out into one round trip per group per minute -- which is what the
 * ops latency panel was flagging as "slower than baseline" on this route.
 *
 * Only the production identity's reads are cached, and only readable answers: a
 * test that injects its own reader always sees a fresh call, and a transient
 * permission or transport failure is never remembered as if it were the truth.
 */
const GROUP_MEMBERS_CACHE_MAX_ENTRIES = 32;
const GROUP_MEMBERS_TTL_MS = 60_000;
const groupMembersCache = new ExpiringLruCache<GroupMembersResponse>(
  GROUP_MEMBERS_CACHE_MAX_ENTRIES,
  GROUP_MEMBERS_TTL_MS
);

/** Drop any cached membership so a deliberate re-read (or a test) starts clean. */
export function clearGroupMembersCache(): void {
  groupMembersCache.clear();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalized(value: unknown): string {
  return text(value).toLocaleLowerCase();
}

function resources(body: unknown): Record<string, unknown>[] {
  const rows = record(body).Resources;
  return Array.isArray(rows) ? rows.map(record) : [];
}

function scimFilterLiteral(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export interface WorkspaceGroupRead {
  groupName: string;
  groupId: string;
  exists: boolean;
  readable: boolean;
}

export interface WorkspaceGroupOption {
  id: string;
  displayName: string;
}

export interface WorkspaceGroupsResponse {
  groups: WorkspaceGroupOption[];
  readable: boolean;
  detail: string;
}

/** List workspace groups visible to the app identity for a point-and-click picker. */
export async function listWorkspaceGroups(
  reader: ControlPlaneReader = workspaceControlPlaneReader
): Promise<WorkspaceGroupsResponse> {
  try {
    const listing = await reader(SCIM_GROUPS_PATH, { count: '500', startIndex: '1' });
    const groups = resources(listing)
      .map((group) => ({
        id: text(group.id),
        displayName: text(group.displayName),
      }))
      .filter((group) => group.id && group.displayName)
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
    return { groups, readable: true, detail: '' };
  } catch {
    return {
      groups: [],
      readable: false,
      detail: 'Workspace groups could not be listed with this deployment’s permissions.',
    };
  }
}

/** Confirm one exact existing workspace group without creating or changing it. */
export async function readWorkspaceGroup(
  groupName: string,
  reader: ControlPlaneReader = workspaceControlPlaneReader
): Promise<WorkspaceGroupRead> {
  const requested = groupName.trim();
  if (!requested) return { groupName: '', groupId: '', exists: false, readable: true };
  try {
    const listing = await reader(SCIM_GROUPS_PATH, {
      filter: `displayName eq ${scimFilterLiteral(requested)}`,
      count: '100',
    });
    const group = resources(listing).find((candidate) => normalized(candidate.displayName) === normalized(requested));
    return {
      groupName: text(group?.displayName) || requested,
      groupId: text(group?.id),
      exists: Boolean(text(group?.id)),
      readable: true,
    };
  } catch {
    return { groupName: requested, groupId: '', exists: false, readable: false };
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  visit: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await visit(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

/** Expand one configured workspace group into individual user emails. */
export async function readAdaptGroupMembers(
  groupName: string,
  reader: ControlPlaneReader = workspaceControlPlaneReader
): Promise<GroupMembersResponse> {
  const requested = groupName.trim();
  if (!requested) return { groupName: '', members: [], readable: false, detail: 'No workspace group was named.' };
  const cacheable = reader === workspaceControlPlaneReader;
  const cacheKey = requested.toLocaleLowerCase();
  if (cacheable) {
    const cached = groupMembersCache.get(cacheKey);
    if (cached) return cached;
  }
  try {
    const found = await readWorkspaceGroup(requested, reader);
    const id = found.groupId;
    if (!found.readable) {
      return {
        groupName: requested,
        members: [],
        readable: false,
        detail: 'Workspace membership could not be read with this app deployment’s permissions.',
      };
    }
    if (!id) {
      return {
        groupName: requested,
        members: [],
        readable: false,
        detail: `The workspace group ${requested} was not found.`,
      };
    }
    const body = record(await reader(`${SCIM_GROUPS_PATH}/${encodeURIComponent(id)}`));
    const allMembers = Array.isArray(body.members) ? body.members.map(record) : [];
    const rawMembers = allMembers.slice(0, MAX_GROUP_MEMBERS);
    const resolved = await mapWithConcurrency(rawMembers, USER_READ_CONCURRENCY, async (member) => {
      const memberId = text(member.value);
      const memberLabel = text(member.display);
      if (!memberId) return null;
      try {
        const user = record(await reader(`/api/2.0/preview/scim/v2/Users/${encodeURIComponent(memberId)}`));
        const email = text(user.userName);
        if (!email) return null;
        return { email, displayName: text(user.displayName) || memberLabel || email } satisfies GroupMember;
      } catch {
        return memberLabel.includes('@')
          ? ({ email: memberLabel, displayName: memberLabel } satisfies GroupMember)
          : null;
      }
    });
    const deduplicated = new Map<string, GroupMember>();
    for (const member of resolved) {
      if (member) deduplicated.set(normalized(member.email), member);
    }
    const members = [...deduplicated.values()].sort(
      (left, right) => left.displayName.localeCompare(right.displayName) || left.email.localeCompare(right.email)
    );
    const unresolved = rawMembers.length - members.length;
    const result: GroupMembersResponse = {
      groupName: requested,
      members,
      readable: true,
      detail:
        allMembers.length > MAX_GROUP_MEMBERS
          ? `Showing the first ${MAX_GROUP_MEMBERS} members.`
          : unresolved > 0
            ? `${unresolved} nested group or unreadable member ${unresolved === 1 ? 'was' : 'were'} omitted.`
            : '',
    };
    if (cacheable) groupMembersCache.set(cacheKey, result);
    return result;
  } catch {
    return {
      groupName: requested,
      members: [],
      readable: false,
      detail: 'Workspace membership could not be read with this app deployment’s permissions.',
    };
  }
}
