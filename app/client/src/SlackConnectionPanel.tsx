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
import { useCallback, useEffect, useState } from 'react';
import { Button, Input } from './ui';
import { AdaptBusyButtonContent } from './AdaptLoadingAnimation';
import {
  SlackConnectionSchema,
  type SlackConnection,
  type SlackConnectionResponse,
} from '../../shared/slack-connection';
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

type Draft = Record<keyof SlackConnection, string>;

const EMPTY_DRAFT: Draft = {
  environment: 'test',
  allowedTeamId: '',
  databricksWorkspaceHost: '',
  publicBaseUrl: '',
  oauthClientId: '',
  secretScope: 'adapt-app',
};

function draftFrom(response: SlackConnectionResponse): Draft {
  const saved = response.connection ?? {};
  return {
    environment: saved.environment ?? EMPTY_DRAFT.environment,
    allowedTeamId: saved.allowedTeamId ?? '',
    databricksWorkspaceHost: saved.databricksWorkspaceHost ?? response.suggested.databricksWorkspaceHost,
    publicBaseUrl: saved.publicBaseUrl ?? response.suggested.publicBaseUrl,
    oauthClientId: saved.oauthClientId ?? '',
    secretScope: saved.secretScope ?? EMPTY_DRAFT.secretScope,
  };
}

function Field({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="slack-connection-field">
      <span className="slack-connection-label">{label}</span>
      <Input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
      <span className="admin-list-note">{hint}</span>
    </label>
  );
}

export function SlackConnectionPanel() {
  const [loaded, setLoaded] = useState<SlackConnectionResponse | null>(null);
  const [switchDoc, setSwitchDoc] = useState<SlackSwitchDocument | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState('');

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

  const update = (key: keyof Draft) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const parsed = SlackConnectionSchema.safeParse(draft);
  const locked = busy || loaded?.managedByRelease === true;

  const save = async () => {
    if (!parsed.success) {
      setFailed(parsed.error.issues.map((issue) => issue.message).join(' '));
      return;
    }
    setBusy(true);
    setFailed('');
    setMessage('');
    try {
      const next = await saveSlackConnection(parsed.data);
      setLoaded(next);
      setDraft(draftFrom(next));
      setMessage(
        next.requiresRestart
          ? 'Saved. Restart the app from its Databricks page to apply these values.'
          : 'Saved. These values are already in use.'
      );
    } catch (error) {
      setFailed(error instanceof Error ? error.message : 'Slack connection values were not saved.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (on: boolean) => {
    if (!switchDoc) return;
    setBusy(true);
    setFailed('');
    setMessage('');
    try {
      setSwitchDoc(
        await saveSlackSwitch(switchDoc.revision, on, REGISTRATION[draft.environment as SlackConnection['environment']])
      );
      setMessage(on ? 'Slack is on.' : 'Slack is off.');
    } catch (error) {
      setFailed(error instanceof Error ? error.message : 'The Slack on/off setting was not saved.');
    } finally {
      setBusy(false);
    }
  };

  if (!loaded && !failed) return <p className="admin-list-note">Loading Slack connection...</p>;

  const scope = draft.secretScope || '<secret scope>';
  return (
    <section className="slack-connection settings-table-frame" aria-labelledby="slack-connection-title">
      <h4 id="slack-connection-title">Slack connection</h4>
      {loaded?.managedByRelease ? (
        <p className="admin-list-note">
          This deployment takes its Slack values from its bundle release, so they are shown here but cannot be edited.
        </p>
      ) : null}
      <Field
        label="Slack Team ID"
        hint="Starts with T. In Slack, open the workspace menu, then About this workspace."
        value={draft.allowedTeamId}
        onChange={update('allowedTeamId')}
        disabled={locked}
      />
      <Field
        label="Databricks workspace address"
        hint="For example https://your-workspace.cloud.databricks.com"
        value={draft.databricksWorkspaceHost}
        onChange={update('databricksWorkspaceHost')}
        disabled={locked}
      />
      <Field
        label="ADAPT app address"
        hint="The address people use to open ADAPT."
        value={draft.publicBaseUrl}
        onChange={update('publicBaseUrl')}
        disabled={locked}
      />
      <Field
        label="Databricks OAuth client ID"
        hint={`From the custom OAuth app you created. Its redirect URL must be ${
          loaded?.suggested.callbackUrl || '<ADAPT app address>/api/slack/oauth/callback'
        }`}
        value={draft.oauthClientId}
        onChange={update('oauthClientId')}
        disabled={locked}
      />
      <Field
        label="Secret scope"
        hint={`Holds these four secrets: ${Object.values(loaded?.secrets.keys ?? {}).join(', ')}. Give this app read access to the scope: databricks secrets put-acl ${scope} <app service principal> READ`}
        value={draft.secretScope}
        onChange={update('secretScope')}
        disabled={locked}
      />
      <div className="slack-connection-actions">
        <Button type="button" disabled={locked || !parsed.success} onClick={() => void save()}>
          <AdaptBusyButtonContent busy={busy} label="Save Slack connection" busyLabel="Saving" />
        </Button>
        {switchDoc ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy || (!switchDoc.settings.enabled && !loaded?.complete)}
            onClick={() => void toggle(!(switchDoc.settings.enabled && !switchDoc.settings.killSwitch))}
          >
            {switchDoc.settings.enabled && !switchDoc.settings.killSwitch ? 'Turn Slack off' : 'Turn Slack on'}
          </Button>
        ) : null}
      </div>
      {message ? (
        <p className="settings-status" role="status">
          {message}
        </p>
      ) : null}
      {failed ? (
        <p className="settings-status settings-error" role="alert">
          {failed}
        </p>
      ) : null}
    </section>
  );
}
