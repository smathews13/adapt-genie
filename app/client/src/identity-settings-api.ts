import type { GroupMembersResponse, Role, RosterPayload } from '../../shared/user-roster-contract';

export type HumanRosterFailure =
  | 'invalid'
  | 'conflict'
  | 'authorization'
  | 'session'
  | 'unavailable'
  | 'network'
  | 'response';

export class HumanRosterError extends Error {
  readonly kind: HumanRosterFailure;
  readonly status: number;

  constructor(message: string, kind: HumanRosterFailure, status = 0) {
    super(message);
    this.name = 'HumanRosterError';
    this.kind = kind;
    this.status = status;
  }
}

function rosterFailure(response: Response, body: { detail?: string; error?: string } | null): HumanRosterError {
  const detail = typeof body?.detail === 'string' ? body.detail.trim() : '';
  if (response.status === 400)
    return new HumanRosterError(detail || 'Enter a valid work email and role.', 'invalid', 400);
  if (response.status === 409) {
    return new HumanRosterError(detail || 'That person already has a conflicting role.', 'conflict', 409);
  }
  if (response.status === 401) {
    return new HumanRosterError('Your session expired. Sign in again, then retry.', 'session', 401);
  }
  if (response.status === 403) {
    return new HumanRosterError('You are not authorized to change human roles.', 'authorization', 403);
  }
  if (response.status === 503) {
    if (body?.error === 'roster_confirmation_unavailable') {
      return new HumanRosterError(
        detail || 'Lakebase could not confirm the saved role. Reload before retrying.',
        'unavailable',
        503
      );
    }
    return new HumanRosterError(detail || 'Lakebase could not save the role. Try again.', 'unavailable', 503);
  }
  return new HumanRosterError(detail || `The human roster answered ${response.status}.`, 'response', response.status);
}

async function rosterResponse(response: Response): Promise<RosterPayload> {
  const body = (await response.json().catch(() => null)) as
    | (RosterPayload & { detail?: string; error?: string })
    | null;
  if (!response.ok) throw rosterFailure(response, body);
  if (!body)
    throw new HumanRosterError('The human roster returned an unreadable response.', 'response', response.status);
  return body;
}

async function rosterRequest(input: RequestInfo | URL, init?: RequestInit): Promise<RosterPayload> {
  try {
    return await rosterResponse(await fetch(input, { credentials: 'same-origin', ...init }));
  } catch (cause) {
    if (cause instanceof HumanRosterError) throw cause;
    throw new HumanRosterError('The network request failed. Check your connection and try again.', 'network');
  }
}

export async function loadHumanRoster(): Promise<RosterPayload> {
  return rosterRequest('/api/users');
}

export interface WorkspaceGroupOption {
  id: string;
  displayName: string;
}

export async function loadWorkspaceGroups(): Promise<WorkspaceGroupOption[]> {
  const response = await fetch('/api/users/groups', { credentials: 'same-origin' });
  const body = (await response.json().catch(() => null)) as {
    groups?: WorkspaceGroupOption[];
    readable?: boolean;
    detail?: string;
  } | null;
  if (!response.ok || !body?.readable) {
    throw new HumanRosterError(
      body?.detail || 'Workspace groups could not be listed.',
      response.status === 403 ? 'authorization' : 'response',
      response.status
    );
  }
  return Array.isArray(body.groups) ? body.groups : [];
}

export async function loadGroupMembers(groupName: string): Promise<GroupMembersResponse> {
  const response = await fetch(`/api/users/groups/${encodeURIComponent(groupName)}/members`, {
    credentials: 'same-origin',
  });
  const body = (await response.json().catch(() => null)) as GroupMembersResponse | null;
  if (!response.ok || !body) {
    throw new HumanRosterError(
      body?.detail || 'The workspace group membership could not be read.',
      response.status === 403 ? 'authorization' : 'response',
      response.status
    );
  }
  return body;
}

export async function changeHumanRole(email: string, role: Role): Promise<RosterPayload> {
  return rosterRequest(`/api/users/${encodeURIComponent(email)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
}

export async function writeHumanRoster(url: string, method: string, body: unknown): Promise<RosterPayload> {
  return rosterRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function writeGroupRoleMapping(
  groupName: string,
  role: Extract<Role, 'admin' | 'consumer'>
): Promise<RosterPayload> {
  return rosterRequest('/api/users/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupName, role }),
  });
}
