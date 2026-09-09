import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { TraceStage } from './answer-shape';
import { deriveCurrentStageView, PLANNING_STAGE_LABEL, WORKING_STAGE_LABEL } from './current-stage-view';

function stage(overrides: Partial<TraceStage> & Pick<TraceStage, 'id'>): TraceStage {
  return {
    name: 'Choosing next step',
    kind: 'agent',
    start: 0,
    duration: 0,
    status: 'running',
    calls: 0,
    input: '',
    output: '',
    startMeasured: true,
    ...overrides,
    id: overrides.id,
  };
}

describe('the shared current-stage view', () => {
  it('uses planning in both seats only before any real stage exists', () => {
    expect(deriveCurrentStageView({ stages: [], runActive: true })).toEqual({
      mode: 'planning',
      label: PLANNING_STAGE_LABEL,
      index: -1,
      stageId: null,
      hasStageEvidence: false,
    });
    expect(
      deriveCurrentStageView({
        stages: [stage({ id: 'planning', name: PLANNING_STAGE_LABEL })],
        runActive: true,
      }).label
    ).toBe(PLANNING_STAGE_LABEL);
  });

  it('switches to the first tool as soon as its start event arrives', () => {
    const view = deriveCurrentStageView({
      stages: [stage({ id: 'step-1-1-query_metrics', name: 'Querying metrics', kind: 'tool' })],
      runActive: true,
    });
    expect(view).toMatchObject({
      mode: 'active',
      label: 'Querying metrics',
      index: 0,
      stageId: 'step-1-1-query_metrics',
      hasStageEvidence: true,
    });
  });

  it('ignores an overlapping planning parent in favor of the latest active leaf', () => {
    const view = deriveCurrentStageView({
      stages: [
        stage({ id: 'orchestrator', name: 'Orchestrator', start: 0, depth: 0 }),
        stage({ id: 'step-1', name: 'Choosing next step', start: 100, depth: 1 }),
        stage({ id: 'step-1-1-describe_table', name: 'Reading table columns', kind: 'tool', start: 300, depth: 2 }),
      ],
      runActive: true,
    });
    expect(view).toMatchObject({ label: 'Reading table columns', index: 2 });
  });

  it('advances through sequential stages without returning to planning between them', () => {
    const first = stage({ id: 'step-1', name: 'Choosing next step', start: 10, status: 'complete', duration: 40 });
    expect(deriveCurrentStageView({ stages: [first], runActive: true }).label).toBe('Choosing next step');

    const second = stage({ id: 'step-1-1-describe_table', name: 'Reading table columns', start: 60 });
    expect(deriveCurrentStageView({ stages: [first, second], runActive: true }).label).toBe('Reading table columns');
  });

  it('holds the latest completed stage while the run remains active', () => {
    const view = deriveCurrentStageView({
      stages: [
        stage({ id: 'step-1', name: 'Choosing next step', status: 'complete', start: 0, duration: 20 }),
        stage({
          id: 'step-1-1-query_metrics',
          name: 'Querying metrics',
          kind: 'tool',
          status: 'complete',
          start: 20,
          duration: 80,
        }),
      ],
      runActive: true,
    });
    expect(view).toMatchObject({ mode: 'completed', label: 'Querying metrics', index: 1 });
    expect(view.label).not.toBe(PLANNING_STAGE_LABEL);
  });

  it('uses generic working copy only when stage evidence has no usable label', () => {
    expect(
      deriveCurrentStageView({
        stages: [stage({ id: 'step-1', name: '   ' })],
        runActive: true,
      }).label
    ).toBe(WORKING_STAGE_LABEL);
  });

  it('does not resurrect planning after a final answer', () => {
    expect(deriveCurrentStageView({ stages: [], runActive: false, hasFinalAnswer: true })).toMatchObject({
      mode: 'final',
      label: 'Answer complete',
    });
    expect(
      deriveCurrentStageView({
        stages: [stage({ id: 'synthesis', name: 'Preparing final answer', status: 'complete', duration: 100 })],
        runActive: false,
        hasFinalAnswer: true,
      }).label
    ).toBe('Preparing final answer');
  });

  it('uses measured stage time instead of SSE arrival order', () => {
    const view = deriveCurrentStageView({
      stages: [
        stage({ id: 'step-2', name: 'Reading table columns', status: 'complete', start: 200, duration: 50 }),
        stage({ id: 'late-step-1', name: 'Querying metrics', status: 'complete', start: 20, duration: 30 }),
      ],
      runActive: true,
    });
    expect(view).toMatchObject({ label: 'Reading table columns', index: 0 });
  });

  it('derives without mutating stages or starting any other state', () => {
    const stages = Object.freeze([
      Object.freeze(stage({ id: 'step-1', name: 'Choosing next step', status: 'complete' })),
    ]);
    expect(() => deriveCurrentStageView({ stages, runActive: true })).not.toThrow();
    expect(stages).toHaveLength(1);
  });
});

describe('Ask keeps live stage state out of the ADAPT insight rail', () => {
  const home = readFileSync(new URL('./HomePage.tsx', import.meta.url), 'utf8');

  it('derives one compact working label for the center progress view', () => {
    expect(home.match(/deriveCurrentStageView\(/g)).toHaveLength(1);
    expect(home).toContain('const workingLabel = (() => {');
    expect(home).toContain('<LiveProgress');
    expect(home).toContain('stages={liveStages}');
  });

  it('uses the right rail for business insight, not a second stage visualization', () => {
    expect(home).toContain('className="trace-inspector insight-rail"');
    expect(home).not.toContain('currentStage={currentStage}');
    expect(home).not.toContain('AgentPathConstellation');
  });
});
