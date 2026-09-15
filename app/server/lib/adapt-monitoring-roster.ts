import { createHash } from 'node:crypto';
import type { Request } from 'express';

import type { Role } from '../../shared/user-roster-contract';
import type { AdminStore } from './admin-identity';
import { readAdaptGroupMembers } from './adapt-group-members';
import { adaptAdminGroupLabel, adaptUserGroupLabel } from './adapt-group-roles';
import { everyKnownUser, readRosterForRequest, type SeedRoles } from './user-roster';

export interface AdaptMonitoringRosterEntry {
  email: string;
  role: Role;
}

export interface AdaptMonitoringRoster {
  entries: AdaptMonitoringRosterEntry[];
  complete: boolean;
  reason: string;
  revision: string;
}

export type AdaptGroupMembersReader = typeof readAdaptGroupMembers;

/** Resolve explicit roles and both configured access groups into one monitoring roster. */
export async function readAdaptMonitoringRoster(
  store: AdminStore,
  req: Request,
  seed: SeedRoles,
  readGroupMembers: AdaptGroupMembersReader = readAdaptGroupMembers
): Promise<AdaptMonitoringRoster> {
  const roster = await readRosterForRequest(store, req);
  const entries = new Map(
    everyKnownUser({ seed, stored: roster.rows }).map((entry) => [entry.email.toLowerCase(), entry])
  );
  const configuredGroups = [
    { groupName: adaptAdminGroupLabel(), role: 'admin' as const },
    { groupName: adaptUserGroupLabel(), role: 'consumer' as const },
  ].filter((mapping) => mapping.groupName);
  const groups = await Promise.all(
    configuredGroups.map(async (mapping) => {
      try {
        return { ...mapping, ...(await readGroupMembers(mapping.groupName)) };
      } catch (error) {
        return {
          ...mapping,
          readable: false,
          members: [],
          detail: error instanceof Error ? error.message : 'Workspace group membership could not be read.',
        };
      }
    })
  );
  for (const group of groups) {
    for (const member of group.members) {
      const email = member.email.trim().toLowerCase();
      if (!email) continue;
      const current = entries.get(email);
      if (current?.role === 'super_admin' || current?.role === 'admin') continue;
      if (group.role === 'admin' || current === undefined) entries.set(email, { email, role: group.role });
    }
  }
  const reason = groups
    .map(
      (group) => group.detail || (!group.readable ? `The workspace group ${group.groupName} could not be read.` : '')
    )
    .filter(Boolean)
    .join(' ');
  const revision = createHash('sha256')
    .update(
      [
        ...roster.rows.map((row) => `${row.email.toLowerCase()}:${row.role}:${row.setAt}`),
        ...groups.map(
          (group) =>
            `${group.groupName.toLowerCase()}:${group.role}:${group.readable ? 'readable' : 'unreadable'}:${group.detail}`
        ),
        ...groups.flatMap((group) =>
          group.members.map((member) => `${member.email.trim().toLowerCase()}:${group.role}`)
        ),
      ]
        .sort()
        .join('|')
    )
    .digest('hex')
    .slice(0, 24);
  return {
    entries: [...entries.values()],
    complete: groups.every((group) => group.readable && !group.detail),
    reason,
    revision,
  };
}
