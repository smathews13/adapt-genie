/**
 * The stages a question passes through, and the sections the answer comes back
 * in.
 *
 * WHY THIS FILE EXISTS. The Architecture page's "Answer path" rail was four
 * hand-written rows in the page component, and it described the run the agent
 * performed before the chain was reworked: browser, orchestrator, warehouse,
 * browser. It said nothing about synthesis and charts being separate stages.
 *
 * So the stages are data rather than markup, named as the agent's own spans name
 * them. `stage` on each row is the literal MLflow stage id the current trace carries,
 * such as `orchestrator`, `data_genie`, and `synthesis`, so a reader can hold this page and
 * a trace side by side and match them line for line. If a stage is renamed in
 * agent.py, the mismatch is visible here rather than being a caption that quietly
 * became wrong.
 *
 * THIS IS A DESCRIPTION AND NOT A CONTROL. Nothing here decides anything.
 */
import type { ArchitectureAccent } from './architecture-layout';

/**
 * One stage of a run.
 *
 * `optional` is the interesting field. Three of these do not run on every
 * question -- the plan only for a question worth approving, the attachment stage
 * only when a file was uploaded, the charts only when charts are on and there is
 * budget left -- and a rail that draws six rows for a run that had three is a
 * rail that will be read as a fault. It is stated per row rather than left to the
 * prose.
 */
export interface ChainStage {
  /** The MLflow stage id, as the trace carries it. */
  stage: string;
  title: string;
  body: string;
  accent: ArchitectureAccent;
  /** The word on the row's badge, where the row earns one. */
  badge?: string;
  /** What passes to the next stage, drawn on the arrow between the rows. */
  passes?: string;
  optional?: boolean;
}

/**
 * The chain, in order.
 *
 * Taken from `_turn` in agent/agent.py, which opens these spans in this sequence.
 * The plan gate is first because it can end the turn on its own: a question the
 * agent judges nontrivial comes back as a plan to approve and reads nothing at
 * all until somebody presses approve. That is the stage the old rail was most
 * wrong about -- it had the run going straight from the app to the orchestrator,
 * so the plan card a reader sees on their first real question appeared to come
 * from nowhere in the diagram.
 */
export const AGENT_CHAIN: readonly ChainStage[] = [
  {
    stage: 'orchestrator',
    title: 'Orchestrator owns the run',
    body: 'One parent stage coordinates governed data reads and writes the final answer.',
    accent: 'agent',
    passes: 'question',
  },
  {
    stage: 'data_genie',
    title: 'Governed data answers the question',
    body: 'Direct SQL reads curated tables first; Genie handles requests that need semantic interpretation.',
    accent: 'genie',
    passes: 'query results',
  },
  {
    stage: 'synthesis',
    title: 'The model writes the answer',
    body: 'The foundation model turns Genie’s results into the prose the reader sees.',
    accent: 'agent',
    passes: 'answer',
  },
];

/**
 * One section of the answer contract.
 *
 * `field` is the wire name from `AnswerContract` in agent/contracts.py, which is
 * the point of listing them: the app renders these, the agent fills them, and the
 * two have disagreed before. `derivation` is the one worth knowing about -- it is
 * called provenance everywhere a person discusses it and `derivation` on the
 * wire, and somebody reading a raw trace for the first time will look for the
 * wrong key.
 */
export interface AnswerSection {
  field: string;
  label: string;
  body: string;
  /** Whether the Settings pane can switch this section off. */
  optional?: boolean;
}

/**
 * The answer contract, in the order the card draws it.
 *
 * NOT EVERY FIELD. `id`, `trace` and `sql` are on the contract and are not in
 * this list, because they are not sections of an answer a reader reads -- they
 * are what the Run Explorer opens. This is the shape of the answer, which is what
 * the Architecture page is being asked to state.
 */
export const ANSWER_CONTRACT: readonly AnswerSection[] = [
  {
    field: 'takeaway',
    label: 'Takeaway',
    body: 'One finding, first, in a sentence.',
    optional: true,
  },
  {
    field: 'narrative',
    label: 'Narrative',
    body: 'The prose that explains the finding.',
    optional: true,
  },
  {
    field: 'figures',
    label: 'Figures',
    body: 'The numbers, each with the comparison it is against.',
    optional: true,
  },
  {
    field: 'charts',
    label: 'Charts',
    body: 'Plotly figures, built only from evidence already gathered.',
    optional: true,
  },
  {
    field: 'derivation',
    label: 'Derivation',
    body: 'Per-statement source, metric, window and filter. Never optional, and never invented.',
  },
  {
    field: 'sources',
    label: 'Sources',
    body: 'The tables read, under the reader\u2019s own Unity Catalog grants.',
  },
  {
    field: 'caveats',
    label: 'Caveats',
    body: 'What the answer does not cover.',
    optional: true,
  },
];
