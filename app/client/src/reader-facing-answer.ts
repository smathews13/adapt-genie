/**
 * Apparatus the stored answer still carries, and must not be shown as the story.
 *
 * A truncated or deadline-stopped run often stores the last tool call as the
 * narrative -- `data_genie({"question": "..."})` then an ASCII grid -- under a
 * canned takeaway. The Run Explorer's Final Answer module, and the shared prose
 * renderer ADAPT Ask uses, both have to refuse that dump rather than print it.
 *
 * Nothing here rewrites a finding. Tool-call JSON is dropped, a canned headline
 * is replaced only when a real sentence survives, and the status label is read
 * off the caveats the agent already wrote.
 */
import {
  answerHasLanded,
  synthesisIncomplete,
  TIME_LIMIT_TAKEAWAY,
  UNANSWERED_LINE,
  WRITER_STOPPED_CAVEAT,
  type VerdictStage,
} from '../../shared/run-verdict';
import { DEGRADED_ANSWER_MARKER } from '../../shared/setup-remedies';
import { renderableCharts, type Chart } from './answer-chart-data';

/** Words arrived, but no figures or tables. Not a policy deny. */
const NO_STRUCTURED_RESULT =
  /no structured result|without a structured result|response format was incomplete|response ended before the answer format completed/i;

/** Governed tools whose call-site JSON has been seen dumped into a stored narrative. */
const TOOL_CALL = /\b(data_genie|dictionary_genie|query_named_table|run_sql|search_sources)\s*\(/;

/**
 * Headlines that describe the shape of the reply, not a finding.
 *
 * "The analysis completed from assessed sources." is the one on the reported
 * run: it sits over a tool dump and a deadline caveat, and reads as a success
 * the rest of the card then contradicts.
 */
const CANNED_TAKEAWAY = [
  /^the analysis completed\b/i,
  /\bfrom assessed sources\b/i,
  /^the agent returned an answer\b/i,
  /^the agent answered in prose\b/i,
];

/** Transport/process labels that are never a reader-facing answer. */
const UNSUITABLE_LABEL_TAKEAWAY = /^(?:returned|result|query result|answer)\s*:?\s*$/i;
const NO_DIRECT_ANSWER = 'The assessed data did not contain a direct answer to the question.';
const INTERNAL_ANSWER_LINE = /^\s*(?:asking genie space\b|query interpretation\s*:|query result\s*:)/i;
const TABLE_INVENTORY_HEADING = /^\s*relevant tables in this genie space are\s*:/i;
const TABLE_INVENTORY_LINE = /^\s*(?:[-*]\s+)?`?[\w-]+(?:\.[\w-]+){1,2}`?[,;]?(?:\s*[-—:].*)?\s*$/;

/** Stored when the writer never finished. Not a finding, and not the title of a card that already has tables. */
const UNANSWERED_TAKEAWAY = UNANSWERED_LINE;

/** How much of a surviving sentence is used when the stored takeaway was canned. */
const TAKEAWAY_LIMIT = 220;

function matchingParen(source: string, openAt: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = openAt; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === '\\') {
        index += 1;
        continue;
      }
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/**
 * The narrative with tool-call JSON removed.
 *
 * Unclosed calls -- a deadline often cuts the dump mid-argument -- drop through
 * the end of their line rather than leaving a `data_genie({` stub in the prose.
 * Surrounding findings are kept, including a pipe table that followed the call.
 */
export function stripToolCallDumps(source: string): string {
  if (!source) return '';
  let index = 0;
  let out = '';
  while (index < source.length) {
    const rest = source.slice(index);
    const match = TOOL_CALL.exec(rest);
    if (!match || match.index === undefined) {
      out += rest;
      break;
    }
    out += rest.slice(0, match.index);
    const openAt = index + match.index + match[0].length - 1;
    const closeAt = matchingParen(source, openAt);
    if (closeAt < 0) {
      const newline = source.indexOf('\n', openAt);
      index = newline < 0 ? source.length : newline;
      continue;
    }
    index = closeAt + 1;
    if (source[index] === ';') index += 1;
    const transportSuffix = source.slice(index).match(/^[ \t]*returned\s*:[ \t]*(?:\r?\n)?/i);
    if (transportSuffix) index += transportSuffix[0].length;
  }
  const lines: string[] = [];
  let skippingInventory = false;
  for (const line of out.split('\n')) {
    if (TABLE_INVENTORY_HEADING.test(line)) {
      skippingInventory = true;
      continue;
    }
    if (skippingInventory) {
      if (!line.trim()) {
        skippingInventory = false;
        continue;
      }
      if (TABLE_INVENTORY_LINE.test(line)) continue;
      skippingInventory = false;
    }
    if (INTERNAL_ANSWER_LINE.test(line)) continue;
    lines.push(line);
  }
  return lines
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function isCannedTakeaway(text: string): boolean {
  const value = text.trim();
  if (!value) return true;
  return CANNED_TAKEAWAY.some((pattern) => pattern.test(value));
}

function firstFinding(narrative: string): string {
  const first = stripToolCallDumps(narrative)
    .split('\n')
    .map((line) => line.trim().replace(/^#+\s*/, ''))
    .find(
      (line) =>
        line &&
        !line.includes('|') &&
        !isCannedTakeaway(line) &&
        !UNSUITABLE_LABEL_TAKEAWAY.test(line) &&
        !/^asking genie space\b/i.test(line) &&
        !UNANSWERED_TAKEAWAY.test(line) &&
        !TOOL_CALL.test(line)
    );
  if (!first) return '';
  return first.length > TAKEAWAY_LIMIT ? `${first.slice(0, TAKEAWAY_LIMIT - 1)}…` : first;
}

/**
 * The headline a reader should see.
 *
 * A canned completion line is not a finding. "This question was not answered."
 * is not a finding either once the card already has tables or figures — that
 * sentence was the deadline path's title over a real answer.
 */
export function readerFacingTakeaway(
  takeaway: string,
  narrative: string,
  extras?: { figures?: readonly unknown[] | null; content?: string | null }
): string {
  const landed = answerHasLanded({ figures: extras?.figures, narrative, content: extras?.content });
  if (UNANSWERED_TAKEAWAY.test(takeaway.trim())) {
    if (!landed) return takeaway.trim();
    return firstFinding(narrative) || firstFinding(extras?.content ?? '') || TIME_LIMIT_TAKEAWAY;
  }
  if (UNSUITABLE_LABEL_TAKEAWAY.test(takeaway.trim())) {
    return firstFinding(narrative) || firstFinding(extras?.content ?? '') || NO_DIRECT_ANSWER;
  }
  if (!isCannedTakeaway(takeaway)) return takeaway.trim();
  return firstFinding(narrative);
}

/**
 * The narrative with the headline removed when it is the same sentence twice.
 *
 * The deadline path used to put the canned takeaway in both slots. The card
 * then printed it as the title and again as the first line of the body.
 */
export function readerFacingNarrative(
  takeaway: string,
  narrative: string,
  extras?: { figures?: readonly unknown[] | null; content?: string | null }
): string {
  const cleaned = stripToolCallDumps(narrative);
  const headline = readerFacingTakeaway(takeaway, narrative, extras);
  const lines = cleaned.split('\n');
  const firstAt = lines.findIndex((line) => line.trim());
  if (firstAt < 0) return cleaned;
  const first = lines[firstAt].trim();
  // Drop a leading line that restates the title: the stored takeaway, the
  // headline we just chose, the unanswered line over a landed card, or the
  // canned completion the deadline path wrote.
  if (
    first === headline ||
    first === takeaway.trim() ||
    isCannedTakeaway(first) ||
    (UNANSWERED_TAKEAWAY.test(first) &&
      answerHasLanded({ figures: extras?.figures, narrative, content: extras?.content }))
  ) {
    lines.splice(firstAt, 1);
    return lines.join('\n').replace(/^\n+/, '').trim();
  }
  return cleaned;
}

export interface AnswerHonesty {
  /** Section title. Partial when the run did not finish cleanly. */
  eyebrow: string;
  tone: 'complete' | 'partial';
}

function hasStructuredEvidence(input: {
  figures?: readonly unknown[] | null;
  charts?: readonly Chart[] | null;
  narrative?: string | null;
  content?: string | null;
}): boolean {
  if ((input.figures?.length ?? 0) > 0) return true;
  if (renderableCharts(input.charts ? [...input.charts] : []).length > 0) return true;
  return /\|.+\|/.test([input.narrative, input.content].filter(Boolean).join('\n'));
}

function answerFingerprint(text: string | null | undefined): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function answerEchoesQuestion(input: {
  question?: string | null;
  takeaway?: string | null;
  narrative?: string | null;
  content?: string | null;
  figures?: readonly unknown[] | null;
  charts?: readonly Chart[] | null;
}): boolean {
  const question = answerFingerprint(input.question);
  if (!question || answerFingerprint(input.takeaway) !== question || answerFingerprint(input.narrative) !== question)
    return false;
  if (hasStructuredEvidence(input)) return false;
  return !answerHasLanded({ narrative: '', content: input.content, figures: input.figures });
}

function isProseOnlyDegraded(
  input: { caveats: readonly string[] } & Parameters<typeof hasStructuredEvidence>[0]
): boolean {
  if (hasStructuredEvidence(input)) return false;
  return input.caveats.some(
    (text) => text.trimStart().startsWith(DEGRADED_ANSWER_MARKER) && NO_STRUCTURED_RESULT.test(text)
  );
}

/**
 * Whether this section may be labelled "Final answer".
 *
 * Specific warnings stay in Caveats. Partial is already represented by the
 * outcome badge; duplicating caveat prose in a large red alert made harmless
 * Optional analysis package notes look like answer failures.
 */
export function answerHonesty(input: {
  truncated?: boolean | null;
  caveats: readonly string[];
  figures?: readonly unknown[] | null;
  charts?: readonly Chart[] | null;
  question?: string | null;
  takeaway?: string | null;
  narrative?: string | null;
  content?: string | null;
  stages?: readonly VerdictStage[];
}): AnswerHonesty {
  const caveats = input.caveats.map((caveat) => caveat.trim()).filter(Boolean);
  if (answerEchoesQuestion(input)) {
    return { eyebrow: 'Incomplete answer', tone: 'partial' };
  }
  // A words-only degraded reply has enough narrative to trip answerHasLanded,
  // and used to be titled Final answer. The agent wrote sentences; it did not
  // produce a complete result.
  if (isProseOnlyDegraded({ ...input, caveats })) {
    return { eyebrow: 'Partial answer', tone: 'partial' };
  }
  if (answerHasLanded(input)) {
    const stages = input.stages ?? [];
    const writerStopped =
      synthesisIncomplete(stages, caveats) ||
      (!stages.some((stage) => stage.id === 'synthesis') && caveats.some((text) => WRITER_STOPPED_CAVEAT.test(text)));
    if (writerStopped) {
      return { eyebrow: 'Partial answer', tone: 'partial' };
    }
    return { eyebrow: 'Final answer', tone: 'complete' };
  }
  const truncated =
    input.truncated === true ||
    caveats.some((text) => /turn deadline|budget for this turn was spent|stopped early/i.test(text));
  const incomplete = caveats.some((text) => /sources for this answer are incomplete/i.test(text));
  if (!truncated && !incomplete) {
    return { eyebrow: 'Final answer', tone: 'complete' };
  }
  return {
    eyebrow: truncated ? 'Partial answer' : incomplete ? 'Incomplete answer' : 'Qualified answer',
    tone: 'partial',
  };
}
