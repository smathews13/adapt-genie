import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { askStarterSettingsFromResponse } from './ask-starters-api';
import { ASK_STARTERS_MAX } from '../../shared/ask-starters-browser';

const PANEL_SOURCE = readFileSync(new URL('./AskStartersSettingsPanel.tsx', import.meta.url), 'utf8');

describe('starter question settings response', () => {
  it('preserves the configured card order', async () => {
    const document = await askStarterSettingsFromResponse(
      new Response(
        JSON.stringify({
          settings: {
            questions: [
              { id: 'second', kicker: 'Second', question: 'What came second?' },
              { id: 'first', kicker: 'First', question: 'What came first?' },
            ],
          },
          revision: 4,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    expect(document.settings.questions.map(({ id }) => id)).toEqual(['second', 'first']);
    expect(document.revision).toBe(4);
  });

  it('rejects oversized or incomplete settings documents', async () => {
    const questions = Array.from({ length: ASK_STARTERS_MAX + 1 }, (_, index) => ({
      id: String(index),
      kicker: 'Label',
      question: 'Question?',
    }));
    await expect(
      askStarterSettingsFromResponse(
        new Response(JSON.stringify({ settings: { questions }, revision: 1 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    ).rejects.toThrow('incomplete starter question settings');
  });

  it('rejects an empty list so the landing page always has a starter', async () => {
    await expect(
      askStarterSettingsFromResponse(
        new Response(JSON.stringify({ settings: { questions: [] }, revision: 1 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    ).rejects.toThrow('incomplete starter question settings');
  });

  it('keeps failed loads out of the editor and offers a nondestructive retry', () => {
    expect(PANEL_SOURCE).toContain('{saved ? (');
    expect(PANEL_SOURCE).toContain('!saved ? (');
    expect(PANEL_SOURCE).toContain('if (event.key ===');
    expect(PANEL_SOURCE).toContain('event.preventDefault()');
    expect(PANEL_SOURCE).toContain("disabled={questions.length === 1 || state === 'saving'}");
  });
});
