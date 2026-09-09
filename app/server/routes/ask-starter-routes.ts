import { z } from 'zod';
import { AskStarterSettingsPatchSchema } from '../../shared/ask-starters';
import { recordAdminAction } from '../lib/admin-roles';
import { readAskStarterSettings, writeAskStarterSettings } from '../lib/ask-starter-settings-store';
import { SettingsRevisionConflict } from '../lib/versioned-settings-store';
import { userEmail, type InsightsAppKit } from './insights-routes';

const AskStarterWrite = z.strictObject({
  revision: z.number().int().nonnegative(),
  patch: AskStarterSettingsPatchSchema,
});

export function setupAskStarterRoutes(appkit: InsightsAppKit): void {
  appkit.server.extend((app) => {
    app.get('/api/ask-starters', async (_req, res) => {
      try {
        res.json(await readAskStarterSettings(appkit));
      } catch (error) {
        res.status(503).json({
          error: 'ask_starters_unavailable',
          detail: `Starter questions could not be read from Lakebase: ${(error as Error).message}`,
        });
      }
    });

    app.put('/api/admin/ask-starters', async (req, res) => {
      const parsed = AskStarterWrite.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_ask_starters', detail: parsed.error.message });
        return;
      }
      let document: Awaited<ReturnType<typeof writeAskStarterSettings>>;
      try {
        document = await writeAskStarterSettings(appkit, parsed.data.patch, parsed.data.revision, userEmail(req));
      } catch (error) {
        const conflict = error instanceof SettingsRevisionConflict;
        res.status(conflict ? 409 : 503).json({
          error: conflict ? 'ask_starters_conflict' : 'ask_starters_unavailable',
          detail: conflict ? error.message : `Starter questions were not saved: ${(error as Error).message}`,
        });
        return;
      }
      try {
        await recordAdminAction(appkit.lakebase, {
          actor: userEmail(req),
          action: 'ask-starters-updated',
          subject: 'ask-starters',
          detail: `Configured ${document.settings.questions.length} starter questions.`,
        });
      } catch (error) {
        console.warn('[ask-starters] Saved settings, but could not write the admin audit row:', error);
      }
      res.json(document);
    });
  });
}
