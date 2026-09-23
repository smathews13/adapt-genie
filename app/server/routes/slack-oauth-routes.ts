import { z } from 'zod';
import type { Application, Request, Response } from 'express';
import { userEmail, type InsightsAppKit } from './insights-routes';
import { readSlackInstallationScope, readSlackRuntimeConfig, type SlackInstallationScope } from '../slack/config';
import {
  beginSlackOAuth,
  completeSlackOAuth,
  type SlackOAuthBlockedReason,
  type SlackOAuthDependencies,
} from '../slack/oauth-service';

const StartQuery = z.strictObject({ state: z.string().trim().min(32).max(512) });
const CallbackQuery = z.strictObject({
  state: z.string().trim().min(32).max(512),
  code: z.string().trim().min(1).max(4096),
});
const EmptyBody = z.strictObject({});

function query(req: Request): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(req.query).flatMap(([key, value]) => (typeof value === 'string' ? [[key, value]] : []))
  );
}

function blocked(res: Response, reason: SlackOAuthBlockedReason): void {
  const unavailable = reason === 'broker_unavailable' || reason === 'store_unavailable' || reason === 'config_invalid';
  res.status(unavailable ? 503 : 400).json({
    error: reason,
    detail: 'Slack identity linking is unavailable or the one-time request was refused.',
  });
}

function actor(req: Request, res: Response): string | null {
  try {
    return userEmail(req);
  } catch {
    res.status(401).json({ error: 'identity_unavailable', detail: 'A signed-in user is required.' });
    return null;
  }
}

export function setupSlackOAuthRoutes(
  appkit: InsightsAppKit,
  dependencies: SlackOAuthDependencies & {
    readConfig?: typeof readSlackRuntimeConfig;
    readInstallationScope?: () => SlackInstallationScope | null;
  } = {}
): void {
  appkit.server.extend((app: Application) => {
    app.get('/api/slack/link', async (req: Request, res: Response) => {
      const parsed = StartQuery.safeParse(query(req));
      if (!parsed.success) {
        res.status(400).json({ error: 'link_out_unavailable', detail: 'An opaque one-time state is required.' });
        return;
      }
      const configured = (dependencies.readConfig ?? readSlackRuntimeConfig)();
      if (!configured.ready) return blocked(res, 'config_invalid');
      const result = await beginSlackOAuth(parsed.data.state, configured.config, dependencies);
      if (!result.ok) return blocked(res, result.reason);
      res.redirect(302, result.redirect);
    });

    app.get('/api/slack/oauth/callback', async (req: Request, res: Response) => {
      const parsed = CallbackQuery.safeParse(query(req));
      if (!parsed.success) {
        res.status(400).json({ error: 'link_out_unavailable', detail: 'The OAuth callback was incomplete.' });
        return;
      }
      const configured = (dependencies.readConfig ?? readSlackRuntimeConfig)();
      if (!configured.ready) return blocked(res, 'config_invalid');
      const result = await completeSlackOAuth(parsed.data, configured.config, dependencies);
      if (!result.ok) return blocked(res, result.reason);
      res.redirect(303, new URL('/settings?slack=linked', configured.config.publicBaseUrl).toString());
    });

    app.get('/api/slack/link/status', async (req: Request, res: Response) => {
      const currentActor = actor(req, res);
      if (!currentActor) return;
      if (!dependencies.linkWriter || !dependencies.linkReferenceForActor) {
        return blocked(res, 'broker_unavailable');
      }
      const linkReference = await dependencies.linkReferenceForActor(currentActor).catch(() => null);
      if (!linkReference) {
        res.json({ status: 'unlinked' });
        return;
      }
      res.json({ status: await dependencies.linkWriter.status({ actor: currentActor, linkReference }) });
    });

    app.post('/api/slack/link/revoke', async (req: Request, res: Response) => {
      if (!EmptyBody.safeParse(req.body ?? {}).success) {
        res
          .status(400)
          .json({ error: 'invalid_request', detail: 'Identity and authorization fields are not accepted.' });
        return;
      }
      const currentActor = actor(req, res);
      if (!currentActor) return;
      if (!dependencies.linkWriter || !dependencies.linkReferenceForActor) {
        return blocked(res, 'broker_unavailable');
      }
      const linkReference = await dependencies.linkReferenceForActor(currentActor).catch(() => null);
      if (!linkReference) {
        res.json({ status: 'not_linked' });
        return;
      }
      res.json({
        status: await dependencies.linkWriter.revoke({ actor: currentActor, linkReference }),
      });
    });

    app.post('/api/admin/slack/uninstall', async (req: Request, res: Response) => {
      if (!EmptyBody.safeParse(req.body ?? {}).success) {
        res.status(400).json({ error: 'invalid_request', detail: 'Installation identifiers are not accepted.' });
        return;
      }
      if (!dependencies.linkWriter) return blocked(res, 'broker_unavailable');
      const installationScope = (dependencies.readInstallationScope ?? readSlackInstallationScope)();
      if (!installationScope) return blocked(res, 'config_invalid');
      res.json({ status: await dependencies.linkWriter.uninstall(installationScope) });
    });
  });
}
