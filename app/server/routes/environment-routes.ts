import type { InsightsAppKit } from './insights-routes';
import { readEnvironmentInfo } from '../lib/environment-info';
import { readControlPlaneIdentityMetadata } from '../lib/control-plane-identity';

export function setupEnvironmentRoutes(appkit: InsightsAppKit) {
  appkit.server.extend((app) => {
    app.get('/api/environment', async (_req, res) => {
      try {
        const [environment, identity] = await Promise.all([
          readEnvironmentInfo(),
          readControlPlaneIdentityMetadata({ email: '' }),
        ]);
        res.json({
          ...environment,
          appServicePrincipal: {
            displayName: identity.servicePrincipal.displayName,
            applicationId: identity.servicePrincipal.applicationId || process.env.DATABRICKS_CLIENT_ID?.trim() || '',
            objectId: identity.servicePrincipal.objectId,
            workspaceHost: identity.app.workspaceHost,
          },
        });
      } catch (error) {
        console.error('[environment] Runtime details could not be read:', (error as Error).message);
        res.status(503).json({
          error: 'environment_unavailable',
          detail: 'Runtime details are not available just now.',
        });
      }
    });
  });
}
