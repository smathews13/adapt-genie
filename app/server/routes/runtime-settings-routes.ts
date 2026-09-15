import { z } from 'zod';
import type { Request, Response } from 'express';
import { RuntimeSettingsPatchSchema } from '../../shared/runtime-settings';
import { ownsPreferenceDefaults } from '../../shared/preference-default-owner';
import { recordAdminAction } from '../lib/admin-roles';
import {
  deleteUserRuntimeSettings,
  deleteRuntimeSettingsDefaults,
  readResolvedRuntimeSettings,
  writeRuntimeSettingsPatch,
  writeUserRuntimeSettingsPatch,
} from '../lib/runtime-settings-store';
import {
  deleteUserWatchlistSettings,
  deleteWatchlistSettingsDefaults,
} from '../lib/watchlist-settings-store';
import { SettingsRevisionConflict } from '../lib/versioned-settings-store';
import { userEmail, type InsightsAppKit } from './insights-routes';

const RuntimeSettingsWrite = z.strictObject({
  revision: z.number().int().nonnegative(),
  patch: RuntimeSettingsPatchSchema,
});

export function setupRuntimeSettingsRoutes(appkit: InsightsAppKit): void {
  appkit.server.extend((app) => {
    app.get('/api/runtime-settings', async (req, res) => {
      try {
        res.json(await readResolvedRuntimeSettings(appkit, userEmail(req)));
      } catch (error) {
        res.status(503).json({
          error: 'runtime_settings_store_unavailable',
          detail: `Runtime settings could not be read from Lakebase: ${(error as Error).message}`,
        });
      }
    });

    const save = async (req: Request, res: Response) => {
      const parsed = RuntimeSettingsWrite.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_runtime_settings', detail: parsed.error.message });
        return;
      }
      const actor = userEmail(req);
      if (!actor) {
        res.status(401).json({ error: 'identity_unavailable', detail: 'A signed-in user is required.' });
        return;
      }
      try {
        const document = ownsPreferenceDefaults(actor)
          ? await writeRuntimeSettingsPatch(appkit, parsed.data.patch, parsed.data.revision, actor).then((value) => ({
              ...value,
              source: 'default' as const,
              canReset: false,
            }))
          : await writeUserRuntimeSettingsPatch(appkit, actor, parsed.data.patch, parsed.data.revision);
        if (ownsPreferenceDefaults(actor)) {
          await recordAdminAction(appkit.lakebase, {
            actor,
            action: 'runtime-settings-updated',
            subject: 'runtime-settings',
            detail: 'Updated the deployment default runtime and appearance settings.',
          }).catch((error) =>
            console.warn('[runtime-settings] Saved settings, but could not write the admin audit row:', error)
          );
        }
        res.json({ ...document, appliesNow: true });
      } catch (error) {
        const conflict = error instanceof SettingsRevisionConflict;
        res.status(conflict ? 409 : 503).json({
          error: conflict ? 'runtime_settings_conflict' : 'runtime_settings_store_unavailable',
          detail: conflict ? error.message : `The settings were not saved: ${(error as Error).message}`,
        });
      }
    };
    app.put('/api/runtime-settings', save);
    app.put('/api/admin/runtime-settings', save);
    app.delete('/api/runtime-settings', async (req, res) => {
      const actor = userEmail(req);
      if (!actor) {
        res.status(401).json({ error: 'identity_unavailable', detail: 'A signed-in user is required.' });
        return;
      }
      if (ownsPreferenceDefaults(actor)) {
        res.status(409).json({ error: 'default_owner_cannot_reset', detail: 'Rida’s settings are the default.' });
        return;
      }
      try {
        res.json({ ...(await deleteUserRuntimeSettings(appkit, actor)), appliesNow: true });
      } catch (error) {
        res.status(503).json({
          error: 'runtime_settings_store_unavailable',
          detail: `The override was not reset: ${(error as Error).message}`,
        });
      }
    });
    app.post('/api/preferences/reset', async (req, res) => {
      const actor = userEmail(req);
      if (!actor) {
        res.status(401).json({ error: 'identity_unavailable', detail: 'A signed-in user is required.' });
        return;
      }
      try {
        const [runtime, watchlist] = ownsPreferenceDefaults(actor)
          ? await Promise.all([
              deleteRuntimeSettingsDefaults(appkit),
              deleteWatchlistSettingsDefaults(appkit),
            ])
          : await Promise.all([
              deleteUserRuntimeSettings(appkit, actor),
              deleteUserWatchlistSettings(appkit, actor),
            ]);
        res.json({ runtime, watchlist });
      } catch (error) {
        res.status(503).json({
          error: 'preference_reset_failed',
          detail: `Settings were not reset: ${(error as Error).message}`,
        });
      }
    });
  });
}
