import { z } from 'zod';

/**
 * App groups: named sets of people, maintained by administrators, used to slice
 * Monitoring by who asked.
 *
 * WHAT AN APP GROUP IS, AND IS NOT. It is a label an administrator hangs on a set
 * of email addresses so the review surface can answer "what did this team ask".
 * It is NOT a permission and NOT a Unity Catalog grant: putting somebody in a
 * group changes nothing about what they may read or open, exactly as a role does
 * not (see user-roster-contract.ts). The only thing a group does is give
 * Monitoring a dimension to filter on.
 *
 * MEMBERSHIP IS BY EMAIL AND MAY OVERLAP. A person can belong to several groups
 * at once, so a single question can match more than one group. Membership is
 * resolved from the asker's email at read time rather than snapshotted onto the
 * question, which is what lets a group created today filter questions asked
 * before it existed, and lets editing a group re-bucket old questions.
 *
 * ONE DOCUMENT. The whole configuration is a single versioned settings document,
 * on the same store and the same optimistic-revision discipline as the watchlist
 * (see versioned-settings-store.ts). The editor sends the full group list on
 * every change; arrays replace as a unit in a patch, so a save is the new truth.
 */

export const APP_GROUPS_MAX = 50;
export const APP_GROUP_MEMBERS_MAX = 1000;
export const APP_GROUP_NAME_MAX = 120;
export const APP_GROUP_ID_MAX = 64;
export const APP_GROUP_EMAIL_MAX = 320;

export const AppGroupSchema = z.strictObject({
  /** Stable opaque id the editor mints; never shown, used to address the group. */
  id: z.string().trim().min(1).max(APP_GROUP_ID_MAX),
  /** The customer-facing label. */
  name: z.string().trim().min(1).max(APP_GROUP_NAME_MAX),
  /** Member email addresses, lower-cased and de-duplicated by {@link parseAppGroupsSettings}. */
  members: z.array(z.string().trim().min(1).max(APP_GROUP_EMAIL_MAX)).max(APP_GROUP_MEMBERS_MAX),
});

export const AppGroupsSettingsSchema = z.strictObject({
  groups: z.array(AppGroupSchema).max(APP_GROUPS_MAX),
});

export const AppGroupsPatchSchema = AppGroupsSettingsSchema.partial();

export type AppGroup = z.infer<typeof AppGroupSchema>;
export type AppGroupsSettings = z.infer<typeof AppGroupsSettingsSchema>;

/** A group as the Monitoring filter menu needs it: the id it filters by and the name it shows. */
export interface AppGroupOption {
  id: string;
  name: string;
}

export const DEFAULT_APP_GROUPS_SETTINGS: AppGroupsSettings = { groups: [] };

/** One email address, trimmed and lower-cased, the single spelling every read compares. */
export function normalizeMemberEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Validate and canonicalize a stored or submitted document.
 *
 * Member emails are lower-cased and de-duplicated within a group, and a group
 * whose id has already been seen is dropped rather than merged, because two
 * groups sharing an id could not be told apart by the filter that addresses one.
 */
export function parseAppGroupsSettings(value: unknown): AppGroupsSettings {
  const parsed = AppGroupsSettingsSchema.parse(value);
  const seenIds = new Set<string>();
  const groups: AppGroup[] = [];
  for (const group of parsed.groups) {
    const id = group.id.trim();
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    const seenMembers = new Set<string>();
    const members: string[] = [];
    for (const raw of group.members) {
      const email = normalizeMemberEmail(raw);
      if (!email || seenMembers.has(email)) continue;
      seenMembers.add(email);
      members.push(email);
    }
    groups.push({ id, name: group.name.trim(), members });
  }
  return { groups };
}

/** The ids of every group an email belongs to, in the order the groups are stored. */
export function appGroupsForEmail(settings: AppGroupsSettings, email: string): string[] {
  const needle = normalizeMemberEmail(email);
  if (!needle) return [];
  return settings.groups.filter((group) => group.members.includes(needle)).map((group) => group.id);
}

/** Every member email of one group, or an empty array when the group is unknown. */
export function memberEmailsForGroup(settings: AppGroupsSettings, groupId: string): string[] {
  const id = groupId.trim();
  if (!id) return [];
  return settings.groups.find((group) => group.id === id)?.members ?? [];
}

/** The groups as the filter menu needs them, ordered by name. */
export function appGroupOptions(settings: AppGroupsSettings): AppGroupOption[] {
  return settings.groups
    .map((group) => ({ id: group.id, name: group.name }))
    .sort((left, right) => left.name.localeCompare(right.name));
}
