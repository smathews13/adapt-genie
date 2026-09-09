import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { ASK_STARTERS_MAX, type AskStarter } from '../../shared/ask-starters-browser';
import { askStarterSettingsFromResponse, notifyAskStartersChanged } from './ask-starters-api';
import type { SettingsSaveState } from './settings-save-state';
import { Button, Input } from './ui';

export const ASK_STARTERS_SETTINGS_FORM_ID = 'settings-ask-starters-form';

function newStarter(): AskStarter {
  return {
    id: globalThis.crypto.randomUUID(),
    kicker: 'New',
    question: 'Enter a starter question',
  };
}

export function AskStartersSettingsPanel({
  onSaveState,
  onDirtyChange,
}: {
  onSaveState: (state: SettingsSaveState) => void;
  onDirtyChange: (count: number) => void;
}) {
  const [questions, setQuestions] = useState<AskStarter[]>([]);
  const [saved, setSaved] = useState<AskStarter[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'failed'>('loading');
  const [failure, setFailure] = useState('');
  const revision = useRef(0);

  const load = useCallback(async () => {
    setState('loading');
    setFailure('');
    try {
      const document = await fetch('/api/ask-starters').then(askStarterSettingsFromResponse);
      setQuestions(document.settings.questions);
      setSaved(document.settings.questions);
      revision.current = document.revision;
      setState('ready');
    } catch (error) {
      setFailure((error as Error).message);
      setState('failed');
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetch('/api/ask-starters')
      .then(askStarterSettingsFromResponse)
      .then((document) => {
        if (!active) return;
        setQuestions(document.settings.questions);
        setSaved(document.settings.questions);
        revision.current = document.revision;
        setState('ready');
      })
      .catch((error: Error) => {
        if (!active) return;
        setFailure(error.message);
        setState('failed');
      });
    return () => {
      active = false;
    };
  }, []);

  const changed = saved && JSON.stringify(saved) !== JSON.stringify(questions) ? 1 : 0;
  useEffect(() => onDirtyChange(changed), [changed, onDirtyChange]);

  function update(index: number, patch: Partial<AskStarter>) {
    setQuestions((current) =>
      current.map((question, position) => (position === index ? { ...question, ...patch } : question))
    );
    onSaveState({ kind: 'idle' });
  }

  function move(index: number, offset: -1 | 1) {
    setQuestions((current) => {
      const destination = index + offset;
      if (destination < 0 || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
    onSaveState({ kind: 'idle' });
  }

  async function saveSettings() {
    if (!saved) {
      await load();
      return;
    }
    setState('saving');
    setFailure('');
    onSaveState({ kind: 'saving' });
    try {
      const response = await fetch('/api/admin/ask-starters', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revision: revision.current, patch: { questions } }),
      });
      const document = await askStarterSettingsFromResponse(response);
      setQuestions(document.settings.questions);
      setSaved(document.settings.questions);
      revision.current = document.revision;
      notifyAskStartersChanged(document.settings);
      setState('ready');
      onDirtyChange(0);
      onSaveState({ kind: 'saved', count: changed });
    } catch (error) {
      setFailure((error as Error).message);
      setState('failed');
      onSaveState({ kind: 'failed', message: (error as Error).message });
    }
  }

  return (
    <form
      id={ASK_STARTERS_SETTINGS_FORM_ID}
      className="settings-pane ask-starters-settings"
      onSubmit={(event) => {
        event.preventDefault();
        void saveSettings();
      }}
    >
      <div className="settings-pane-heading">
        <h3>Starter questions</h3>
        <p>Configure the question cards everyone sees when they open an empty Ask conversation.</p>
      </div>
      {state === 'loading' ? <p className="settings-status">Loading starter questions…</p> : null}
      {saved ? (
        <>
          <div className="ask-starters-settings-list">
            {questions.map((starter, index) => (
              <div className="ask-starters-settings-row" key={starter.id}>
                <span className="ask-starters-settings-order ast-num">{index + 1}</span>
                <label>
                  <span>Label</span>
                  <Input
                    value={starter.kicker}
                    maxLength={40}
                    disabled={state === 'saving'}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.preventDefault();
                    }}
                    onChange={(event) => update(index, { kicker: event.target.value })}
                  />
                </label>
                <label>
                  <span>Question</span>
                  <Input
                    value={starter.question}
                    maxLength={300}
                    disabled={state === 'saving'}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.preventDefault();
                    }}
                    onChange={(event) => update(index, { question: event.target.value })}
                  />
                </label>
                <div className="ask-starters-settings-actions">
                  <button
                    type="button"
                    disabled={index === 0 || state === 'saving'}
                    onClick={() => move(index, -1)}
                    aria-label={`Move ${starter.kicker} up`}
                  >
                    <ArrowUp aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    disabled={index === questions.length - 1 || state === 'saving'}
                    onClick={() => move(index, 1)}
                    aria-label={`Move ${starter.kicker} down`}
                  >
                    <ArrowDown aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    disabled={questions.length === 1 || state === 'saving'}
                    onClick={() => {
                      setQuestions((current) => current.filter((_, position) => position !== index));
                      onSaveState({ kind: 'idle' });
                    }}
                    aria-label={`Remove ${starter.kicker}`}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            type="button"
            disabled={questions.length >= ASK_STARTERS_MAX || state === 'saving'}
            onClick={() => {
              setQuestions((current) => [...current, newStarter()]);
              onSaveState({ kind: 'idle' });
            }}
          >
            <Plus aria-hidden="true" /> Add starter question
          </Button>
          <p className="settings-status">
            {questions.length} of {ASK_STARTERS_MAX} starter questions configured.
          </p>
        </>
      ) : null}
      {failure ? (
        <>
          <p className="settings-status settings-error" role="alert">
            {failure}
          </p>
          {!saved ? (
            <Button variant="outline" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </>
      ) : null}
    </form>
  );
}
