import { z } from 'zod';
import {
  DEFAULT_SLACK_SECRET_KEYS,
  SLACK_OAUTH_CALLBACK_PATH,
  SlackConnectionSchema,
  type SlackConnectionResponse,
} from '../../shared/slack-connection';
import { SlackOperationalSettingsPatchSchema } from '../../shared/slack-settings';
import { recordAdminAction } from '../lib/admin-roles';
import { decisionSource } from '../lib/deployment-decisions';
import {
  readStoredSlackSnapshot,
  slackConnectionDraftFromEnv,
  slackConnectionEnv,
  slackConnectionFromEnv,
  writeSlackConnection,
} from '../slack/connection-settings';
import { readSlackSettings, writeSlackSettings } from '../slack/settings-store';
import { SettingsRevisionConflict } from '../lib/versioned-settings-store';
import { userEmail, type InsightsAppKit } from './insights-routes';

const SlackSettingsWrite = z.strictObject({
  revision: z.number().int().nonnegative(),
  patch: SlackOperationalSettingsPatchSchema,
});

function appOrigin(value: string | undefined): string {
  try {
    return value ? new URL(value.startsWith('http') ? value : `https://${value}`).origin : '';
  } catch {
    return '';
  }
}

async function connectionResponse(appkit: InsightsAppKit): Promise<SlackConnectionResponse> {
  const stored = await readStoredSlackSnapshot(appkit.lakebase);
  const storedConnection = slackConnectionFromEnv(stored);
  const running = slackConnectionDraftFromEnv(process.env);
  const effective = storedConnection ?? running;
  const publicBaseUrl = appOrigin(process.env.DATABRICKS_APP_URL);
  const host = appOrigin(process.env.DATABRICKS_HOST);
  const pending = storedConnection
    ? Object.entries(slackConnectionEnv(storedConnection)).some(
        ([key, value]) => (process.env[key]?.trim() ?? '') !== value
      )
    : false;
  return {
    connection: Object.keys(effective).length > 0 ? effective : null,
    complete: slackConnectionFromEnv(process.env) !== null || storedConnection !== null,
    managedByRelease: decisionSource(process.env) === 'release',
    suggested: {
      publicBaseUrl,
      databricksWorkspaceHost: host,
      callbackUrl: publicBaseUrl ? new URL(SLACK_OAUTH_CALLBACK_PATH, publicBaseUrl).toString() : '',
    },
    secrets: { scope: effective.secretScope ?? null, keys: DEFAULT_SLACK_SECRET_KEYS },
    requiresRestart: pending,
  };
}

export function setupSlackSettingsRoutes(appkit: InsightsAppKit): void {
  appkit.server.extend((app) => {
    app.get('/api/admin/slack/connection', async (_req, res) => {
      try {
        res.json(await connectionResponse(appkit));
      } catch {
        res.status(503).json({
          error: 'slack_connection_unavailable',
          detail: 'Slack connection values could not be read; Slack remains disabled.',
        });
      }
    });

    app.put('/api/admin/slack/connection', async (req, res) => {
      if (decisionSource(process.env) === 'release') {
        res.status(409).json({
          error: 'slack_connection_managed_by_release',
          detail: 'This deployment takes its Slack values from its bundle release, so they are not editable here.',
        });
        return;
      }
      const parsed = SlackConnectionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'invalid_slack_connection',
          detail: parsed.error.issues.map((issue) => issue.message).join(' '),
        });
        return;
      }
      const actor = userEmail(req);
      if (!actor) {
        res.status(401).json({ error: 'identity_unavailable', detail: 'A signed-in admin is required.' });
        return;
      }
      const saved = await writeSlackConnection(appkit.lakebase, parsed.data, actor);
      if (!saved) {
        res.status(503).json({
          error: 'slack_connection_unavailable',
          detail: 'Slack connection values were not saved; Slack remains disabled.',
        });
        return;
      }
      await recordAdminAction(appkit.lakebase, {
        actor,
        action: 'slack-connection-updated',
        subject: 'slack-connection',
        detail: 'Slack connection values were saved. Secrets are never stored here.',
      });
      res.json(await connectionResponse(appkit));
    });

    app.get('/api/admin/slack/settings', async (_req, res) => {
      try {
        res.json(await readSlackSettings(appkit));
      } catch {
        res.status(503).json({
          error: 'slack_settings_unavailable',
          detail: 'Slack remains disabled because its settings store could not be read.',
        });
      }
    });

    app.put('/api/admin/slack/settings', async (req, res) => {
      const parsed = SlackSettingsWrite.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_slack_settings', detail: parsed.error.message });
        return;
      }
      const actor = userEmail(req);
      if (!actor) {
        res.status(401).json({ error: 'identity_unavailable', detail: 'A signed-in admin is required.' });
        return;
      }
      try {
        const document = await writeSlackSettings(appkit, parsed.data.patch, parsed.data.revision, actor);
        await recordAdminAction(appkit.lakebase, {
          actor,
          action: 'slack-settings-updated',
          subject: 'slack-settings',
          detail: `Slack adapter settings revision ${document.revision} was saved.`,
        });
        res.json(document);
      } catch (error) {
        const conflict = error instanceof SettingsRevisionConflict;
        res.status(conflict ? 409 : 503).json({
          error: conflict ? 'slack_settings_conflict' : 'slack_settings_unavailable',
          detail: conflict ? error.message : 'Slack settings were not saved; Slack remains disabled.',
        });
      }
    });
  });
}
