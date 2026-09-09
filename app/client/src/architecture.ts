/**
 * The shape of this deployment, as a graph whose nodes are real connections.
 *
 * EVERY NODE THAT NAMES A DEPENDENCY NAMES A `ConnectedResource`. Its status,
 * its identifier and its drift come from `connection-model.ts`, which is the
 * derivation the Connections page renders, so the diagram and the list cannot
 * describe different deployments. A node here that had its own idea of whether
 * the warehouse was reachable would eventually be confidently wrong, and a
 * confident diagram is believed in a way a list is not.
 *
 * Two nodes name no resource, and say so rather than borrowing a status that
 * means something else: `browser` and `app` are where the code runs. There is no
 * remote end to probe -- the reader is looking at the browser, and the app
 * answered the request that drew the page.
 *
 * The edges carry sentences rather than arrowheads. The meaning of an edge is
 * the thing a diagram usually leaves to a reader who can see it, so it is
 * written down here once and used both for the visible caption and for the
 * text equivalent a screen reader gets.
 */
import type { ConnectionReading } from './connection-model';
import type { BrandProduct } from './brand-icons';

/**
 * The one sentence left on the page, as the person who owns the words wrote it.
 *
 * Held here rather than in the page because it makes a claim about something
 * outside itself -- when the checks run, which is a fact about what the page
 * fetches -- and architecture-render.test.tsx asserts the string and the claim
 * together, so a change to when the checks run fails beside the sentence it
 * contradicts.
 *
 * Earlier approved copy said checks only ran after Refresh. That stopped being
 * true when the checks began running themselves, so the stale explanation was
 * removed rather than teaching readers to distrust the statuses.
 *
 * The page's own sub-headline and the line under Live data flow were deleted
 * rather than rewritten. Neither was wrong; both explained the tab to a reader
 * who had just clicked it, and the layout claim ("storage sits on the bottom
 * row") is one the diagram makes better than a sentence about the diagram can.
 */
/** Which half of the page a node belongs to. */
export type ArchitectureLane =
  /** What happens between a question and an answer. */
  | 'request'
  /** The governed data the answer is computed from. */
  | 'data'
  /** What the deployment keeps: the record, and the trace. */
  | 'record';

/** What kind of thing the node stands for, which decides what its badge can say. */
export type NodePresence =
  /** A `ConnectedResource`, so its status is that entry's status. */
  | 'connection'
  /** Code running here. Nothing to probe. */
  | 'local'
  /** A real component with no registry entry, so nothing reports on it. */
  | 'unregistered';

export interface ArchitectureNode {
  id: string;
  label: string;
  /** The registry entry this node is, when it is one. */
  resourceId: string | null;
  presence: NodePresence;
  lane: ArchitectureLane;
  /** One sentence: what this does for an answer the reader reads. */
  role: string;
  /**
   * The Databricks product this node IS, when it is one.
   *
   * The handoff puts each product's official mark left of its node title, and
   * this is where the pairing is declared -- beside the node itself rather than
   * in the component that draws it, so a node added here cannot arrive on screen
   * with the wrong logo or with somebody else's.
   *
   * Absent on the two nodes that are not Databricks products: the reader's
   * browser, and the app's own Node server. The app NODE is `apps`, because that
   * node stands for the Databricks App the server runs inside; the browser
   * stands for Chrome.
   *
   * Which mark a product resolves to is `brand-icons.ts`'s, and only its. This
   * field names a product, never a file.
   */
  product?: BrandProduct;
}

export interface ArchitectureEdge {
  from: string;
  to: string;
  /** Query/data movement is directional; hosting is static topology. */
  relationship: 'flow' | 'hosting';
  /** What crosses this edge, as a sentence a screen reader can be given. */
  meaning: string;
}

/**
 * The nodes, in reading order.
 *
 * Verified against the running agent, server routes, model logging, and bundle
 * resources rather than from a prose description of the system.
 */
export const ARCHITECTURE_NODES: readonly ArchitectureNode[] = [
  {
    id: 'browser',
    label: 'Browser',
    resourceId: null,
    presence: 'local',
    lane: 'request',
    role: 'Sends questions to the app.',
  },
  {
    id: 'app',
    label: 'Databricks App',
    resourceId: null,
    presence: 'local',
    lane: 'request',
    role: 'Stores conversations and invokes the Orchestrator.',
    product: 'apps',
  },
  {
    id: 'agent-endpoint',
    label: 'Orchestrator',
    resourceId: 'agent-endpoint',
    presence: 'connection',
    lane: 'request',
    role: 'Plans each answer and asks Genie.',
    product: 'mosaic-ai',
  },
  {
    id: 'llm-endpoint',
    label: 'Foundation model',
    resourceId: 'llm-endpoint',
    presence: 'connection',
    lane: 'request',
    role: 'Reasons over prompts and writes answer prose.',
    product: 'mosaic-ai',
  },
  {
    id: 'genie-data',
    label: 'Data Genie space',
    resourceId: 'genie-data',
    presence: 'connection',
    lane: 'data',
    role: 'Answers metric questions from curated tables.',
    product: 'genie',
  },
  {
    id: 'sql-warehouse',
    label: 'SQL warehouse',
    resourceId: 'sql-warehouse',
    presence: 'connection',
    lane: 'data',
    role: 'Runs read-only SQL under the reader\u2019s grants.',
    product: 'databricks-sql',
  },
  {
    id: 'lakebase',
    label: 'Lakebase (Postgres)',
    resourceId: 'lakebase',
    presence: 'connection',
    lane: 'record',
    role: 'Stores conversations, uploads, and feedback.',
    product: 'lakebase',
  },
  {
    id: 'experiment-id',
    label: 'MLflow experiment',
    resourceId: 'experiment-id',
    presence: 'connection',
    lane: 'record',
    role: 'Stores run traces, tool calls, SQL, and token usage.',
    product: 'mlflow',
  },
];

/**
 * The edges, each with the sentence that is its meaning.
 *
 * The finder’s governed data edges carry the
 * signed-in user's downscoped token where the model version declares
 * `user-authorization`, which is the hop the whole governance story rests on
 * and the one a box-and-arrow diagram normally loses.
 */
export const ARCHITECTURE_EDGES: readonly ArchitectureEdge[] = [
  {
    from: 'browser',
    to: 'app',
    relationship: 'flow',
    meaning: 'The browser sends the question to this app over HTTPS.',
  },
  {
    from: 'app',
    to: 'agent-endpoint',
    relationship: 'flow',
    meaning: 'The app invokes the serving endpoint as its own service principal, forwarding the reader\u2019s token.',
  },
  {
    from: 'agent-endpoint',
    to: 'llm-endpoint',
    relationship: 'flow',
    meaning: 'The orchestrator calls the model to plan and write the final answer.',
  },
  {
    from: 'agent-endpoint',
    to: 'genie-data',
    relationship: 'flow',
    meaning:
      'Metric questions go to the data Genie space, under the reader\u2019s own identity where the version declares it.',
  },
  {
    from: 'genie-data',
    to: 'sql-warehouse',
    relationship: 'flow',
    meaning: 'Genie\u2019s generated SQL is executed by the warehouse.',
  },
  {
    from: 'app',
    to: 'lakebase',
    relationship: 'flow',
    meaning: 'The app writes the conversation, the answer and any feedback to Postgres.',
  },
  {
    from: 'agent-endpoint',
    to: 'experiment-id',
    relationship: 'flow',
    meaning: 'The endpoint traces the run into the MLflow experiment.',
  },
];

/** What a node's badge says, and why. */
export interface NodeReport {
  /** The word on the badge. */
  label: string;
  /** Which visual treatment it takes. Not a colour; the stylesheet decides that. */
  tone: 'connected' | 'disconnected' | 'neutral' | 'local';
  /** The sentence behind the word, for the detail and for the text equivalent. */
  note: string;
}

/**
 * Architecture deliberately compresses the detailed Connections verdicts into
 * one operational question: did authoritative evidence establish a working
 * remote connection? Only a successful canonical check is green, and only a
 * settled failed check is red. Baked/app configuration names what should be
 * checked; it does not by itself prove reachability. A refusal, timeout,
 * unavailable call, missing check, or missing release configuration stays
 * neutral because none establishes that the object itself is disconnected.
 */
function connectionReport(reading: ConnectionReading | undefined, note?: string): NodeReport {
  if (reading?.status === 'reachable' || (reading?.status === 'not-checked' && reading.row.configured.trim())) {
    return {
      label: 'Connected',
      tone: 'connected',
      note:
        note ??
        reading.check?.detail?.trim() ??
        (reading.status === 'reachable'
          ? 'The current dependency probe succeeded.'
          : 'This release names the resource. A live probe has not contradicted it.'),
    };
  }
  if (!reading || reading.status === 'not-checked') {
    return {
      label: 'Not checked',
      tone: 'neutral',
      note: note ?? reading?.check?.detail?.trim() ?? 'No completed check established a connection state.',
    };
  }
  if (reading.status === 'blocked') {
    return {
      label: 'Disconnected',
      tone: 'disconnected',
      note: note ?? reading.check?.detail?.trim() ?? 'A completed dependency probe established a failed connection.',
    };
  }
  return {
    label: reading.status === 'nothing-to-reach' ? 'Not configured' : 'Unavailable',
    tone: 'neutral',
    note:
      note ??
      reading.check?.detail?.trim() ??
      'The current check did not establish whether the remote object is connected.',
  };
}

export const LOCAL_NOTE =
  'This is where the code runs rather than something it connects to, so there is nothing to probe.';

export function nodeReport(
  node: ArchitectureNode,
  reading: ConnectionReading | undefined,
  _relatedReading?: ConnectionReading
): NodeReport {
  if (node.presence === 'local') {
    return { label: 'Runs here', tone: 'local', note: LOCAL_NOTE };
  }
  if (node.presence === 'unregistered') {
    return {
      label: 'Runs in-process',
      tone: 'local',
      note: 'This is a separately invoked agent boundary inside the Orchestrator process, not another endpoint.',
    };
  }
  return connectionReport(reading);
}

export function nodeValue(reading: ConnectionReading | undefined): { value: string; measured: boolean } | null {
  if (!reading) return null;
  if (!reading.summary.value) return null;
  return reading.summary;
}

export function nodesInLane(lane: ArchitectureLane): ArchitectureNode[] {
  return ARCHITECTURE_NODES.filter((node) => node.lane === lane);
}

/**
 * The nodes that ARE a dependency, which is what the tiles count.
 *
 * The browser and the app server are on the drawing because a reader needs to
 * see where the code runs, but neither is something this deployment depends on
 * reaching, and counting them would make the tile disagree with the number of
 * things that can be checked.
 */
export function dependencyNodes(): ArchitectureNode[] {
  return ARCHITECTURE_NODES.filter((node) => node.presence === 'connection');
}

/**
 * The readings for the dependencies the diagram draws, in drawing order.
 *
 * The tiles are counted off THIS rather than off the whole settings payload,
 * because the tile sits above this diagram and a reader will read it as a count
 * of what is below it. The Connections page has twenty entries; ten of them are
 * drawn here.
 */
export function drawnReadings(readings: ReadonlyMap<string, ConnectionReading>): ConnectionReading[] {
  const found: ConnectionReading[] = [];
  for (const node of dependencyNodes()) {
    const reading = node.resourceId ? readings.get(node.resourceId) : undefined;
    if (reading) found.push(reading);
  }
  return found;
}

/**
 * What a screen reader is told a node card is.
 *
 * The status word is IN the name rather than only in the pill beside it, so the
 * card announces the same fact a sighted reader takes from the pill's colour,
 * and the identifier is included because it is the thing that distinguishes two
 * Genie spaces from each other.
 */
export function nodeAccessibleName(
  node: ArchitectureNode,
  reading: ConnectionReading | undefined,
  relatedReading?: ConnectionReading,
  _now: number = Date.now(),
  checking = false
): string {
  if (checking && node.presence === 'connection') return `${node.label}: Checking connection`;
  const report = nodeReport(node, reading, relatedReading);
  const value = nodeValue(reading);
  const parts = [`${node.label}: ${report.label}`];
  if (value) parts.push(value.value);
  if (reading?.marker === 'drift') parts.push('drifted from what it was configured with');
  if (reading?.marker === 'pending') parts.push('a saved value has not been applied');
  return parts.join('. ');
}

export function architectureNode(id: string): ArchitectureNode | undefined {
  return ARCHITECTURE_NODES.find((node) => node.id === id);
}

/** Every edge touching one node, for the detail a node carries. */
export function edgesFor(id: string): ArchitectureEdge[] {
  return ARCHITECTURE_EDGES.filter((edge) => edge.from === id || edge.to === id);
}

/**
 * The whole diagram as sentences.
 *
 * This is not a fallback and it is not decoration: it is the diagram, for
 * anybody not reading it with their eyes and a mouse. Every fact the drawing
 * carries -- what a node is, what its status is, what it is using, and what
 * each edge means -- has to appear here, because the alternative is a page
 * whose content is only available to some of its readers.
 */
export function describeArchitecture(
  readings: ReadonlyMap<string, ConnectionReading>,
  _now: number = Date.now(),
  checking = false
): string[] {
  const lines: string[] = [];
  for (const node of ARCHITECTURE_NODES) {
    const reading = node.resourceId ? readings.get(node.resourceId) : undefined;
    const report = nodeReport(node, reading);
    const value = nodeValue(reading);
    const parts = [
      checking && node.presence === 'connection'
        ? `${node.label}: Checking connection.`
        : `${node.label}: ${report.label}.`,
      node.role,
    ];
    if (value) {
      parts.push(
        value.measured
          ? `In use: ${value.value}, measured from inside the endpoint.`
          : `Configured as ${value.value}. Nothing has measured what it is actually using.`
      );
    }
    if (reading?.marker === 'drift') {
      parts.push(`This one has drifted: what it is using is not what it was configured with.`);
    }
    if (reading?.marker === 'pending') {
      parts.push('A value has been recorded for this one and has not been applied.');
    }
    lines.push(parts.join(' '));
  }
  for (const edge of ARCHITECTURE_EDGES) {
    const from = architectureNode(edge.from)?.label ?? edge.from;
    const to = architectureNode(edge.to)?.label ?? edge.to;
    lines.push(
      edge.relationship === 'hosting' ? `${from} and ${to}: ${edge.meaning}` : `${from} to ${to}: ${edge.meaning}`
    );
  }
  return lines;
}
