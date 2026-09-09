/**
 * Which runtime bound governs which part of the live architecture drawing.
 *
 * THIS IS AN ENFORCEMENT MAP, NOT A VISUAL GROUPING. A node belongs here only
 * when the agent checks that bound before using it, or when it is the
 * infrastructure immediately behind a checked call.
 *
 * Edge keys use the architecture model's `from->to` identity rather than the
 * drawing's `peN` ids.
 */
import type { ChainBound } from './agent-chain';
import type { ArchitectureAccent } from './architecture-layout';

export interface ArchitectureControlScope {
  /** The diagram legend family this control belongs to. */
  accent: ArchitectureAccent;
  nodes: readonly string[];
  edges: readonly string[];
}

const STEP_NODES = ['agent-endpoint', 'llm-endpoint'] as const;
const STEP_EDGES = ['agent-endpoint->llm-endpoint'] as const;

const TOOL_NODES = ['genie-data', 'sql-warehouse'] as const;
const TOOL_EDGES = ['agent-endpoint->genie-data', 'genie-data->sql-warehouse'] as const;

const RUN_NODES = ['agent-endpoint', 'llm-endpoint', 'genie-data', 'sql-warehouse'] as const;
const RUN_EDGES = [...STEP_EDGES, ...TOOL_EDGES] as const;

export const ARCHITECTURE_CONTROL_SCOPES: Readonly<Record<ChainBound, ArchitectureControlScope>> = {
  maxSteps: {
    accent: 'agent',
    nodes: STEP_NODES,
    edges: STEP_EDGES,
  },
  maxToolCalls: {
    accent: 'genie',
    nodes: TOOL_NODES,
    edges: TOOL_EDGES,
  },
  maxRunSeconds: {
    accent: 'question',
    nodes: RUN_NODES,
    edges: RUN_EDGES,
  },
};

export function nextActiveBound(current: ChainBound | null, clicked: ChainBound): ChainBound | null {
  return current === clicked ? null : clicked;
}

export function displayedBound(active: ChainBound | null, preview: ChainBound | null): ChainBound | null {
  return preview ?? active;
}

export function nodeControlBounds(nodeId: string): ChainBound[] {
  return (Object.entries(ARCHITECTURE_CONTROL_SCOPES) as Array<[ChainBound, ArchitectureControlScope]>)
    .filter(([, scope]) => scope.nodes.includes(nodeId))
    .map(([bound]) => bound);
}

export function edgeControlBounds(from: string, to: string): ChainBound[] {
  const key = `${from}->${to}`;
  return (Object.entries(ARCHITECTURE_CONTROL_SCOPES) as Array<[ChainBound, ArchitectureControlScope]>)
    .filter(([, scope]) => scope.edges.includes(key))
    .map(([bound]) => bound);
}
