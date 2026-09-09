/**
 * The insight rail's real scope, derived from `/api/settings` — the workspace
 * probe that Connections reads. It runs under the signed-in reader's own grants
 * and returns a `checks` array describing every governed dependency: the Unity
 * Catalog tables in scope (with the reachability the probe found), the catalog
 * and schema, the Genie spaces, the SQL warehouse and the serving endpoint.
 *
 * WHY NOT `/api/preflight`. That route was the first source tried, and on this
 * deployment it carries only a serving-endpoint and a Postgres check: the agent
 * model version no longer returns a table dependency report, so its report is
 * built app-side with no tables. `/api/settings` probes the workspace directly
 * and always carries the tables, which is why Connections reads it and this now
 * does too — so the rail and the Connections matrix cannot disagree.
 *
 * Nothing here invents a figure. Probed tables lead; when no table probe exists,
 * the rail falls back to table assets explicitly added in Unity Catalog scope
 * and marks them unverified until Refresh runs.
 */
import { useEffect, useState } from 'react';

import type { PreflightStatus } from './preflight';

/** One table the deployment tracks, as the rail draws it. */
export interface InsightTable {
  /** Fully-qualified name, kept for the title attribute. */
  name: string;
  /** The `schema.table` tail, which is what a ~300px rail has room for. */
  display: string;
  /** Reachable, blocked, or not checked -- decides the dot's tone. */
  status: PreflightStatus;
}

/** One line of the confidence block: a tone for its icon, and a sentence. */
export interface ConfidenceLine {
  tone: 'ok' | 'warn' | 'neg';
  text: string;
}

/** The `schema.table` tail of a fully-qualified name, or the whole of a shorter one. */
export function shortTableName(name: string): string {
  const parts = name.split('.').filter((part) => part.length > 0);
  return parts.length >= 2 ? parts.slice(-2).join('.') : name;
}

/** The checks array off a settings (or preflight) payload, read defensively. */
function checksOf(payload: unknown): Array<Record<string, unknown>> {
  const checks = (payload as { checks?: unknown } | null)?.checks;
  if (!Array.isArray(checks)) return [];
  return checks.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object');
}

/** The status a check reported, narrowed to the three the UI knows. */
function statusOf(check: Record<string, unknown>): PreflightStatus {
  return check.status === 'ok' || check.status === 'failed' ? check.status : 'unverified';
}

/**
 * The tracked tables, each with the reachability its own check reported.
 *
 * Reads the payload defensively: a shape this cannot read yields no rows rather
 * than a throw, so a drifted body degrades to an empty section.
 */
export function insightTables(payload: unknown): InsightTable[] {
  const tables: InsightTable[] = [];
  for (const check of checksOf(payload)) {
    if (check.kind !== 'table' || typeof check.name !== 'string') continue;
    const name = check.name.trim();
    if (!name) continue;
    tables.push({ name, display: shortTableName(name), status: statusOf(check) });
  }
  if (tables.length > 0) return tables;

  const connections = (payload as { connections?: unknown } | null)?.connections;
  if (!Array.isArray(connections)) return tables;
  const seen = new Set<string>();
  for (const entry of connections) {
    if (!entry || typeof entry !== 'object') continue;
    const connection = (entry as { connection?: unknown }).connection;
    if (!connection || typeof connection !== 'object') continue;
    const candidate = connection as Record<string, unknown>;
    if (candidate.state !== 'declared' || candidate.resourceType !== 'table' || typeof candidate.value !== 'string') {
      continue;
    }
    const name = candidate.value.trim();
    const key = name.toLocaleLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    tables.push({ name, display: shortTableName(name), status: 'unverified' });
  }
  return tables;
}

/** The dot tone for a table's reachability. */
export function tableStatusTone(status: PreflightStatus): 'pos' | 'neg' | 'grey' {
  return status === 'ok' ? 'pos' : status === 'failed' ? 'neg' : 'grey';
}

/**
 * The confidence lines, read off the probe's own checks.
 *
 * Each line is drawn only when the checks it summarises exist, and its tone
 * follows what they found: green when everything it covers is reachable, amber
 * when some of it is not, red when the endpoint that answers questions is down.
 * A deployment whose probe returned nothing produces no lines, and the rail says
 * it is still checking rather than making a claim.
 */
export function insightConfidence(payload: unknown): ConfidenceLine[] {
  const checks = checksOf(payload);
  if (checks.length === 0) return [];
  const lines: ConfidenceLine[] = [];

  const byKind = (kind: string) => checks.filter((check) => check.kind === kind);
  const reachable = (list: Array<Record<string, unknown>>) => list.filter((check) => statusOf(check) === 'ok').length;

  // The serving endpoint the agent runs on: the one whose failure means no
  // answers at all, so it leads and turns the whole block red when it is down.
  const endpoints = byKind('serving-endpoint');
  if (endpoints.length > 0) {
    const up = reachable(endpoints);
    if (up === endpoints.length) {
      lines.push({ tone: 'ok', text: 'Agent serving endpoint reachable under your sign-in' });
    } else {
      lines.push({ tone: 'neg', text: 'Agent serving endpoint unreachable — answers are unavailable' });
    }
  }

  // The tables in scope, which is what a data analyst actually acts on.
  const tables = byKind('table');
  if (tables.length > 0) {
    const up = reachable(tables);
    lines.push(
      up === tables.length
        ? { tone: 'ok', text: `All ${tables.length} tables in scope reachable under your grants` }
        : { tone: 'warn', text: `${up} of ${tables.length} tables in scope reachable under your grants` }
    );
  }

  // The Genie space the questions are answered against.
  const spaces = byKind('genie-space');
  if (spaces.length > 0) {
    const up = reachable(spaces);
    lines.push(
      up === spaces.length
        ? { tone: 'ok', text: `${spaces.length === 1 ? 'Genie space' : `${spaces.length} Genie spaces`} reachable` }
        : { tone: 'warn', text: `${up} of ${spaces.length} Genie spaces reachable` }
    );
  }

  // Governance, stated only when both halves of the boundary answered.
  const catalog = byKind('catalog');
  const schema = byKind('schema');
  if (
    catalog.length > 0 &&
    schema.length > 0 &&
    reachable(catalog) === catalog.length &&
    reachable(schema) === schema.length
  ) {
    lines.push({ tone: 'ok', text: 'Governed by Unity Catalog on every read' });
  }

  return lines;
}

/**
 * The settings payload, read once for the insight rail.
 *
 * A module-level single-flight, so navigating away from Ask and back does not
 * re-probe the workspace. Null while the one request is in flight and for good
 * if it could not be read.
 */
let settingsRequest: Promise<unknown> | null = null;

function readSettingsOnce(): Promise<unknown> {
  settingsRequest ??= fetch('/api/settings')
    .then((response) => (response.ok ? (response.json() as Promise<unknown>) : null))
    .catch(() => null);
  return settingsRequest;
}

export function useInsightScope(): { report: unknown; loading: boolean } {
  const [report, setReport] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    void readSettingsOnce().then((payload) => {
      if (!live) return;
      setReport(payload);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);
  return { report, loading };
}
