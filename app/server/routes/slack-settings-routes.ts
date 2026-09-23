import { z } from 'zod';
import { SlackOperationalSettingsPatchSchema } from '../../shared/slack-settings';
import { recordAdminAction } from '../lib/admin-roles';
import { readSlackSettings, writeSlackSettings } from '../slack/settings-store';
import { SettingsRevisionConflict } from '../lib/versioned-settings-store';
import { userEmail, type InsightsAppKit } from './insights-routes';

const SlackSettingsWrite = z.strictObject({
  revision: z.number().int().nonnegative(),
  patch: SlackOperationalSettingsPatchSchema,
});

export function setupSlackSettingsRoutes(appkit: InsightsAppKit): void {
  appkit.server.extend((app) => {
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
