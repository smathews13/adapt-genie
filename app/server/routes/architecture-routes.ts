/**
 * What the app can say about its own shape without asking anything expensive.
 *
 * THIS ROUTE DELIBERATELY PROBES NOTHING. The Architecture page needs
 * `/api/settings` for the wiring list and `/api/preflight` for endpoint
 * metadata. Neither of those asks the live agent a question: settings reads
 * this release's configuration, and preflight is a metadata GET. The
 * reachability probes (Unity Catalog, as the signed-in user) are behind an
 * explicit Refresh on Connections, so opening a diagram does not fire them.
 *
 * The consequence is stated rather than hidden. Every connection starts as
 * `not checked`, which is a real status in `connection-status.ts` and not a
 * placeholder, and the page says a check has not run rather than implying one
 * passed.
 *
 * NOTHING HERE IS A LITERAL. Host, endpoint name, warehouse id, experiment id
 * and the Lakebase endpoint are read from the app container's environment,
 * which is where `app.yaml` puts them. A value baked into this file would ship
 * one workspace's deployment into every build, and the publication leak check
 * blocks on exactly that.
 */
import { appServicePrincipal } from './execution-identity';
import { resolveExperimentId } from '../lib/app-settings';
import { withDeadline } from '../lib/deadline';
import { normalizeWorkspaceHost } from '../../shared/databricks-links';
import type { InsightsAppKit } from './insights-routes';

/**
 * One environment-sourced value, with the variable that carried it.
 *
 * The variable name travels with the value so the page can say where a value
 * came from, and so an EMPTY one can say which variable is unset instead of
 * rendering a blank the reader has to guess the cause of.
 */
export interface EnvironmentValue {
  value: string;
  variable: string;
}

function fromEnvironment(variable: string): EnvironmentValue {
  return { value: process.env[variable]?.trim() ?? '', variable };
}

export interface ArchitecturePayload {
  /**
   * The workspace this app believes it is in, normalised, or ''.
   *
   * Empty is a supported state and the page renders nodes without links in it.
   * A guessed host would send a reader into somebody else's workspace.
   */
  workspaceHost: string;
  /** Whether a Databricks deep link can be built at all. */
  canDeepLink: boolean;
  /** The endpoint the app invokes, from the `serving-endpoint` app resource. */
  servingEndpoint: EnvironmentValue;
  /** The app's OWN warehouse, which the orchestrator's need not be. */
  appWarehouse: EnvironmentValue;
  /** The experiment a stored trace deep-links into, saved override first. */
  experimentId: string;
  /** The app's service principal, or '' when the container was given none. */
  appServicePrincipal: string;
  /** The commit this app build came from, or '' when it does not know. */
  appBuildSha: string;
  /** When this was composed, so the page can say how old it is. */
  readAt: string;
}
export const ARCHITECTURE_EXPERIMENT_TIMEOUT_MS = 2_000;

async function architectureExperimentId(appkit: InsightsAppKit): Promise<string> {
  try {
    return await withDeadline(
      resolveExperimentId(appkit),
      ARCHITECTURE_EXPERIMENT_TIMEOUT_MS,
      `Experiment lookup did not answer within ${ARCHITECTURE_EXPERIMENT_TIMEOUT_MS} ms.`
    );
  } catch {
    // This diagnostic route must still draw the map when Lakebase or MLflow is unavailable.
    return process.env.PLAYER_INSIGHTS_EXPERIMENT_ID?.trim() ?? '';
  }
}

/**
 * The cheap half of the architecture, composed.
 *
 * Pure but for the environment and one Lakebase read for the saved experiment
 * override, which is the same read `/api/settings` makes and the same one the
 * trace links already depend on.
 */
export async function architecturePayload(appkit: InsightsAppKit): Promise<ArchitecturePayload> {
  const workspaceHost = normalizeWorkspaceHost(process.env.DATABRICKS_HOST);
  return {
    workspaceHost,
    canDeepLink: Boolean(workspaceHost),
    servingEndpoint: fromEnvironment('DATABRICKS_SERVING_ENDPOINT_NAME'),
    appWarehouse: fromEnvironment('DATABRICKS_SQL_WAREHOUSE_ID'),
    // Through the same resolver the trace links use, so a saved override that
    // fixed a link there is the value named here too.
    experimentId: await architectureExperimentId(appkit),
    appServicePrincipal: appServicePrincipal() ?? '',
    appBuildSha: process.env.PLAYER_INSIGHTS_BUILD_SHA?.trim() ?? '',
    readAt: new Date().toISOString(),
  };
}

export function setupArchitectureRoutes(appkit: InsightsAppKit) {
  appkit.server.extend((app) => {
    /**
     * Answers 200 with empty values rather than failing.
     *
     * Every field here is allowed to be empty and the page renders each empty
     * one as the variable that is unset. A 503 would take down the page whose
     * job is to explain the shape of a deployment, at the moment somebody is
     * using it to work out why the deployment is wrong.
     */
    app.get('/api/architecture', async (_req, res) => {
      res.json(await architecturePayload(appkit));
    });
  });
}
