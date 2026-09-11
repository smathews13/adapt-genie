import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import liveTraces from '../../server/routes/__fixtures__/live-traces.json';

import type { TraceStage, TraceSummary } from './answer-shape';
import { normalizeTrace } from './answer-shape';
import {
  buildTimeline,
  clipEventSnippet,
  explorerEventLabel,
  formatMs,
  isSettled,
  llmTurnByRowId,
  runOrigin,
  stageType,
  toolPayloadSnippet,
} from './trace-timeline';

const TIMELINE_SOURCE = readFileSync(new URL('./trace-timeline.ts', import.meta.url), 'utf8');

function stage(overrides: Partial<TraceStage> & Pick<TraceStage, 'id' | 'start' | 'duration'>): TraceStage {
  return {
    name: 'A step',
    kind: 'agent',
    status: 'complete',
    calls: 1,
    input: '',
    output: '',
    startMeasured: true,
    ...overrides,
  };
}

/**
 * A run shaped like a real one: four model calls, one catalog lookup, one query
 * and one plot, laid end to end.
 */
function realisticTrace(): TraceSummary {
  return {
    id: 'tr-1',
    totalMs: 24_009,
    toolCalls: 6,
    stages: [
      stage({ id: 'step-1', name: 'Chose the next step', start: 0, duration: 2_350, calls: 1 }),
      stage({
        id: 'step-1-1-describe_table',
        name: "Read a table's columns",
        kind: 'tool',
        start: 2_350,
        duration: 78,
        depth: 1,
        parent_id: 'step-1',
      }),
      stage({ id: 'step-2', name: 'Chose the next step', start: 2_428, duration: 7_510 }),
      stage({
        id: 'step-2-1-query_named_table',
        name: 'Queried the named table',
        kind: 'tool',
        start: 9_938,
        duration: 3_620,
        depth: 1,
        parent_id: 'step-2',
      }),
      stage({ id: 'step-3', name: 'Prepared the findings', start: 13_558, duration: 5_080 }),
      stage({ id: 'plot', name: 'Built the charts', kind: 'tool', start: 18_638, duration: 1_180 }),
      stage({ id: 'synthesis', name: 'Prepared the answer', start: 19_818, duration: 4_180 }),
    ],
  };
}

describe('stageType', () => {
  it('reads the tool name out of the stage id rather than the coarse recorded kind', () => {
    // The agent records two kinds for all of these. The id carries the real name.
    expect(stageType({ id: 'step-2-1-query_named_table', kind: 'tool' })).toBe('sql');
    expect(stageType({ id: 'step-1-1-describe_table', kind: 'tool' })).toBe('discovery');
    expect(stageType({ id: 'step-1-3-data_genie', kind: 'tool' })).toBe('sql');
    expect(stageType({ id: 'plot', kind: 'tool' })).toBe('plot');
    expect(stageType({ id: 'synthesis', kind: 'agent' })).toBe('llm');
    expect(stageType({ id: 'step-4', kind: 'agent' })).toBe('llm');
    expect(stageType({ id: 'step-2-clarify', kind: 'tool' })).toBe('clarify');
  });

  it('files metadata tools under discovery, not SQL', () => {
    // These read metadata rather than data. Leaving them unclassified would make
    // the discovery roll-up under-report the step that is meant to be replacing
    // the expensive walk of every table, which is the comparison the panel exists
    // to support.
    expect(stageType({ id: 'step-1-1-list_data_assets', kind: 'tool' })).toBe('discovery');
    expect(stageType({ id: 'step-1-1-dictionary_genie', kind: 'tool' })).toBe('discovery');
  });

  it('files an unrecognised tool as a plain agent row instead of guessing a heading', () => {
    expect(stageType({ id: 'step-1-1-some_new_tool', kind: 'tool' })).toBe('agent');
    expect(stageType({ id: 'attachment', kind: 'agent' })).toBe('agent');
  });

  it('keeps a tool the agent already classified when the id is not in the map yet', () => {
    expect(stageType({ id: 'step-1-1-brand_new_lookup', kind: 'discovery' })).toBe('discovery');
    expect(stageType({ id: 'step-1-1-brand_new_query', kind: 'sql' })).toBe('sql');
    expect(stageType({ id: 'step-1-1-brand_new_genie', kind: 'genie' })).toBe('sql');
  });
});

describe('formatMs', () => {
  it('prints sub-second times as whole milliseconds and the rest to two decimals', () => {
    expect(formatMs(78)).toBe('78ms');
    expect(formatMs(1)).toBe('1ms');
    expect(formatMs(1_180)).toBe('1.18s');
    expect(formatMs(24_009)).toBe('24.01s');
  });
});

describe('buildTimeline geometry', () => {
  it('positions every bar directly from the recorded start and duration', () => {
    const model = buildTimeline(realisticTrace(), 'How many NBA games do we have?');

    expect(model.hasGeometry).toBe(true);
    // The envelope spans the full axis, because it is the axis.
    expect(model.rows[0]).toMatchObject({ type: 'run', container: true, leftPct: 0, widthPct: 100 });
    // A bar's left edge is its start over wall clock, with nothing rounded in.
    const sql = model.rows.find((row) => row.type === 'sql');
    expect(sql?.leftPct).toBeCloseTo((9_938 / 24_009) * 100, 10);
    expect(sql?.widthPct).toBeCloseTo((3_620 / 24_009) * 100, 10);
    // And the duration column is the recorded value, untouched by any widening.
    expect(sql?.durationMs).toBe(3_620);
  });

  it('never lays out a bar by accumulating durations when a start is missing', () => {
    const trace = realisticTrace();
    // A model version that stopped reporting starts. `normalizeTrace` defaults
    // the number to 0, so only the flag distinguishes this from a run that
    // genuinely began at zero.
    trace.stages = trace.stages.map((item) => ({ ...item, start: 0, startMeasured: false }));

    const model = buildTimeline(trace);

    expect(model.everyRowMeasured).toBe(false);
    // The envelope is still measured, but nothing under it is drawn.
    expect(model.measuredRows).toBe(1);
    for (const row of model.rows.filter((item) => !item.container)) {
      expect(row.leftPct).toBeNull();
      expect(row.widthPct).toBeNull();
      // The true duration survives, which is the whole point: the table still
      // reports what each step cost, it just declines to say when it ran.
      expect(row.durationMs).toBeGreaterThan(0);
    }
  });

  it('draws nothing at all when the run reported no wall clock', () => {
    const trace = realisticTrace();
    trace.totalMs = 0;

    const model = buildTimeline(trace);

    expect(model.wallClockMs).toBeNull();
    expect(model.hasGeometry).toBe(false);
    expect(model.ticks).toEqual([]);
    // Not zero. Zero would read as a run with nothing unaccounted for.
    expect(model.unaccountedMs).toBeNull();
    expect(model.rollUp.every((row) => row.sharePct === null)).toBe(true);
    // And no envelope row is invented to hold the axis up.
    expect(model.rows.some((row) => row.container)).toBe(false);
  });

  it('survives a trace with no stages and one that is absent entirely', () => {
    expect(buildTimeline(null).rows).toEqual([]);
    expect(buildTimeline(null).hasGeometry).toBe(false);
    const empty = buildTimeline({ id: 'tr', totalMs: 0, toolCalls: 0, stages: [] });
    expect(empty.everyRowMeasured).toBe(false);
    expect(empty.rollUp).toEqual([]);
  });

  it('spreads ticks across the true wall clock, ending on the real duration', () => {
    const model = buildTimeline(realisticTrace());
    expect(model.ticks.map((tick) => tick.label)).toEqual([
      '+0ms',
      '+4.80s',
      '+9.60s',
      '+14.41s',
      '+19.21s',
      '+24.01s',
    ]);
    expect(model.ticks.map((tick) => tick.pct)).toEqual([0, 20, 40, 60, 80, 100]);
  });
});

describe('buildTimeline roll-up', () => {
  it('sums leaf time by type and leaves the container out of it', () => {
    const model = buildTimeline(realisticTrace());
    const byType = Object.fromEntries(model.rollUp.map((row) => [row.type, row]));

    // 2350 + 7510 + 5080 + 4180 model calls, over four rows.
    expect(byType.llm).toMatchObject({ totalMs: 19_120, calls: 4 });
    expect(byType.sql).toMatchObject({ totalMs: 3_620, calls: 1 });
    expect(byType.plot).toMatchObject({ totalMs: 1_180, calls: 1 });
    expect(byType.discovery).toMatchObject({ totalMs: 78, calls: 1 });
    // The run envelope is 24s of the same time counted once more, so it must not
    // appear in a table that is summed.
    expect(byType.run).toBeUndefined();
    expect(Math.round(byType.llm.sharePct as number)).toBe(80);
  });

  it('gives every tile the three numbers it prints', () => {
    // The tiles replaced a table, and a blank corner on a tile is worse than a
    // gap in a column: there is no header above it to say what is missing.
    const model = buildTimeline(realisticTrace());

    expect(model.rollUp.length).toBeGreaterThan(1);
    for (const row of model.rollUp) {
      expect(row.totalMs).toBeGreaterThan(0);
      expect(row.sharePct).not.toBeNull();
      expect(row.calls).toBeGreaterThan(0);
    }
    // And they still add up to the run, which is what makes the strip readable
    // as a breakdown rather than as four unrelated figures.
    const share = model.rollUp.reduce((total, row) => total + (row.sharePct ?? 0), 0);
    expect(share).toBeGreaterThan(96);
    expect(share).toBeLessThan(104);
  });

  it('reconciles wall clock against leaf time without clamping the remainder', () => {
    const model = buildTimeline(realisticTrace());
    expect(model.wallClockMs).toBe(24_009);
    expect(model.recordedMs).toBe(23_998);
    expect(model.unaccountedMs).toBe(11);
    expect(model.totalRows).toBe(8);
    expect(model.everyRowMeasured).toBe(true);
  });

  it('reports overlap rather than hiding it behind a claim of serial execution', () => {
    const serial = buildTimeline(realisticTrace());
    // The real agent runs a blocking loop, so nothing overlaps and the panel is
    // entitled to say so.
    expect(serial.overlappingRows).toBe(0);

    const overlapping = realisticTrace();
    overlapping.stages[1] = { ...overlapping.stages[1], start: 100 };
    // A stage that begins inside another is either a container charged twice or
    // genuine concurrency. Either way it is not the serial run we describe.
    expect(buildTimeline(overlapping).overlappingRows).toBe(1);
  });

  it('counts every child a container swallows, not just the first', () => {
    // The exact shape the count exists to catch, named in its own doc comment:
    // a step row spanning the calls it is charged separately for. Compared only
    // against the previous row in start order, the second and third children
    // begin after the first one ended, so they read as serial and the panel
    // understated how much the roll-up was double-counting.
    const model = buildTimeline({
      id: 'tr-container',
      totalMs: 100,
      toolCalls: 3,
      stages: [
        stage({ id: 'step-1', name: 'A step spanning its own calls', start: 0, duration: 100 }),
        stage({ id: 'step-1-1-describe_table', kind: 'tool', start: 10, duration: 10, depth: 1, parent_id: 'step-1' }),
        stage({
          id: 'step-1-2-query_named_table',
          kind: 'tool',
          start: 30,
          duration: 10,
          depth: 1,
          parent_id: 'step-1',
        }),
        stage({ id: 'step-1-3-data_genie', kind: 'tool', start: 50, duration: 10, depth: 1, parent_id: 'step-1' }),
      ],
    });
    expect(model.overlappingRows).toBe(3);
  });

  it('counts a negative remainder as evidence instead of rounding it to zero', () => {
    const trace = realisticTrace();
    trace.totalMs = 1_000;
    const model = buildTimeline(trace);
    expect(model.unaccountedMs).toBeLessThan(0);
  });
});

describe('buildTimeline and tool calls requested in one turn', () => {
  it('measures them like any other step and prices no hypothetical', () => {
    const trace = realisticTrace();
    trace.stages.push(
      stage({
        id: 'step-2-2-describe_table',
        name: "Read a table's columns",
        kind: 'tool',
        start: 13_558,
        duration: 900,
        depth: 1,
        parent_id: 'step-2',
      })
    );

    const model = buildTimeline(trace);
    const added = model.rows.find((row) => row.id === 'step-2-2-describe_table');

    // The model used to group these by parent and cost out what running them
    // together would have saved, to write a sentence about it. The sentence is
    // gone, so the arithmetic behind it is too. What is left is what was always
    // measured: the call took 900ms and it ran when it ran.
    expect(added?.durationMs).toBe(900);
    expect(added?.startMs).toBe(13_558);
    expect(Object.keys(model)).not.toContain('concurrency');
    expect(Object.keys(model)).not.toContain('concurrencySavingMs');
    expect(Object.keys(added ?? {})).not.toContain('fanout');
  });
});

describe('buildTimeline and stage status', () => {
  it('keeps failed time out of the attributed roll-up but inside the reconciliation', () => {
    const trace = realisticTrace();
    trace.stages.push(
      stage({
        id: 'step-3-1-query_named_table',
        name: 'Queried the named table',
        kind: 'tool',
        start: 18_638,
        duration: 2_000,
        status: 'failed',
        depth: 1,
        parent_id: 'step-3',
      })
    );

    const model = buildTimeline(trace);
    const sql = model.rollUp.find((row) => row.type === 'sql');

    // The successful query only. Two seconds of a timing-out endpoint is not
    // two seconds of querying.
    expect(sql?.totalMs).toBe(3_620);
    expect(sql?.calls).toBe(1);
    // Named where it can be seen, rather than dropped.
    expect(sql?.failedMs).toBe(2_000);
    expect(sql?.failedCalls).toBe(1);
    expect(model.failedMs).toBe(2_000);
    expect(model.failedRows).toBe(1);

    // But the run really did spend that time, so the top-line reconciliation
    // counts it. Dropping it would report two idle seconds that never existed.
    expect(model.recordedMs).toBe(25_998);
  });

  it('flags a partial step without excluding the work it did', () => {
    const trace = realisticTrace();
    trace.stages[3] = { ...trace.stages[3], status: 'partial' };

    const model = buildTimeline(trace);
    const sql = model.rollUp.find((row) => row.type === 'sql');

    expect(sql?.totalMs).toBe(3_620);
    expect(sql?.partialCalls).toBe(1);
    expect(sql?.failedMs).toBe(0);
    expect(model.unsettledRows).toBe(1);
  });

  it('marks anything not complete as unfinished so no bar can read as a clean run', () => {
    expect(isSettled('complete')).toBe(true);
    for (const status of ['partial', 'failed', 'running'] as const) {
      expect(isSettled(status)).toBe(false);
    }
  });

  it('shows Prepared the answer as complete when the run verdict is Complete', () => {
    const trace = realisticTrace();
    const synthesis = trace.stages.find((row) => row.id === 'synthesis');
    expect(synthesis).toBeDefined();
    synthesis!.status = 'partial';

    const native = buildTimeline(trace);
    expect(native.rows.find((row) => row.id === 'synthesis')?.status).toBe('partial');
    expect(native.rollUp.find((row) => row.type === 'llm')?.partialCalls).toBeGreaterThan(0);

    const shown = buildTimeline(trace, '', 'complete');
    expect(shown.rows.find((row) => row.id === 'synthesis')?.status).toBe('complete');
    expect(shown.rollUp.find((row) => row.type === 'llm')?.partialCalls).toBe(0);
  });

  it('keeps Prepared the answer partial when the run verdict is Partial', () => {
    const trace = realisticTrace();
    const synthesis = trace.stages.find((row) => row.id === 'synthesis');
    synthesis!.status = 'partial';
    expect(buildTimeline(trace, '', 'partial').rows.find((row) => row.id === 'synthesis')?.status).toBe('partial');
  });
});

/**
 * The reconciliation, which is now a check on the recording rather than a line
 * on screen.
 *
 * It was printed beside the "Run process" heading as a run-together row of
 * figures -- "wall clock 51.61s · 10 rows · recorded activity 50.87s ·
 * unaccounted 740ms" -- and that line is gone from every surface. What it was
 * assembled from is still computed, and these are the claims that were worth
 * keeping from the line's own tests: the remainder is a real measurement, it is
 * never clamped, and it is absent rather than zero when there is nothing to
 * subtract from.
 *
 * NOTHING READS THESE FIELDS BUT THIS FILE. That is the point of asserting them
 * here: a timing discrepancy in a recorded trace now surfaces in this suite and
 * nowhere a reader would see it.
 */
describe('the reconciliation behind the roll-up', () => {
  it('measures a remainder that is real rather than flattering the run', () => {
    // 11ms of this run is in neither column. Keeping the figure honest is what
    // lets the seeded traces be held to it.
    const model = buildTimeline(realisticTrace());
    expect(model.wallClockMs).toBe(24_009);
    expect(model.recordedMs).toBe(23_998);
    expect(model.unaccountedMs).toBe(11);
  });

  it('reports zero as zero where the envelope is fully accounted for', () => {
    const trace = realisticTrace();
    trace.totalMs = buildTimeline(trace).recordedMs;
    expect(buildTimeline(trace).unaccountedMs).toBe(0);
  });

  it('has no remainder to report when there is no envelope to subtract from', () => {
    const trace = realisticTrace();
    trace.totalMs = 0;
    const model = buildTimeline(trace);
    // Null, not zero. Zero would read as a run with nothing unaccounted for,
    // which is a measurement nobody took.
    expect(model.wallClockMs).toBeNull();
    expect(model.unaccountedMs).toBeNull();
    // The rows themselves were still measured.
    expect(model.recordedMs).toBeGreaterThan(0);
  });

  it('keeps an impossible remainder negative rather than clamping it to zero', () => {
    // Rows that overlap cannot happen in this agent's serial loop, so a negative
    // remainder is evidence the recording is wrong. Clamped, it would read as a
    // healthy run.
    const trace = realisticTrace();
    trace.totalMs = 1_000;
    expect(buildTimeline(trace).unaccountedMs as number).toBeLessThan(0);
  });

  it('says nothing at all about a run with no steps', () => {
    const model = buildTimeline(null);
    expect(model.rows).toEqual([]);
    expect(model.recordedMs).toBe(0);
    expect(model.unaccountedMs).toBeNull();
  });

  it('no longer offers a way to render the figures as one line', () => {
    // Removed at the source rather than per call site, so it cannot come back on
    // one surface: there were two, the ADAPT Ask transcript and the Monitoring run
    // detail, and both drew it from AnswerCard.
    expect(TIMELINE_SOURCE).not.toContain('traceHeadline');
    expect(TIMELINE_SOURCE).not.toContain('reconciliationParts');
  });
});

describe('runOrigin', () => {
  it('treats the run-relative offsets the agent writes today as already based at zero', () => {
    const stages = realisticTrace().stages;
    expect(runOrigin(stages)).toEqual({ origin: 0, rebased: false });
    // The first stage keeps its true offset rather than being shifted onto zero.
    expect(buildTimeline(realisticTrace()).rows[1].startMs).toBe(0);
  });

  it('rebases an absolute clock onto its earliest stage', () => {
    const epoch = 1_770_000_000_000;
    const trace = realisticTrace();
    trace.stages = trace.stages.map((item) => ({ ...item, start: item.start + epoch }));

    const model = buildTimeline(trace);

    expect(runOrigin(trace.stages).rebased).toBe(true);
    // Positions are identical to the offset case, which is the point: only the
    // origin calculation changes, never the geometry that reads from it.
    expect(model.rows[1].startMs).toBe(0);
    expect(model.rows.find((row) => row.type === 'sql')?.startMs).toBe(9_938);
  });

  it('does not mistake a long run for an absolute clock', () => {
    // Ten minutes in, still six orders of magnitude below an epoch.
    expect(runOrigin([stage({ id: 'step-1', start: 600_000, duration: 10 })]).rebased).toBe(false);
  });
});

/**
 * The captured traces, which are the only evidence that any of this is true of
 * real runs rather than only of the fixture above.
 *
 * See `server/routes/__fixtures__/README.md`. The reconciliation numbers here
 * are that document's, so if the agent's timing changes shape these fail rather
 * than the panel quietly reporting a different story.
 */
describe('buildTimeline against the recorded live traces', () => {
  // Each key holds the whole `/api/runs/:id/trace` response, and the summary
  // this module reads is the `trace` inside it.
  const captured = liveTraces as unknown as Record<string, { trace: { trace: unknown } }>;
  const summaryOf = (key: string) => normalizeTrace(captured[key].trace.trace);
  const traced = [
    'chartsSingleTurn',
    'chartsMultiTurnPlanApproved',
    'governanceRefusal',
    'partialStepBudget',
    'partialMultiTurnFollowUp',
    'completeWithHeadGap',
  ] as const;

  it.each(traced)('reconciles %s to within the head gap', (key) => {
    const model = buildTimeline(summaryOf(key));

    expect(model.hasGeometry).toBe(true);
    expect(model.everyRowMeasured).toBe(true);
    // Summing every stage, the remainder is the head gap plus the gaps between
    // stages. It is about a millisecond everywhere except the one run with real
    // setup time before its first stage, which is 513ms.
    expect(model.unaccountedMs).not.toBeNull();
    expect(model.unaccountedMs as number).toBeGreaterThanOrEqual(0);
    expect(model.unaccountedMs as number).toBeLessThan(600);
  });

  it('would have reported a fifth of the run as unaccounted if it summed leaves', () => {
    const trace = summaryOf('chartsSingleTurn');
    const model = buildTimeline(trace);
    const parents = new Set(trace.stages.map((item) => item.parent_id).filter(Boolean));
    const leafOnly = trace.stages
      .filter((item) => !parents.has(item.id))
      .reduce((total, item) => total + item.duration, 0);

    // The mistake this module exists to avoid, measured. Summing leaves is
    // correct for a tree that nests; this one does not.
    expect((model.wallClockMs as number) - leafOnly).toBeGreaterThan(15_000);
    expect(model.unaccountedMs as number).toBeLessThan(2);
  });

  it('finds no overlap anywhere, so the serial caption is a measurement', () => {
    for (const key of traced) {
      expect(buildTimeline(summaryOf(key)).overlappingRows).toBe(0);
    }
  });

  it('never nests a child inside its parent, because no child starts before one ends', () => {
    const trace = summaryOf('partialMultiTurnFollowUp');
    const byId = new Map(trace.stages.map((item) => [item.id, item]));
    let pairs = 0;
    for (const child of trace.stages) {
      const parent = child.parent_id ? byId.get(child.parent_id) : undefined;
      if (!parent) continue;
      pairs += 1;
      // The parent is the model call that chose the tool; the tool ran after it.
      expect(child.start).toBeGreaterThanOrEqual(parent.start + parent.duration);
    }
    expect(pairs).toBeGreaterThan(0);
  });

  it('reads the customer’s tool vocabulary out of ids the agent never labels that way', () => {
    const model = buildTimeline(summaryOf('chartsSingleTurn'));
    const types = new Set(model.rollUp.map((row) => row.type));

    // `kind` is only ever 'agent' or 'tool' in the capture, so every one of
    // these came from the recorded id rather than from the recorded kind.
    expect(types.has('llm')).toBe(true);
    expect(types.has('discovery')).toBe(true);
    expect(model.rollUp.every((row) => row.totalMs > 0)).toBe(true);
    // Row count, not the `calls` fan-out field, which is only above 1 on a
    // 'Chose the next step' stage and is not additive with anything.
    const rows = model.rows.filter((row) => !row.container).length;
    expect(model.rollUp.reduce((total, row) => total + row.calls + row.failedCalls, 0)).toBe(rows);
  });

  it('marks the partial run partial and still counts the time it really spent', () => {
    const model = buildTimeline(summaryOf('partialStepBudget'));

    // All four partial stages in the capture are the depth-0 `cap` stage, and
    // they ran for 11-15s. Partial describes the outcome, not a missing figure.
    expect(model.unsettledRows).toBeGreaterThan(0);
    expect(model.failedRows).toBe(0);
    const partialRows = model.rows.filter((row) => row.status === 'partial');
    expect(partialRows.length).toBeGreaterThan(0);
    for (const row of partialRows) expect(row.durationMs).toBeGreaterThan(0);
    // And it is still inside the reconciliation, because the run spent it.
    expect(model.unaccountedMs as number).toBeLessThan(600);
  });

  it('says nothing rather than something wrong about a run with no trace', () => {
    const model = buildTimeline(summaryOf('benchmarkNoTrace'));
    expect(model.rows).toEqual([]);
    expect(model.hasGeometry).toBe(false);
    expect(model.rollUp).toEqual([]);
  });
});

describe('buildTimeline against the wire', () => {
  it('refuses geometry for a payload whose stages carry no start at all', () => {
    // Exactly what an older model version puts on the wire: durations, no starts.
    const wire = {
      id: 'tr-old',
      totalMs: 4_200,
      toolCalls: 2,
      stages: [
        { id: 's1', name: 'Chose the next step', kind: 'agent', duration: 640, status: 'complete', calls: 1 },
        { id: 's2', name: 'Queried', kind: 'tool', duration: 2_400, status: 'complete', calls: 1 },
      ],
    };

    const model = buildTimeline(normalizeTrace(wire));

    expect(model.everyRowMeasured).toBe(false);
    expect(model.rows.filter((row) => !row.container).every((row) => row.leftPct === null)).toBe(true);
    // The roll-up is still honest and still useful, durations were recorded.
    expect(model.recordedMs).toBe(3_040);
  });

  it('keeps geometry for a payload that does carry starts', () => {
    const model = buildTimeline(normalizeTrace(realisticTrace() as unknown));
    expect(model.everyRowMeasured).toBe(true);
    expect(model.hasGeometry).toBe(true);
  });
});

describe('explorer event labels (notebook vocabulary)', () => {
  it('names the envelope and numbers model calls the way the notebook does', () => {
    const model = buildTimeline(realisticTrace(), 'How many NBA games do we have?');
    const turns = llmTurnByRowId(model.rows);
    const labels = model.rows.map((row) => explorerEventLabel(row, turns));

    expect(labels[0]).toBe('run - [orchestrator]');
    expect(labels.filter((label) => label.startsWith('model call - [orchestrator] turn'))).toEqual([
      'model call - [orchestrator] turn 1',
      'model call - [orchestrator] turn 2',
      'model call - [orchestrator] turn 3',
      'model call - [orchestrator] turn 4',
    ]);
  });

  it('puts the tool name and a short payload on discovery and SQL rows', () => {
    const describe = {
      id: 'step-1-1-describe_table',
      type: 'discovery' as const,
      name: "Read a table's columns",
      input: '{"full_name": "cdp_share_prod.take_two.gold_title_daily"}',
      container: false,
    };
    const query = {
      id: 'step-2-1-query_named_table',
      type: 'sql' as const,
      name: 'Queried the named table',
      input: JSON.stringify({
        sql: "SELECT COUNT(CASE WHEN title = 'NBA 2K23' THEN 1 END) AS games FROM gold",
      }),
      container: false,
    };
    const turns = new Map<string, number>();
    expect(explorerEventLabel(describe, turns)).toBe('describe_table cdp_share_prod.take_two.gold_title_daily');
    const sqlLabel = explorerEventLabel(query, turns);
    expect(sqlLabel).toMatch(/^query_named_table SELECT COUNT/);
    expect(sqlLabel).toContain('…');
  });

  it('labels plot as new_plot and clips long payloads', () => {
    expect(clipEventSnippet('a'.repeat(80))).toMatch(/…$/);
    expect(clipEventSnippet('a'.repeat(80)).length).toBe(52);
    expect(toolPayloadSnippet('{"full_name": "cat.sch.table"}')).toBe('cat.sch.table');
    expect(toolPayloadSnippet('{"name": "silver_gameplay_activity"}')).toBe('silver_gameplay_activity');
    expect(
      explorerEventLabel(
        {
          id: 'step-1-1-resolve_table',
          type: 'discovery',
          name: 'Located the named table',
          input: '{"name": "silver_gameplay_activity"}',
          container: false,
        },
        new Map()
      )
    ).toBe('resolve_table silver_gameplay_activity');
    expect(
      explorerEventLabel(
        {
          id: 'plot',
          type: 'plot',
          name: 'Built the charts',
          input: '{"data":[{"x":["NBA 2K23"]}]}',
          container: false,
        },
        new Map()
      )
    ).toMatch(/^new_plot /);
  });
});
