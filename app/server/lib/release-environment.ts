/**
 * Target-specific runtime configuration that must survive a source-only Git deploy.
 *
 * A bundle release writes these values into its generated app.yaml. Deploy from
 * Git replaces that file with the customer-neutral public artifact, while the
 * App identity, resource bindings, and Lakebase store stay unchanged. Record one
 * allowlisted snapshot on release boots and restore it before route modules load.
 */
import { appTable } from '../../shared/app-schema';
import {
  DEPLOYMENT_DECISIONS_TABLE_NAME,
  decisionSource,
  readDeploymentDecision,
  recordDeploymentDecision,
  type DecisionStore,
} from './deployment-decisions';

export const RELEASE_ENVIRONMENT_DECISION = 'release_environment_v1';

export const RELEASE_ENVIRONMENT_KEYS = [
  'PLAYER_INSIGHTS_EXPERIMENT_ID',
  'PLAYER_INSIGHTS_EXPERIMENT_PATH',
  'PLAYER_INSIGHTS_CATALOG',
  'PLAYER_INSIGHTS_SCHEMA',
  'PLAYER_INSIGHTS_APP_CATALOG',
  'PLAYER_INSIGHTS_WATCHLIST_TABLE',
  'PLAYER_INSIGHTS_DATA_GENIE_ID',
  'PLAYER_INSIGHTS_LLM_ENDPOINT',
  'PLAYER_INSIGHTS_TELEMETRY_SCHEMA',
  'PLAYER_INSIGHTS_USER_API_SCOPES',
  'PLAYER_INSIGHTS_APP_SCHEMA',
  'PLAYER_INSIGHTS_SHARED_CONVERSATION_RAIL',
  'ADAPT_ADMIN_GROUP',
  'ADAPT_USER_GROUP',
] as const;

export type ReleaseEnvironmentKey = (typeof RELEASE_ENVIRONMENT_KEYS)[number];

function decisionTable(): string {
  return appTable(DEPLOYMENT_DECISIONS_TABLE_NAME);
}

/** Only explicit, non-empty release values are retained. Omission means unset. */
export function releaseEnvironmentSnapshot(
  env: Record<string, string | undefined>
): Partial<Record<ReleaseEnvironmentKey, string>> {
  return Object.fromEntries(
    RELEASE_ENVIRONMENT_KEYS.flatMap((key) => {
      const value = (env[key] ?? '').trim();
      return value ? [[key, value] as const] : [];
    })
  );
}

function parsedSnapshot(value: string | null): Partial<Record<ReleaseEnvironmentKey, string>> | null {
  if (!value) return null;
  try {
    const candidate = JSON.parse(value) as unknown;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const source = candidate as Record<string, unknown>;
    return Object.fromEntries(
      RELEASE_ENVIRONMENT_KEYS.flatMap((key) => {
        const value = source[key];
        return typeof value === 'string' && value.trim() ? [[key, value.trim()] as const] : [];
      })
    );
  } catch {
    return null;
  }
}

/** Restore the last bundle release before modules capture process.env. */
export async function restoreReleaseEnvironment(
  store: DecisionStore,
  env: Record<string, string | undefined> = process.env
): Promise<number> {
  if (decisionSource(env) !== 'git-deploy') return 0;
  const snapshot = parsedSnapshot(await readDeploymentDecision(store, decisionTable(), RELEASE_ENVIRONMENT_DECISION));
  if (!snapshot) return 0;
  let restored = 0;
  for (const key of RELEASE_ENVIRONMENT_KEYS) {
    const value = snapshot[key];
    if (!value) continue;
    env[key] = value;
    restored += 1;
  }
  return restored;
}

/** Record the allowlisted snapshot only when a bundle target is present. */
export async function recordReleaseEnvironment(
  store: DecisionStore,
  env: Record<string, string | undefined> = process.env
): Promise<boolean> {
  if (decisionSource(env) !== 'release') return false;
  return recordDeploymentDecision(
    store,
    decisionTable(),
    RELEASE_ENVIRONMENT_DECISION,
    JSON.stringify(releaseEnvironmentSnapshot(env)),
    'app boot'
  );
}
