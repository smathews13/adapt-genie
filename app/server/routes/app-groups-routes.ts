import { z } from 'zod';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { AppGroupsPatchSchema } from '../../shared/app-groups';
import { recordAdminAction } from '../lib/admin-roles';
import { readAppGroupsSettings, writeAppGroupsSettings } from '../lib/app-groups-store';
import { SettingsRevisionConflict } from '../lib/versioned-settings-store';
import { userEmail, type InsightsAppKit } from './insights-routes';

/**
 * Read and write the deployment's app groups.
 *
 * WHO MAY CALL THESE. Both endpoints live under `/api/admin`, which the admin
 * guard in lib/admin-roles.ts covers, so an administrator or super administrator
 * reaches them and a consumer is refused with 403 by that one middleware. There
 * is deliberately no per-handler role check here: the guard is the permission
 * model, and a second copy would be a second thing to keep in step. The
 * requirement is "admins and super admins can add users to app groups", and that
 * is exactly the admin surface.
 *
 * The read stays open to every administrator, not only the ones who edit,
 * because Monitoring needs the group list to offer the filter.
 */

const AppGroupsWrite = z.strictObject({
  revision: z.number().int().nonnegative(),
  patch: AppGroupsPatchSchema,
});

export function setupAppGroupsRoutes(appkit: InsightsAppKit): void {
  appkit.server.extend((app) => {
    app.get('/api/admin/app-groups', async (_req, res) => {
      try {
        res.json(await readAppGroupsSettings(appkit));
      } catch (error) {
        res.status(503).json({
          error: 'app_groups_unavailable',
          detail: `App groups could not be read from Lakebase: ${(error as Error).message}`,
        });
      }
    });

    const save = async (req: ExpressRequest, res: ExpressResponse) => {
      const parsed = AppGroupsWrite.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_app_groups', detail: parsed.error.message });
        return;
      }
      const actor = userEmail(req);
      if (!actor) {
        res.status(401).json({ error: 'identity_unavailable', detail: 'A signed-in user is required.' });
        return;
      }
      try {
        const document = await writeAppGroupsSettings(appkit, parsed.data.patch, parsed.data.revision, actor);
        await recordAdminAction(appkit.lakebase, {
          actor,
          action: 'app-groups-updated',
          subject: 'app-groups',
          detail: `Configured ${document.settings.groups.length} app ${
            document.settings.groups.length === 1 ? 'group' : 'groups'
          }.`,
        }).catch((error) =>
          console.warn('[app-groups] Saved settings, but could not write the admin audit row:', error)
        );
        res.json(document);
      } catch (error) {
        const conflict = error instanceof SettingsRevisionConflict;
        res.status(conflict ? 409 : 503).json({
          error: conflict ? 'app_groups_conflict' : 'app_groups_unavailable',
          detail: conflict ? error.message : `The app groups were not saved: ${(error as Error).message}`,
        });
      }
    };
    app.put('/api/admin/app-groups', save);
  });
}
