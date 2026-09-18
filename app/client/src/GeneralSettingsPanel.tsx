import { useState } from 'react';

import { AdaptBusyButtonContent } from './AdaptLoadingAnimation';
import { Button } from './ui';

export function ResetPreferencesButton() {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [message, setMessage] = useState('');

  const reset = async () => {
    setState('saving');
    setMessage('');
    try {
      const response = await fetch('/api/preferences/reset', { method: 'POST' });
      const body = (await response.json().catch(() => ({}))) as { detail?: string };
      if (!response.ok) throw new Error(body.detail || `Settings reset answered ${response.status}.`);
      setState('saved');
      setMessage('Default settings restored. Reloading…');
      window.setTimeout(() => window.location.reload(), 250);
    } catch (error) {
      setState('failed');
      setMessage((error as Error).message);
    }
  };

  return (
    <div className="settings-reset-preferences">
      <Button type="button" variant="outline" disabled={state === 'saving'} onClick={() => void reset()}>
        <AdaptBusyButtonContent
          busy={state === 'saving'}
          label="Reset to default settings"
          busyLabel="Resetting settings"
        />
      </Button>
      {message ? (
        <p className={`settings-reset-status${state === 'failed' ? ' settings-error' : ''}`} role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
