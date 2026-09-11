import { describe, expect, it } from 'vitest';

import liveTraces from '../../server/routes/__fixtures__/live-traces.json';
import { describePayload, payloadSize } from './trace-payload';

/** Every stage recorded in the capture, deduplicated across the runs. */
function capturedStages() {
  const found: { id: string; input?: string; output?: string }[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (Array.isArray(record.stages) && typeof record.totalMs === 'number') {
      found.push(...(record.stages as { id: string; input?: string; output?: string }[]));
    }
    Object.values(record).forEach(walk);
  };
  walk(liveTraces);
  const seen = new Set<string>();
  return found.filter((stage) => {
    const key = `${stage.id}:${stage.input?.length}:${stage.output?.length}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const stages = capturedStages();
const byId = (fragment: string) => stages.find((stage) => stage.id.includes(fragment))!;

describe('describePayload against the recorded payloads', () => {
  it('has real stages to work with, so the rest of this file means something', () => {
    expect(stages.length).toBeGreaterThan(50);
  });

  it('unwraps a query out of its JSON envelope instead of leaving it escaped', () => {
    const payload = describePayload(byId('query_named_table').input);

    expect(payload.fields).not.toBeNull();
    const sql = payload.fields!.find((field) => field.key === 'sql')!;
    expect(sql).toBeDefined();
    // The whole point: on the wire this is one line containing the two
    // characters backslash-n, and JSON.stringify would have kept it that way.
    expect(sql.value).toContain('\n');
    expect(sql.value).not.toContain('\\n');
    expect(sql.value).toMatch(/SELECT/);
    expect(sql.block).toBe(true);
  });

  it('labels a short scalar argument without turning it into a block', () => {
    const payload = describePayload(byId('describe_table').input);

    expect(payload.fields).toHaveLength(1);
    const [field] = payload.fields!;
    expect(field.key).toBe('full_name');
    expect(field.value).toMatch(/^[\w]+\.[\w]+\.[\w]+$/);
    // A single table name is not worth its own scrolling box. It is 63
    // characters, and it is the commonest argument in the whole capture, so the
    // inline threshold has to clear it.
    expect(field.value.length).toBeGreaterThan(60);
    expect(field.block).toBe(false);
  });

  it('gives a question in prose its own block, unlike a table name', () => {
    // Both are single-line strings; length is what separates them, and the
    // capture puts a wide gap between the two clusters.
    const questions = stages
      .map((stage) => describePayload(stage.input).fields?.find((field) => field.key === 'question'))
      .filter((field): field is NonNullable<typeof field> => Boolean(field));

    expect(questions.length).toBeGreaterThan(5);
    const longest = questions.reduce((a, b) => (a.value.length > b.value.length ? a : b));
    expect(longest.value.length).toBeGreaterThan(400);
    expect(longest.block).toBe(true);
  });

  it('keeps a column list exactly as recorded, because its line breaks are the structure', () => {
    const payload = describePayload(byId('describe_table').output);

    expect(payload.fields).toBeNull();
    expect(payload.lines).toBeGreaterThan(5);
    expect(payload.body).toContain('\n- event_date: date');
  });

  it('leaves a pipe-delimited result set alone rather than guessing at a table', () => {
    const payload = describePayload(byId('run_sql').output);

    expect(payload.fields).toBeNull();
    expect(payload.body).toContain('|');
  });

  it('never loses a character of anything in the capture', () => {
    for (const stage of stages) {
      for (const field of [stage.input, stage.output]) {
        const payload = describePayload(field);
        if (payload.fields) {
          // Unwrapping re-lays-out the JSON, so the invariant is that every
          // value survives, not that the byte count matches. Held against the
          // parsed original rather than against the field's own length, which
          // is a number no string can fail: every key is still there, in the
          // recorded order, and a string value is the string that was recorded
          // -- so a dropped key, a reordering or a clipped query fails here.
          const parsed = JSON.parse((field ?? '').trim()) as Record<string, unknown>;
          expect(payload.fields.map((entry) => entry.key)).toEqual(Object.keys(parsed));
          for (const entry of payload.fields) {
            const recorded = parsed[entry.key];
            if (typeof recorded === 'string') expect(entry.value).toBe(recorded);
          }
        } else {
          expect(payload.body).toBe(field ?? '');
        }
      }
    }
  });

  it('finds no payload in the capture larger than the agent lets through', () => {
    // `MAX_STAGE_CHARS` is 20,000 in agent.py. The largest here is far smaller,
    // which is why the renderer is built for the ceiling and not for this.
    const largest = Math.max(...stages.flatMap((stage) => [stage.input?.length ?? 0, stage.output?.length ?? 0]));
    expect(largest).toBeGreaterThan(2_000);
    expect(largest).toBeLessThan(20_000);
  });

  it('reports nothing truncated in the capture, and says so honestly when it is', () => {
    for (const stage of stages) {
      expect(describePayload(stage.input).truncated).toBe(false);
      expect(describePayload(stage.output).truncated).toBe(false);
    }

    // The notice agent.py appends at its per-stage ceiling.
    const clipped = describePayload(`SELECT 1\n… truncated at 20,000 characters (48,120 total).`);
    expect(clipped.truncated).toBe(true);
    // And the one it appends at the whole-trace ceiling.
    expect(describePayload('x\n… truncated: the trace reached its size budget.').truncated).toBe(true);
  });
});

describe('describePayload on the shapes the capture does not contain', () => {
  it('shows a malformed payload as recorded rather than refusing it', () => {
    const payload = describePayload('{"sql": "SELECT 1"');
    expect(payload.fields).toBeNull();
    expect(payload.body).toBe('{"sql": "SELECT 1"');
  });

  it('does not unwrap an array, which has no keys to label', () => {
    const payload = describePayload('[1, 2, 3]');
    expect(payload.fields).toBeNull();
  });

  it('renders a nested object as JSON, since there is no more faithful form', () => {
    const payload = describePayload('{"filter": {"label": "Rockstar"}}');
    expect(payload.fields![0].value).toBe('{\n  "label": "Rockstar"\n}');
    expect(payload.fields![0].block).toBe(true);
  });

  it('treats an empty field as empty rather than as the string "undefined"', () => {
    for (const value of [undefined, null, '']) {
      const payload = describePayload(value);
      expect(payload.empty).toBe(true);
      expect(payload.chars).toBe(0);
      expect(payloadSize(payload)).toBe('');
    }
  });

  it('survives a payload at the agent ceiling without special-casing it', () => {
    const payload = describePayload('x'.repeat(20_000));
    expect(payload.chars).toBe(20_000);
    expect(payload.body.length).toBe(20_000);
    expect(payload.truncated).toBe(false);
  });
});

describe('payloadSize', () => {
  it('counts lines when there are lines, because that is the useful scale', () => {
    expect(payloadSize(describePayload('one'))).toBe('3 characters');
    expect(payloadSize(describePayload('a\nb'))).toBe('2 lines · 3 characters');
  });

  it('groups digits so a large number reads at a glance', () => {
    expect(payloadSize(describePayload('x'.repeat(20_000)))).toBe('20,000 characters');
  });
});
