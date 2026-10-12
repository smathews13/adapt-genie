/**
 * Slack connection, set once by an administrator.
 *
 * These are the per-environment values (Slack Team ID, the Databricks OAuth
 * client ID, the app and workspace addresses, the secret scope). They are stored
 * in the app's own database, so Deploy from Git never overwrites them and nobody
 * edits app.yaml. The four secrets stay in a Databricks secret scope and are
 * never typed into this screen.
 *
 * The server is authoritative: every write goes to an /api/admin route.
 */
import { Check, CircleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input } from './ui';
import { AdaptBusyButtonContent } from './AdaptLoadingAnimation';
import {
  SlackConnectionSchema,
  type SlackConnection,
  type SlackConnectionResponse,
} from '../../shared/slack-connection';
import {
  EMPTY_DRAFT,
  SAVED_CONFIRMATION_MS,
  draftFrom,
  fieldErrors,
  type Draft,
  type FieldKey,
} from './slack-connection-form';
import {
  loadSlackConnection,
  loadSlackSwitch,
  saveSlackConnection,
  saveSlackSwitch,
  type SlackSwitchDocument,
} from './slack-connection-api';

const REGISTRATION: Record<SlackConnection['environment'], string> = {
  test: 'adapt-slack-test',
  production: 'adapt-slack-production',
};

function Field({
  label,
  value,
  error,
  onChange,
  onBlur,
  disabled,
}: {
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  disabled: boolean;
}) {
  return (
    <label className="slack-connection-field">
      <span className="slack-connection-label">{label}</span>
      <Input
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      {error ? (
        <span className="slack-connection-field-error" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function SlackConnectionPanel() {
  const [loaded, setLoaded] = useState<SlackConnectionResponse | null>(null);
  const [switchDoc, setSwitchDoc] = useState<SlackSwitchDocument | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState<'save' | 'switch' | ''>('');
  const [saved, setSaved] = useState(false);
  const [restartNeeded, setRestartNeeded] = useState(false);
  const [failed, setFailed] = useState('');
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [attempted, setAttempted] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refresh = useCallback(async () => {
    const [connection, current] = await Promise.all([loadSlackConnection(), loadSlackSwitch().catch(() => null)]);
    setLoaded(connection);
    setSwitchDoc(current);
    setDraft(draftFrom(connection));
  }, []);

  useEffect(() => {
    let cancelled = false;
    refresh().catch((error: unknown) => {
      if (!cancelled) setFailed(error instanceof Error ? error.message : 'Slack settings could not be loaded.');
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  const update = (key: FieldKey) => (value: string) => {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const touch = (key: FieldKey) => () => setTouched((current) => ({ ...current, [key]: true }));
  const parsed = SlackConnectionSchema.safeParse(draft);
  const errors = fieldErrors(draft);
  const shown = (key: FieldKey) => (attempted || touched[key] ? errors[key] : undefined);
  const locked = busy !== '' || loaded?.managedByRelease === true;

  const save = async () => {
    setAttempted(true);
    setSaved(false);
    clearTimeout(savedTimer.current);
    if (!parsed.success) {
      setFailed('Fix the highlighted fields.');
      return;
    }
    setBusy('save');
    setFailed('');
    try {
      const next = await saveSlackConnection(parsed.data);
      setLoaded(next);
      setDraft(draftFrom(next));
      setRestartNeeded(next.requiresRestart);
      setSaved(true);
      savedTimer.current = setTimeout(() => setSaved(false), SAVED_CONFIRMATION_MS);
    } catch (error) {
      setFailed(error instanceof Error ? error.message : 'Not saved. Try again.');
    } finally {
      setBusy('');
    }
  };

  const isOn = Boolean(switchDoc?.settings.enabled && !switchDoc.settings.killSwitch);

  const toggle = async () => {
    if (!switchDoc) return;
    setBusy('switch');
    setFailed('');
    try {
      setSwitchDoc(
        await saveSlackSwitch(
          switchDoc.revision,
          !isOn,
          REGISTRATION[draft.environment as SlackConnection['environment']]
        )
      );
    } catch (error) {
      setFailed(error instanceof Error ? error.message : 'Could not change the Slack setting. Try again.');
    } finally {
      setBusy('');
    }
  };

  if (!loaded && !failed) return <p className="admin-list-note">Loading...</p>;

  const cannotTurnOn = !isOn && !loaded?.complete;
  return (
    <section className="slack-connection settings-table-frame" aria-labelledby="slack-connection-title">
      <div className="slack-connection-head">
        <h4 id="slack-connection-title">Slack connection</h4>
        {switchDoc ? (
          <span className="slack-status" data-state={isOn ? 'on' : 'off'} role="status">
            <span className="slack-status-dot" aria-hidden="true" />
            {isOn ? 'Slack on' : 'Slack off'}
          </span>
        ) : null}
      </div>
      {loaded?.managedByRelease ? <p className="admin-list-note">Set by the release. Read only.</p> : null}
      <Field
        label="Slack Team ID"
        value={draft.allowedTeamId}
        error={shown('allowedTeamId')}
        onChange={update('allowedTeamId')}
        onBlur={touch('allowedTeamId')}
        disabled={locked}
      />
      <Field
        label="Databricks workspace address"
        value={draft.databricksWorkspaceHost}
        error={shown('databricksWorkspaceHost')}
        onChange={update('databricksWorkspaceHost')}
        onBlur={touch('databricksWorkspaceHost')}
        disabled={locked}
      />
      <Field
        label="ADAPT app address"
        value={draft.publicBaseUrl}
        error={shown('publicBaseUrl')}
        onChange={update('publicBaseUrl')}
        onBlur={touch('publicBaseUrl')}
        disabled={locked}
      />
      <Field
        label="Databricks OAuth client ID"
        value={draft.oauthClientId}
        error={shown('oauthClientId')}
        onChange={update('oauthClientId')}
        onBlur={touch('oauthClientId')}
        disabled={locked}
      />
      <Field
        label="Secret scope"
        value={draft.secretScope}
        error={shown('secretScope')}
        onChange={update('secretScope')}
        onBlur={touch('secretScope')}
        disabled={locked}
      />
      <div className="slack-connection-actions">
        <Button
          type="button"
          className="slack-save-button"
          data-saved={saved ? 'true' : undefined}
          disabled={locked}
          onClick={() => void save()}
        >
          {saved ? (
            <span className="slack-save-done">
              <Check aria-hidden="true" />
              Saved
            </span>
          ) : (
            <AdaptBusyButtonContent busy={busy === 'save'} label="Save" busyLabel="Saving" />
          )}
        </Button>
        {switchDoc ? (
          <Button
            type="button"
            className="slack-switch-button"
            data-state={isOn ? 'on' : 'off'}
            disabled={busy !== '' || cannotTurnOn}
            title={cannotTurnOn ? 'Save the connection first.' : undefined}
            onClick={() => void toggle()}
          >
            <AdaptBusyButtonContent
              busy={busy === 'switch'}
              label={isOn ? 'Turn Slack off' : 'Turn Slack on'}
              busyLabel={isOn ? 'Turning off' : 'Turning on'}
            />
          </Button>
        ) : null}
      </div>
      <p className="slack-connection-live" role="status" aria-live="polite">
        {saved && restartNeeded ? 'Restart the app to apply.' : ''}
      </p>
      {failed ? (
        <p className="slack-connection-error" role="alert">
          <CircleAlert aria-hidden="true" />
          {failed}
        </p>
      ) : null}
    </section>
  );
}
