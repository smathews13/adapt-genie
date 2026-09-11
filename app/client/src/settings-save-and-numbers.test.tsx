/** Settings save feedback and retired-control regression coverage. */
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingsPage } from './SettingsPage';
import {
  SETTINGS_SAVE_IDLE,
  SETTINGS_UNREADABLE,
  changedSettingKeys,
  saveButtonLabel,
  saveInFlight,
  saveNotice,
  saveRetryAfterLoad,
} from './settings-save-state';

const PANEL = readFileSync(new URL('RuntimeSettingsPanel.tsx', import.meta.url), 'utf8');
const BENCHMARK = readFileSync(new URL('BenchmarkSettingsPanel.tsx', import.meta.url), 'utf8');

describe('retired Runtime controls', () => {
  it('removes numeric inputs with the retired Runtime controls', () => {
    // react-dom compares a number input's DOM value with the prop using loose
    // equality, so '0180' and 180 are treated as equal and the box is left
    // alone. A text input with a numeric keypad compares strictly.
    expect(PANEL).not.toContain('type="number"');
    expect(PANEL).not.toContain('inputMode="numeric"');
    // And the arithmetic that turned an empty box into zero is gone.
    expect(PANEL).not.toContain('Number(event.target.value)');
  });
});

describe('Save feedback', () => {
  it('says what it is doing on the button', () => {
    expect(saveButtonLabel(SETTINGS_SAVE_IDLE)).toBe('Save');
    expect(saveButtonLabel({ kind: 'saving' })).toBe('Saving...');
    expect(saveInFlight({ kind: 'saving' })).toBe(true);
    expect(saveInFlight(SETTINGS_SAVE_IDLE)).toBe(false);
  });

  it('confirms a success and surfaces the refusal the server sent', () => {
    expect(saveNotice(SETTINGS_SAVE_IDLE)).toBeNull();
    expect(saveNotice({ kind: 'saving' })).toBeNull();
    expect(saveNotice({ kind: 'saved', count: 3 })).toEqual({
      tone: 'ok',
      text: '3 changes saved',
    });
    expect(saveNotice({ kind: 'saved', count: 1 })?.text).toBe('1 change saved');
    expect(saveNotice({ kind: 'failed', message: 'The endpoint answered 503.' })).toEqual({
      tone: 'error',
      text: 'The endpoint answered 503.',
    });
  });

  it('reports its progress up to the footer instead of only to itself', () => {
    expect(PANEL).toContain('onSaveState');
    expect(PANEL).toContain("onSaveState({ kind: 'saving' })");
    expect(PANEL).toContain("onSaveState({ kind: 'saved', count: changed })");
    expect(PANEL).toContain("onSaveState({ kind: 'failed'");
  });

  it('counts changed setting keys once and removes reverted values', () => {
    const saved = { forecasting: false, answer: { takeaway: true, charts: true }, judges: ['a'] };
    expect(
      changedSettingKeys(saved, {
        forecasting: true,
        answer: { takeaway: false, charts: true },
        judges: ['a', 'b'],
      })
    ).toEqual(['forecasting', 'answer.takeaway', 'judges']);
    expect(changedSettingKeys(saved, { ...saved, forecasting: false })).toEqual([]);
  });

  it('uses the reload result after Save retries a failed load, not the stale failure', () => {
    // The defect: Save awaited load(), then read `failure`/`state` captured when
    // the click started. A successful retry still said there was nothing to save.
    expect(saveRetryAfterLoad({ ok: true })).toEqual(SETTINGS_SAVE_IDLE);
    expect(saveNotice(saveRetryAfterLoad({ ok: true }))).toBeNull();
    expect(saveRetryAfterLoad({ ok: false, message: 'The endpoint answered 503.' })).toEqual({
      kind: 'failed',
      message: 'The endpoint answered 503.',
    });
    expect(saveRetryAfterLoad({ ok: false, message: '  ' })).toEqual({
      kind: 'failed',
      message: SETTINGS_UNREADABLE,
    });
    for (const source of [PANEL, BENCHMARK]) {
      expect(source).toContain('const result = await load()');
      expect(source).toContain('onSaveState(saveRetryAfterLoad(result))');
      expect(source).not.toContain("state === 'failed'");
    }
  });

  it('draws the button in the footer, which does not scroll', () => {
    const markup = renderToStaticMarkup(<SettingsPage initialSection="identity" />);
    expect(markup).toContain('settings-modal-footer');
    expect(markup).toContain('>Save<');
    expect(markup).toContain('adapt-button-state');
    // Idle, so no outcome is claimed before anything has been pressed.
    expect(markup).not.toContain('settings-save-notice');
    expect(markup).not.toContain('Saved. The next ask uses these settings.');
  });
});
