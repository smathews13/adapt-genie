import type { AppGroupsSettings } from '../../shared/app-groups';

/**
 * The client half of the app-groups store.
 *
 * WHY THE REVISION TRAVELS BOTH WAYS. Two administrators can have the editor open
 * at once. Every save carries the revision the editor last read, and the server
 * refuses with 409 when the stored revision has moved on, so the second writer is
 * told to reload rather than silently overwriting the first. The response carries
 * the new revision, which the editor keeps for its next save.
 */

export interface AppGroupsDocument {
  settings: AppGroupsSettings;
  revision: number;
}

export class AppGroupsError extends Error {
  readonly kind: 'conflict' | 'authorization' | 'session' | 'unavailable' | 'invalid' | 'network' | 'response';
  readonly status: number;

  constructor(message: string, kind: AppGroupsError['kind'], status = 0) {
    super(message);
    this.name = 'AppGroupsError';
    this.kind = kind;
    this.status = status;
  }
}

function failureFor(response: Response, detail: string): AppGroupsError {
  if (response.status === 400) return new AppGroupsError(detail || 'The app groups were not valid.', 'invalid', 400);
  if (response.status === 401) {
    return new AppGroupsError('Your session expired. Sign in again, then retry.', 'session', 401);
  }
  if (response.status === 403) {
    return new AppGroupsError('You are not authorized to change app groups.', 'authorization', 403);
  }
  if (response.status === 409) {
    return new AppGroupsError(
      detail || 'App groups changed after this page loaded. Reload Settings and try again.',
      'conflict',
      409
    );
  }
  if (response.status === 503) {
    return new AppGroupsError(detail || 'Lakebase could not save the app groups. Try again.', 'unavailable', 503);
  }
  return new AppGroupsError(detail || `App groups answered ${response.status}.`, 'response', response.status);
}

async function readDocument(response: Response): Promise<AppGroupsDocument> {
  const body = (await response.json().catch(() => null)) as
    | (AppGroupsDocument & { detail?: string; error?: string })
    | null;
  if (!response.ok) throw failureFor(response, typeof body?.detail === 'string' ? body.detail.trim() : '');
  if (!body || typeof body.revision !== 'number' || !body.settings) {
    throw new AppGroupsError('App groups returned an unreadable response.', 'response', response.status);
  }
  return { settings: body.settings, revision: body.revision };
}

async function request(input: RequestInfo | URL, init?: RequestInit): Promise<AppGroupsDocument> {
  try {
    return await readDocument(await fetch(input, { credentials: 'same-origin', ...init }));
  } catch (cause) {
    if (cause instanceof AppGroupsError) throw cause;
    throw new AppGroupsError('The network request failed. Check your connection and try again.', 'network');
  }
}

export async function loadAppGroups(): Promise<AppGroupsDocument> {
  return request('/api/admin/app-groups');
}

export async function saveAppGroups(patch: Partial<AppGroupsSettings>, revision: number): Promise<AppGroupsDocument> {
  return request('/api/admin/app-groups', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision, patch }),
  });
}
