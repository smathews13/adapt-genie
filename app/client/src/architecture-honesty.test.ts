import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ARCHITECTURE_EDGES, ARCHITECTURE_NODES, describeArchitecture, nodeReport, nodeValue } from './architecture';
import { readConnections, readingsById, type SettingsPayload } from './connection-model';
import { entityHref } from './data-entities';
import { CONNECTED_RESOURCES, connectedResource } from '../../shared/deployment-config';
import type { PreflightCheck } from './preflight';

const PAGE = readFileSync(fileURLToPath(new URL('./ArchitecturePage.tsx', import.meta.url)), 'utf8');
const MODEL = readFileSync(fileURLToPath(new URL('./architecture.ts', import.meta.url)), 'utf8');
const LAYOUT = readFileSync(fileURLToPath(new URL('./architecture-layout.ts', import.meta.url)), 'utf8');
const CSS = readFileSync(fileURLToPath(new URL('./styles/architecture.css', import.meta.url)), 'utf8');

function row(id: string, over: Record<string, unknown> = {}) {
  return {
    resource: connectedResource(id)!,
    configured: '',
    configuredFrom: 'artifact',
    actual: '',
    actualObserved: false,
    intended: null,
    intendedAt: '',
    intendedBy: '',
    editable: false,
    changedByLabel: '',
    changedByNote: '',
    ...over,
  } as SettingsPayload['resources'][number];
}

function payload(rows: SettingsPayload['resources']): SettingsPayload {
  return {
    resources: rows,
    drift: [],
    status: 'unknown',
    appBuildSha: '',
    modelBuildSha: '',
    orchestratorReported: false,
    storeAvailable: false,
    checkedAt: '',
  };
}

describe('the simplified diagram states only the Genie deployment', () => {
  it('contains exactly the approved nodes and edges', () => {
    expect(ARCHITECTURE_NODES.map((node) => node.id)).toEqual([
      'browser',
      'app',
      'agent-endpoint',
      'llm-endpoint',
      'genie-data',
      'sql-warehouse',
      'lakebase',
      'experiment-id',
    ]);
    expect(ARCHITECTURE_EDGES.map((edge) => `${edge.from}->${edge.to}`)).toEqual([
      'browser->app',
      'app->agent-endpoint',
      'agent-endpoint->llm-endpoint',
      'agent-endpoint->genie-data',
      'genie-data->sql-warehouse',
      'app->lakebase',
      'agent-endpoint->experiment-id',
    ]);
  });

  it('keeps Unity Catalog governance off this diagram only', () => {
    expect(ARCHITECTURE_NODES.some((node) => node.id === 'catalog')).toBe(false);
    expect(ARCHITECTURE_EDGES.some((edge) => edge.from === 'catalog' || edge.to === 'catalog')).toBe(false);
    expect(connectedResource('catalog')).toBeDefined();
  });

  it('connects only nodes it draws', () => {
    const drawn = new Set(ARCHITECTURE_NODES.map((node) => node.id));
    for (const edge of ARCHITECTURE_EDGES) {
      expect(drawn.has(edge.from), edge.from).toBe(true);
      expect(drawn.has(edge.to), edge.to).toBe(true);
    }
  });
});

describe('the page reports live connection readings honestly', () => {
  it('shows no identifier before the deployment names one', () => {
    const readings = readingsById(readConnections(payload([row('sql-warehouse')]), []));
    expect(nodeValue(readings.get('sql-warehouse'))).toBeNull();
  });

  it('distinguishes configured values from measured values', () => {
    const configured = readingsById(
      readConnections(payload([row('sql-warehouse', { configured: 'configured-id' })]), [])
    );
    expect(nodeValue(configured.get('sql-warehouse'))).toEqual({ value: 'configured-id', measured: false });

    const measured = readingsById(
      readConnections(
        payload([
          row('sql-warehouse', {
            configured: 'configured-id',
            actual: 'measured-id',
            actualObserved: true,
          }),
        ]),
        []
      )
    );
    expect(nodeValue(measured.get('sql-warehouse'))).toEqual({ value: 'measured-id', measured: true });
  });

  it('keeps local nodes out of remote connection grading', () => {
    for (const id of ['browser', 'app']) {
      const node = ARCHITECTURE_NODES.find((candidate) => candidate.id === id)!;
      expect(nodeReport(node, undefined)).toMatchObject({ label: 'Runs here', tone: 'local' });
    }
  });

  it.each(['llm-endpoint', 'genie-data', 'experiment-id'])(
    'shows %s as connected when the release names it, even before a check',
    (id) => {
      const node = ARCHITECTURE_NODES.find((candidate) => candidate.id === id)!;
      const configured = row(id, { configured: id === 'experiment-id' ? '12345' : `${id}-value` });
      const unchecked = readingsById(readConnections(payload([configured]), [])).get(id);
      expect(nodeReport(node, unchecked)).toMatchObject({ label: 'Connected', tone: 'connected' });

      const passed = {
        id,
        label: node.label,
        status: 'ok',
        name: configured.configured,
        detail: '',
        error: '',
        kind: 'dependency',
      } as PreflightCheck;
      const checked = readingsById(readConnections(payload([configured]), [passed])).get(id);
      expect(nodeReport(node, checked)).toMatchObject({ label: 'Connected', tone: 'connected' });
    }
  );

  it('reserves Disconnected for a settled failed check', () => {
    const id = 'genie-data';
    const node = ARCHITECTURE_NODES.find((candidate) => candidate.id === id)!;
    const failed = {
      id,
      label: node.label,
      status: 'failed',
      name: 'space',
      detail: 'The configured space does not exist.',
      error: 'not found',
      kind: 'dependency',
    } as PreflightCheck;
    const reading = readingsById(readConnections(payload([row(id, { configured: 'space' })]), [failed])).get(id);
    expect(nodeReport(node, reading)).toMatchObject({ label: 'Disconnected', tone: 'disconnected' });
  });
});

describe('Architecture stays coupled to shared deployment data', () => {
  it('maps every resource-backed node to the connection registry', () => {
    const resources = new Set(CONNECTED_RESOURCES.map((resource) => resource.id));
    for (const node of ARCHITECTURE_NODES) {
      if (node.resourceId) expect(resources.has(node.resourceId), node.id).toBe(true);
    }
  });

  it('links every dependency to its Connections row', () => {
    for (const node of ARCHITECTURE_NODES) {
      if (!node.resourceId) continue;
      expect(entityHref(node.resourceId)).toBe(`/connections?entity=${node.resourceId}`);
    }
    expect(PAGE).toContain('entityHref(node.resourceId)');
  });

  it('states every node and edge in the text equivalent', () => {
    const lines = describeArchitecture(new Map());
    for (const node of ARCHITECTURE_NODES) {
      expect(
        lines.some((line) => line.startsWith(`${node.label}:`)),
        node.id
      ).toBe(true);
    }
    for (const edge of ARCHITECTURE_EDGES) {
      expect(
        lines.some((line) => line.includes(edge.meaning)),
        `${edge.from}->${edge.to}`
      ).toBe(true);
    }
  });
});

describe('the diagram invents no deployment-specific figures or identifiers', () => {
  it('contains no fixed latency, count, or workspace identifier', () => {
    for (const file of [PAGE, MODEL, LAYOUT, CSS]) {
      expect(file).not.toMatch(
        /https?:\/\/[a-z0-9-]*\.(cloud\.databricks\.com|azuredatabricks\.net|gcp\.databricks\.com)/i
      );
      expect(file).not.toMatch(/\bdbc-[0-9a-f-]+/i);
      expect(file).not.toMatch(/\b[0-9a-f]{16}\b/i);
    }
    for (const node of ARCHITECTURE_NODES) {
      expect(node.role, node.id).not.toMatch(/\b\d+\s*(ms|seconds?|minutes?|rows?|queries)\b/i);
    }
  });

  it('keeps animation accessible', () => {
    expect(PAGE).toMatch(/aria-hidden/);
    expect(PAGE).toMatch(/describeArchitecture/);
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});
