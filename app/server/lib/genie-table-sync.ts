import { createHash } from 'node:crypto';

import type { LakebaseReader } from './lakebase-store';
import { readDeclaredConnections, writeDeclaredConnection } from './declared-connections';
import { workspaceControlPlaneReader, type ControlPlaneReader } from './control-plane-identity';

export interface GenieTableSource {
  identifier: string;
  kind: 'table' | 'metric-view';
}

export interface GenieTableSyncResult {
  status: 'synced' | 'up-to-date' | 'not-configured' | 'unavailable';
  spaceId: string;
  discovered: number;
  added: number;
  detail: string;
  syncedAt: string;
}

export function userGenieControlPlaneReader(input: {
  host: string;
  token: string;
  fetchImpl?: typeof fetch;
}): ControlPlaneReader {
  const host = input.host.replace(/\/+$/, '');
  const token = input.token.trim();
  return async (path, query = {}) => {
    if (!host || !token) throw new Error('Your Databricks sign-in is unavailable. Sign in again before syncing Genie.');
    const url = new URL(`${host}${path}`);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    const response = await (input.fetchImpl ?? fetch)(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    const text = await response.text();
    let body: unknown = {};
    try {
      body = text ? (JSON.parse(text) as unknown) : {};
    } catch {
      body = {};
    }
    if (!response.ok) {
      const message = typeof record(body).message === 'string' ? String(record(body).message).trim() : '';
      throw new Error(message || `The Genie space answered HTTP ${response.status}.`);
    }
    return body;
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function identifier(value: unknown): string {
  const name = typeof record(value).identifier === 'string' ? String(record(value).identifier).trim() : '';
  return name.split('.').length === 3 ? name : '';
}

/** Read the complete table inventory exported by a Genie space. */
export function genieTableSources(body: unknown): GenieTableSource[] {
  const raw = record(body).serialized_space;
  let serialized: Record<string, unknown>;
  try {
    serialized = record(typeof raw === 'string' ? JSON.parse(raw) : raw);
  } catch {
    return [];
  }
  const sources = record(serialized.data_sources);
  const found = new Map<string, GenieTableSource>();
  for (const [values, kind] of [
    [sources.tables, 'table'],
    [sources.metric_views, 'metric-view'],
  ] as const) {
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      const name = identifier(value);
      if (name) found.set(name.toLocaleLowerCase(), { identifier: name, kind });
    }
  }
  return [...found.values()].sort((left, right) => left.identifier.localeCompare(right.identifier));
}

function connectionId(name: string): string {
  return `genie-${createHash('sha256').update(name.toLocaleLowerCase()).digest('hex').slice(0, 20)}`;
}

/**
 * Add every source curated by the connected Genie space to ADAPT's durable
 * scope list. This is additive: removing a source from Genie never silently
 * deletes a row somebody may still rely on.
 */
export async function syncGenieTables(input: {
  store: LakebaseReader;
  spaceId: string;
  actor: string;
  existingScope?: readonly string[];
  reader?: ControlPlaneReader;
  now?: Date;
}): Promise<GenieTableSyncResult> {
  const spaceId = input.spaceId.trim();
  const syncedAt = (input.now ?? new Date()).toISOString();
  if (!spaceId) {
    return { status: 'not-configured', spaceId: '', discovered: 0, added: 0, detail: '', syncedAt };
  }
  try {
    const read = input.reader ?? workspaceControlPlaneReader;
    const body = await read(`/api/2.0/genie/spaces/${encodeURIComponent(spaceId)}`, {
      include_serialized_space: 'true',
    });
    const tables = genieTableSources(body);
    const serializedPresent = Boolean(record(body).serialized_space);
    if (!serializedPresent) {
      return {
        status: 'unavailable',
        spaceId,
        discovered: 0,
        added: 0,
        detail: 'The Genie space did not return its source inventory. The app needs CAN EDIT on the space to sync it.',
        syncedAt,
      };
    }
    const existing = await readDeclaredConnections(input.store);
    const alreadyInScope = new Set((input.existingScope ?? []).map((name) => name.trim().toLocaleLowerCase()));
    const byName = new Map(
      existing
        .filter((entry) => entry.resourceType === 'table')
        .map((entry) => [entry.value.trim().toLocaleLowerCase(), entry])
    );
    let added = 0;
    for (const table of tables) {
      if (alreadyInScope.has(table.identifier.toLocaleLowerCase())) continue;
      const prior = byName.get(table.identifier.toLocaleLowerCase());
      if (prior?.state === 'declared') continue;
      await writeDeclaredConnection(input.store, {
        id: prior?.id || connectionId(table.identifier),
        label: table.identifier.split('.').slice(-1)[0] || table.identifier,
        kind: 'unity-catalog',
        resourceType: 'table',
        value: table.identifier,
        note: table.kind === 'metric-view' ? 'genie-source:metric-view' : 'genie-source:table',
        origin: 'genie',
        changedBy: input.actor,
      });
      added += 1;
    }
    return {
      status: added > 0 ? 'synced' : 'up-to-date',
      spaceId,
      discovered: tables.length,
      added,
      detail:
        added > 0
          ? `${added} new Genie ${added === 1 ? 'source was' : 'sources were'} added to scope.`
          : `All ${tables.length} Genie ${tables.length === 1 ? 'source is' : 'sources are'} already in scope.`,
      syncedAt,
    };
  } catch (error) {
    console.warn('[connections] Genie source inventory could not be synchronized:', (error as Error).message);
    const message = (error as Error).message;
    return {
      status: 'unavailable',
      spaceId,
      discovered: 0,
      added: 0,
      detail: /permission|can edit|forbidden/i.test(message)
        ? 'Your Databricks sign-in needs CAN EDIT on the connected Genie space before its tables can be synced.'
        : message || 'The connected Genie space could not be read, so the existing app scope was left unchanged.',
      syncedAt,
    };
  }
}
