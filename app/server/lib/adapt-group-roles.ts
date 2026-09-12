import type { Role } from '../../shared/user-roster-contract';
import type { SeedRoles } from './user-roster';
import { ExpiringLruCache } from './expiring-lru';
import { SCIM_USERS_PATH, workspaceControlPlaneReader, type ControlPlaneReader } from './control-plane-identity';

/** ADAPT's customer-managed identity groups, restored or recovered before import. */
export const ADAPT_ADMIN_GROUP = process.env.ADAPT_ADMIN_GROUP?.trim() || '';
export const ADAPT_USER_GROUP = process.env.ADAPT_USER_GROUP?.trim() || '';
export const ADAPT_ADMIN_GROUP_LABEL = process.env.ADAPT_ADMIN_GROUP_LABEL?.trim() || ADAPT_ADMIN_GROUP;
export const ADAPT_USER_GROUP_LABEL = process.env.ADAPT_USER_GROUP_LABEL?.trim() || ADAPT_USER_GROUP;

const GROUP_ROLE_TTL_MS = 60_000;
const GROUP_ROLE_CACHE_MAX_ENTRIES = 512;
const groupRoleCache = new ExpiringLruCache<Role | null>(GROUP_ROLE_CACHE_MAX_ENTRIES, GROUP_ROLE_TTL_MS);
const REQUEST_GROUP_ROLES = Symbol('request-group-roles');

type RequestGroupRoleCache = {
  [REQUEST_GROUP_ROLES]?: Map<string, Promise<Role | null>>;
};

export type GroupRoleLookup = (email: string) => Promise<Role | null>;
export interface GroupRoleMapping {
  groupName: string;
  role: Extract<Role, 'admin' | 'consumer'>;
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalized(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase() : '';
}

function scimFilterLiteral(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Read only group display names from one exact SCIM user result. */
export function scimGroupNames(body: unknown, email: string): string[] {
  const resources = recordOf(body).Resources;
  if (!Array.isArray(resources)) return [];
  const user = resources.map(recordOf).find((candidate) => normalized(candidate.userName) === normalized(email));
  if (!user || !Array.isArray(user.groups)) return [];
  return user.groups
    .map(recordOf)
    .map((group) => (typeof group.display === 'string' ? group.display.trim() : ''))
    .filter(Boolean);
}

/**
 * Map ADAPT group membership to the application role hierarchy.
 *
 * The admin group supplies the admin floor. Super admin remains an explicit
 * application role, so membership cannot silently gain the ability to appoint
 * other administrators. The users group maps to the existing consumer role;
 * callers outside both groups remain consumers because Databricks App CAN_USE
 * permissions are the outer access boundary.
 */
export function configuredGroupRoleMappings(): GroupRoleMapping[] {
  const mappings: GroupRoleMapping[] = [
    { groupName: ADAPT_ADMIN_GROUP, role: 'admin' },
    { groupName: ADAPT_USER_GROUP, role: 'consumer' },
  ];
  return mappings.filter((mapping) => mapping.groupName);
}

/**
 * Add operator-defined mappings without weakening either deployment access group.
 *
 * The configured admin group is an authorization floor, not an editable
 * suggestion. A stale Lakebase row must never turn its members into consumers.
 */
export function mergeGroupRoleMappings(
  configured: readonly GroupRoleMapping[],
  stored: readonly GroupRoleMapping[]
): GroupRoleMapping[] {
  const merged = new Map(configured.map((mapping) => [normalized(mapping.groupName), { ...mapping }]));
  for (const mapping of stored) {
    const key = normalized(mapping.groupName);
    if (key && !merged.has(key)) merged.set(key, { groupName: mapping.groupName.trim(), role: mapping.role });
  }
  return [...merged.values()];
}

export function roleFromGroupMappings(
  groups: readonly string[],
  mappings: readonly GroupRoleMapping[] = configuredGroupRoleMappings()
): Role | null {
  const names = new Set(groups.map((group) => normalized(group)));
  return mappings.some((mapping) => mapping.role === 'admin' && names.has(normalized(mapping.groupName)))
    ? 'admin'
    : mappings.some((mapping) => mapping.role === 'consumer' && names.has(normalized(mapping.groupName)))
      ? 'consumer'
      : null;
}

export function roleFromAdaptGroups(groups: readonly string[]): Role | null {
  return roleFromGroupMappings(groups);
}

/**
 * Resolve the signed-in user's group role as the app service principal.
 * Unavailable SCIM is absence of a group floor, never a promotion or denial.
 */
export async function adaptGroupRole(
  email: string,
  reader: ControlPlaneReader = workspaceControlPlaneReader,
  now = Date.now(),
  mappings: readonly GroupRoleMapping[] = configuredGroupRoleMappings()
): Promise<Role | null> {
  const emailKey = normalized(email);
  if (!emailKey) return null;
  const mappingKey = [...mappings]
    .map((mapping) => `${normalized(mapping.groupName)}:${mapping.role}`)
    .sort()
    .join('|');
  const key = `${emailKey}\u0000${mappingKey}`;
  const cached = groupRoleCache.get(key, now);
  if (cached !== undefined) return cached;
  try {
    const body = await reader(SCIM_USERS_PATH, { filter: `userName eq ${scimFilterLiteral(email.trim())}` });
    const role = roleFromGroupMappings(scimGroupNames(body, email), mappings);
    groupRoleCache.set(key, role, now);
    return role;
  } catch {
    return null;
  }
}

/**
 * Resolve one address once for the lifetime of an HTTP request.
 *
 * Both role guards and the roster handler need the same group fact. Keeping the
 * in-flight promise on the request prevents injected readers as well as SCIM
 * from being called once per layer, and makes every decision in that request
 * consume one deterministic answer.
 */
export function groupRoleForRequest(
  req: object,
  email: string,
  readGroupRole: GroupRoleLookup = adaptGroupRole
): Promise<Role | null> {
  const request = req as RequestGroupRoleCache;
  const key = normalized(email);
  if (!key) return Promise.resolve(null);
  const cache = request[REQUEST_GROUP_ROLES] ?? new Map<string, Promise<Role | null>>();
  request[REQUEST_GROUP_ROLES] = cache;
  const existing = cache.get(key);
  if (existing) return existing;
  const reading = readGroupRole(key).catch(() => null);
  cache.set(key, reading);
  return reading;
}

/**
 * Add group-derived floors to the immutable seed floors used by roster rules.
 *
 * The returned value is a snapshot: payload construction and mutation refusal
 * receive the same resolved inputs rather than making asynchronous decisions.
 */
export async function seedRolesWithGroupFloors(
  seed: SeedRoles,
  emails: readonly string[],
  readGroupRole: GroupRoleLookup
): Promise<SeedRoles> {
  const unique = [...new Set(emails.map(normalized).filter(Boolean))];
  const resolved = await Promise.all(unique.map(async (email) => [email, await readGroupRole(email)] as const));
  const superAdmins = new Set(seed.superAdmins.map(normalized));
  const admins = new Set(seed.admins.map(normalized));
  for (const [email, role] of resolved) {
    if (role === 'super_admin') superAdmins.add(email);
    if (role === 'super_admin' || role === 'admin') admins.add(email);
  }
  return { superAdmins: [...superAdmins], admins: [...admins] };
}

/** Test and deployment-reload seam. */
export function forgetAdaptGroupRoles(): void {
  groupRoleCache.clear();
}
