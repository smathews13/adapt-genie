import { describe, expect, it } from 'vitest';

import { DEFAULT_RUNTIME_SETTINGS } from './runtime-settings';
import { runRuntimeUsedChips, runRuntimeUsedFromStored } from './run-runtime-used';

const SENT = {
  ...DEFAULT_RUNTIME_SETTINGS,
  answer: {
    ...DEFAULT_RUNTIME_SETTINGS.answer,
    takeaway: true,
    narrative: true,
    figures: false,
    charts: false,
    narrativeMaxCharacters: 800,
    figuresOrder: 'totals-first' as const,
  },
};

describe('the runtime a stored run used', () => {
  it('reads the snapshot off a stored answer, which is what Ask sent', () => {
    const used = runRuntimeUsedFromStored({ type: 'answer', runtime_settings: SENT });
    expect(used?.answer.figures).toBe(false);
    expect(used?.answer.narrativeMaxCharacters).toBe(800);
    expect(used?.answer.figuresOrder).toBe('totals-first');
  });

  it('reads the same snapshot off the invoke body, nested under custom_inputs', () => {
    const used = runRuntimeUsedFromStored({
      input: [],
      custom_inputs: { conversation_id: 'c1', runtime_settings: SENT },
    });
    expect(used?.answer.narrativeMaxCharacters).toBe(800);
  });

  it('does not invent today’s defaults when the run stored nothing', () => {
    expect(runRuntimeUsedFromStored({ type: 'answer', takeaway: 'Weekly actives fell.' })).toBeNull();
    expect(runRuntimeUsedFromStored(null)).toBeNull();
    expect(runRuntimeUsedFromStored({ runtime_settings: {} })).toBeNull();
    expect(runRuntimeUsedFromStored({ runtime_settings: { loop: { maxSteps: 12 } } })).toBeNull();
  });

  it('names the answer settings applied to the run', () => {
    const chips = runRuntimeUsedChips({
      answer: {
        takeaway: true,
        narrative: false,
        figures: null,
        charts: false,
        narrativeMaxCharacters: 0,
        figuresOrder: 'totals-first',
      },
    });
    expect(chips.map((chip) => `${chip.label} ${chip.value}`)).toEqual([
      'Takeaway on',
      'Narrative off',
      'Charts off',
      'Narrative cap uncapped',
      'Order Totals first',
    ]);
  });
});
