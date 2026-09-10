import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { ArchitectureCanvas, ArchitecturePage, ChainBoundTiles } from './ArchitecturePage';
import { AGENT_CHAIN, CHAIN_BOUND_LABEL, CHAIN_BOUNDS } from './agent-chain';
import { ARCHITECTURE_EDGES, ARCHITECTURE_NODES, dependencyNodes } from './architecture';
import { ARCHITECTURE_CONTROL_SCOPES } from './architecture-control-scopes';
import { BOTTOM_ROW_NODES, NODE_BOXES, drawnEdges, pathEnds } from './architecture-layout';
import { readConnections, readingsById, type SettingsPayload } from './connection-model';
import { connectedResource } from '../../shared/deployment-config';
import type { PreflightCheck } from './preflight';

const PAGE_SOURCE = readFileSync(fileURLToPath(new URL('./ArchitecturePage.tsx', import.meta.url)), 'utf8');
const RUNTIME_PANEL = readFileSync(fileURLToPath(new URL('./RuntimeSettingsPanel.tsx', import.meta.url)), 'utf8');

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

function check(id: string, status: PreflightCheck['status'], name = ''): PreflightCheck {
  return { id, label: id, status, name, detail: '', error: '', kind: 'dependency' } as unknown as PreflightCheck;
}

function deployment() {
  const payload: SettingsPayload = {
    resources: [
      row('agent-endpoint', { configured: 'an-endpoint', actual: 'an-endpoint', actualObserved: true }),
      row('llm-endpoint', { configured: 'databricks-claude-sonnet-4-6' }),
      row('genie-data', { configured: 'a-space' }),
      row('sql-warehouse', {
        configured: 'configured-warehouse',
        actual: 'measured-warehouse',
        actualObserved: true,
      }),
      row('lakebase', { configured: 'a-branch' }),
      row('experiment-id', { configured: 'an-experiment' }),
    ],
    drift: [
      {
        id: 'mismatch-sql-warehouse',
        severity: 'blocking',
        resourceId: 'sql-warehouse',
        headline: '',
        detail: '',
        remedy: '',
      },
    ],
    status: 'blocked',
    appBuildSha: '',
    modelBuildSha: '',
    orchestratorReported: true,
    storeAvailable: true,
    checkedAt: '',
  };
  const checks = [
    check('agent-endpoint', 'ok', 'an-endpoint'),
    check('sql-warehouse', 'ok', 'measured-warehouse'),
    check('genie-data', 'failed'),
    check('lakebase', 'ok', 'a-branch'),
  ];
  return readingsById(readConnections(payload, checks));
}

function pageMarkup(): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ArchitecturePage />
    </MemoryRouter>
  );
}

function canvasMarkup(): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ArchitectureCanvas byResource={deployment()} now={Date.now()} payload={null} />
    </MemoryRouter>
  );
}

function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function card(markup: string, id: string): string {
  const at = markup.indexOf(`data-testid="arch-node-${id}"`);
  expect(at, id).toBeGreaterThan(-1);
  const next = markup.indexOf('data-testid="arch-node-', at + 1);
  const end = next < 0 ? markup.indexOf('data-testid="architecture-equivalent"') : markup.lastIndexOf('<div', next);
  return markup.slice(markup.lastIndexOf('<div', at), end);
}

describe('Architecture renders the simplified Genie-only graph', () => {
  it('draws exactly the approved nodes and edges', () => {
    const markup = canvasMarkup();
    for (const node of ARCHITECTURE_NODES) expect(markup, node.id).toContain(`data-testid="arch-node-${node.id}"`);
    for (const edge of drawnEdges()) expect(markup, edge.id).toContain(`data-testid="arch-dot-${edge.id}"`);
    expect(drawnEdges()).toHaveLength(ARCHITECTURE_EDGES.length);
  });

  it('uses the current concise node descriptions', () => {
    expect(Object.fromEntries(ARCHITECTURE_NODES.map((node) => [node.id, node.role]))).toEqual({
      browser: 'Sends questions to the app.',
      app: 'Stores conversations and invokes the Orchestrator.',
      'agent-endpoint': 'Plans each answer and asks Genie.',
      'llm-endpoint': 'Reasons over prompts and writes answer prose.',
      'genie-data': 'Answers metric questions from curated tables.',
      'sql-warehouse': 'Runs read-only SQL under the reader’s grants.',
      lakebase: 'Stores conversations, uploads, and feedback.',
      'experiment-id': 'Stores run traces, tool calls, SQL, and token usage.',
    });
  });

  it('renders the five current legend families without semantic search', () => {
    const markup = canvasMarkup();
    for (const label of ['question path', 'the agent', 'Genie space', 'governed data', 'storage']) {
      expect(text(markup)).toContain(label);
    }
    expect(text(markup)).not.toContain('semantic search');
  });
});

describe('Architecture reports the shared live readings', () => {
  it('shows connected, disconnected, measured, and drifted states on the right cards', () => {
    const markup = canvasMarkup();
    expect(text(card(markup, 'agent-endpoint'))).toContain('Connected');
    expect(text(card(markup, 'genie-data'))).toContain('Disconnected');
    expect(text(card(markup, 'sql-warehouse'))).toContain('measured-warehouse');
    expect(text(card(markup, 'sql-warehouse'))).not.toContain('configured-warehouse');
    expect(card(markup, 'sql-warehouse')).toContain('data-drift="drift"');
  });

  it('does not color unchecked release configuration as disconnected', () => {
    const markup = canvasMarkup();
    for (const id of ['llm-endpoint', 'experiment-id']) {
      expect(text(card(markup, id)), id).toContain('Connected');
      expect(card(markup, id), id).toContain('data-tone="connected"');
      expect(text(card(markup, id)), id).not.toContain('Disconnected');
    }
  });

  it('keeps browser and app local and links each dependency to Connections', () => {
    const markup = canvasMarkup();
    // The two local nodes carry no status pill: "Runs here" was redundant beside
    // a card that already says what each one does. They still say what they are.
    for (const id of ['browser', 'app']) {
      const local = card(markup, id);
      expect(text(local), id).not.toContain('Runs here');
      expect(local, id).not.toContain('arch-node-status');
      expect(text(local), id).toContain(ARCHITECTURE_NODES.find((node) => node.id === id)!.role);
    }
    for (const node of dependencyNodes()) {
      expect(card(markup, node.id)).toContain(`href="/connections?entity=${node.resourceId!}"`);
    }
  });

  it('states every node and edge in the text equivalent', () => {
    const markup = canvasMarkup();
    const equivalent = text(markup.slice(markup.indexOf('data-testid="architecture-equivalent"')));
    for (const node of ARCHITECTURE_NODES) expect(equivalent, node.id).toContain(node.label);
    for (const edge of ARCHITECTURE_EDGES) expect(equivalent, edge.meaning).toContain(edge.meaning);
  });
});

describe('the simplified chain and rails stay in sync', () => {
  it('draws the three current stages in order', () => {
    const markup = pageMarkup();
    const rail = markup.slice(markup.indexOf('arch-rail-answer'), markup.indexOf('arch-rail-storage'));
    expect(AGENT_CHAIN.map((stage) => stage.stage)).toEqual(['orchestrator', 'data_genie', 'synthesis']);
    for (const stage of AGENT_CHAIN) {
      expect(rail).toContain(stage.title);
      expect(rail).toContain(`data-stage="${stage.stage}"`);
    }
    expect(rail.indexOf(AGENT_CHAIN[0].title)).toBeLessThan(rail.indexOf(AGENT_CHAIN[1].title));
    expect(rail.indexOf(AGENT_CHAIN[1].title)).toBeLessThan(rail.indexOf(AGENT_CHAIN[2].title));
  });

  it('does not render the removed answer-contract rail', () => {
    const markup = pageMarkup();
    expect(markup).not.toContain('id="arch-rail-contract"');
    expect(markup).not.toContain('data-rail="contract"');
    expect(markup).not.toContain('answer-contract-settings');
  });

  it('keeps runtime loop settings out of the architecture page', () => {
    const markup = pageMarkup();
    for (const bound of CHAIN_BOUNDS) {
      expect(text(markup)).not.toContain(CHAIN_BOUND_LABEL[bound]);
    }
    expect(PAGE_SOURCE).not.toContain('useLiveRuntimeSettings');
    expect(RUNTIME_PANEL).not.toContain(CHAIN_BOUND_LABEL.maxSteps);
  });

  it('renders each loop bound as a keyboard-reachable scope toggle', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ChainBoundTiles loop={{ maxSteps: 12, maxToolCalls: 9, maxRunSeconds: 90 }} />
      </MemoryRouter>
    );
    expect(markup.match(/class="arch-bound-tile"/g)).toHaveLength(CHAIN_BOUNDS.length);
    expect(markup.match(/type="button"/g)).toHaveLength(CHAIN_BOUNDS.length);
  });
});

describe('the simplified geometry reaches the intended cards', () => {
  it('keeps each edge on card borders and storage below its writer', () => {
    for (const edge of drawnEdges()) {
      const ends = pathEnds(edge.d);
      const from = NODE_BOXES[edge.from];
      const to = NODE_BOXES[edge.to];
      const onBorder = (box: typeof from, point: { x: number; y: number }) =>
        ((point.x === box.left || point.x === box.left + box.width) &&
          point.y >= box.top &&
          point.y <= box.top + box.height) ||
        ((point.y === box.top || point.y === box.top + box.height) &&
          point.x >= box.left &&
          point.x <= box.left + box.width);
      expect(onBorder(from, ends.start), edge.id).toBe(true);
      expect(onBorder(to, ends.end), edge.id).toBe(true);
    }
    for (const id of BOTTOM_ROW_NODES) expect(NODE_BOXES[id].top).toBeGreaterThan(NODE_BOXES['agent-endpoint'].top);
  });

  it('draws the experiment trace as a straight vertical line', () => {
    const edge = drawnEdges().find(
      (candidate) => candidate.from === 'agent-endpoint' && candidate.to === 'experiment-id'
    )!;
    const ends = pathEnds(edge.d);
    expect(edge.d).toContain(' V ');
    expect(ends.start.x).toBe(ends.end.x);
  });

  it('marks exactly the selected runtime scope', () => {
    const active = 'maxToolCalls';
    const scope = ARCHITECTURE_CONTROL_SCOPES[active];
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ArchitectureCanvas activeBound={active} byResource={deployment()} now={Date.now()} payload={null} />
      </MemoryRouter>
    );
    for (const node of ARCHITECTURE_NODES) {
      expect(card(markup, node.id).includes('data-control-active="true"'), node.id).toBe(scope.nodes.includes(node.id));
    }
  });
});
