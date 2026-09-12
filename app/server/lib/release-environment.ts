/**
 * Target-specific runtime configuration that must survive a source-only Git deploy.
 *
 * Deploy from Git replaces app.yaml with the customer-neutral public artifact,
 * while the App identity, model, ACL, resource bindings, and Lakebase store stay
 * unchanged. Restore an existing allowlisted snapshot when present; otherwise
 * reconstruct and record it from those durable resources before routes load.
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
  'ADAPT_ADMIN_GROUP_LABEL',
  'ADAPT_USER_GROUP_LABEL',
] as const;

export type ReleaseEnvironmentKey = (typeof RELEASE_ENVIRONMENT_KEYS)[number];

export const REQUIRED_GIT_RELEASE_ENVIRONMENT_KEYS: readonly ReleaseEnvironmentKey[] = [
  'PLAYER_INSIGHTS_CATALOG',
  'PLAYER_INSIGHTS_SCHEMA',
  'PLAYER_INSIGHTS_WATCHLIST_TABLE',
  'PLAYER_INSIGHTS_DATA_GENIE_ID',
  'PLAYER_INSIGHTS_LLM_ENDPOINT',
  'PLAYER_INSIGHTS_USER_API_SCOPES',
  'PLAYER_INSIGHTS_APP_SCHEMA',
  'ADAPT_ADMIN_GROUP',
  'ADAPT_USER_GROUP',
];

const VALIDATED_RECOVERY_KEYS: readonly ReleaseEnvironmentKey[] = [
  'PLAYER_INSIGHTS_CATALOG',
  'PLAYER_INSIGHTS_SCHEMA',
  'PLAYER_INSIGHTS_WATCHLIST_TABLE',
  'PLAYER_INSIGHTS_DATA_GENIE_ID',
  'PLAYER_INSIGHTS_LLM_ENDPOINT',
  'PLAYER_INSIGHTS_USER_API_SCOPES',
  'PLAYER_INSIGHTS_APP_SCHEMA',
  'ADAPT_ADMIN_GROUP',
  'ADAPT_USER_GROUP',
];

export class MissingReleaseEnvironmentSnapshot extends Error {
  constructor(readonly missing: readonly ReleaseEnvironmentKey[]) {
    super(
      `Deploy from Git was stopped because these values could not be recovered from the existing app: ${missing.join(', ')}. ` +
        'The previous active deployment remains unchanged; no bundle release is required.'
    );
    this.name = 'MissingReleaseEnvironmentSnapshot';
  }
}

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

function configurationValue(entries: readonly { key: string; value?: unknown }[], key: string): string {
  const value = entries.find((entry) => entry.key === key)?.value;
  return typeof value === 'string' ? value.trim() : '';
}

function configurationList(entries: readonly { key: string; value?: unknown }[], key: string): string[] {
  const value = entries.find((entry) => entry.key === key)?.value;
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean) : [];
}

export type ReleaseEnvironmentRecovery = () => Promise<Partial<Record<ReleaseEnvironmentKey, string>>>;

interface RecoverableAppGroup {
  kind: string;
  name: string;
  directPermission: string | null;
  inherited: boolean;
}

export function recoveredReleaseEnvironment(input: {
  baked: readonly { key: string; value?: unknown }[];
  groups: readonly RecoverableAppGroup[];
  appSchema: string;
  sharedRail: string | null;
  confirmedAuthoredGroups?: { admin: string; user: string };
  appUserApiScopes?: readonly string[];
  telemetrySchema?: string;
}): Partial<Record<ReleaseEnvironmentKey, string>> {
  const manifest = configurationList(input.baked, 'declared_manifest');
  const watchlist = manifest.filter((table) => /\.txn_steam_sales_with_analytics$/i.test(table));
  const groups = input.groups.filter((principal) => principal.kind === 'group' && principal.directPermission);
  const adminGroups = groups.filter((principal) => principal.directPermission === 'CAN_MANAGE');
  const userGroups = groups.filter(
    (principal) =>
      principal.directPermission === 'CAN_USE' && !adminGroups.some((admin) => admin.name === principal.name)
  );
  const adminGroup =
    input.confirmedAuthoredGroups?.admin.trim() || (adminGroups.length === 1 ? adminGroups[0]?.name.trim() : '');
  const userGroup =
    input.confirmedAuthoredGroups?.user.trim() || (userGroups.length === 1 ? userGroups[0]?.name.trim() : '');

  return releaseEnvironmentSnapshot({
    PLAYER_INSIGHTS_CATALOG: configurationValue(input.baked, 'catalog'),
    PLAYER_INSIGHTS_SCHEMA: configurationValue(input.baked, 'schema'),
    PLAYER_INSIGHTS_APP_CATALOG: configurationValue(input.baked, 'app_catalog'),
    PLAYER_INSIGHTS_WATCHLIST_TABLE: watchlist.length === 1 ? watchlist[0] : '',
    PLAYER_INSIGHTS_DATA_GENIE_ID: configurationValue(input.baked, 'data_genie_space_id'),
    PLAYER_INSIGHTS_LLM_ENDPOINT: configurationValue(input.baked, 'llm_endpoint'),
    PLAYER_INSIGHTS_TELEMETRY_SCHEMA: input.telemetrySchema,
    PLAYER_INSIGHTS_USER_API_SCOPES: input.appUserApiScopes?.filter(Boolean).join(','),
    PLAYER_INSIGHTS_APP_SCHEMA: input.appSchema,
    PLAYER_INSIGHTS_SHARED_CONVERSATION_RAIL: input.sharedRail ?? undefined,
    ADAPT_ADMIN_GROUP: adminGroup,
    ADAPT_USER_GROUP: userGroup,
  });
}

/**
 * Reconstruct the release environment from resources that survive Deploy from Git.
 *
 * The served model retains catalog, schema, Genie, foundation-model and table
 * declarations. The Databricks App ACL retains its admin and consumer groups.
 * Lakebase retains the app schema and the older shared-rail decision. Together
 * they make an existing deployment self-migrating; nobody has to run a bundle
 * release just to preserve configuration.
 */
async function recoverExistingReleaseEnvironment(
  store: DecisionStore,
  env: Record<string, string | undefined>
): Promise<Partial<Record<ReleaseEnvironmentKey, string>>> {
  const [
    { readBakedModelConfig },
    { appAccessPrincipals },
    { readWorkspaceGroup },
    { workspaceControlPlaneReader },
    { telemetryDestinationFromApp },
    appSchema,
  ] = await Promise.all([
    import('./baked-model-config'),
    import('./app-access-roster'),
    import('./adapt-group-members'),
    import('./control-plane-identity'),
    import('./ops-telemetry'),
    import('../../shared/app-schema'),
  ]);
  const appName = (env.DATABRICKS_APP_NAME ?? '').trim();
  const authoredAdmin = (env.ADAPT_ADMIN_GROUP ?? '').trim();
  const authoredUser = (env.ADAPT_USER_GROUP ?? '').trim();
  const [baked, permissions, app, adminCheck, userCheck, sharedRail] = await Promise.all([
    readBakedModelConfig(),
    appName
      ? workspaceControlPlaneReader(`/api/2.0/permissions/apps/${encodeURIComponent(appName)}`).catch(() => null)
      : null,
    appName ? workspaceControlPlaneReader(`/api/2.0/apps/${encodeURIComponent(appName)}`).catch(() => null) : null,
    readWorkspaceGroup(authoredAdmin).catch(() => ({ exists: false })),
    readWorkspaceGroup(authoredUser).catch(() => ({ exists: false })),
    readDeploymentDecision(store, decisionTable(), 'shared_conversation_rail'),
  ]);
  const appRecord = recordOf(app);
  return recoveredReleaseEnvironment({
    baked,
    groups: appAccessPrincipals(permissions),
    appSchema: appSchema.APP_SCHEMA,
    sharedRail,
    ...(adminCheck.exists && userCheck.exists
      ? { confirmedAuthoredGroups: { admin: authoredAdmin, user: authoredUser } }
      : {}),
    appUserApiScopes: stringList(appRecord.user_api_scopes ?? appRecord.userApiScopes),
    telemetrySchema: telemetryDestinationFromApp(app).schema,
  });
}

/** Restore or automatically recover release values before modules capture process.env. */
export async function restoreReleaseEnvironment(
  store: DecisionStore,
  env: Record<string, string | undefined> = process.env,
  recover: ReleaseEnvironmentRecovery = () => recoverExistingReleaseEnvironment(store, env)
): Promise<number> {
  if (decisionSource(env) !== 'git-deploy') return 0;
  const snapshot = parsedSnapshot(await readDeploymentDecision(store, decisionTable(), RELEASE_ENVIRONMENT_DECISION));
  const snapshotMissing = REQUIRED_GIT_RELEASE_ENVIRONMENT_KEYS.filter((key) => !snapshot?.[key]);
  const recovered = snapshotMissing.length > 0 ? await recover() : {};
  const authored = releaseEnvironmentSnapshot(env);
  if (snapshotMissing.length > 0) {
    for (const key of VALIDATED_RECOVERY_KEYS) delete authored[key];
  }
  const combined = {
    ...authored,
    ...recovered,
    ...snapshot,
  };
  const missing = REQUIRED_GIT_RELEASE_ENVIRONMENT_KEYS.filter((key) => !combined[key]);
  if (missing.length > 0) throw new MissingReleaseEnvironmentSnapshot(missing);
  let restored = 0;
  for (const key of RELEASE_ENVIRONMENT_KEYS) {
    const value = combined[key];
    if (!value) continue;
    env[key] = value;
    restored += 1;
  }
  if (snapshotMissing.length > 0) {
    const persisted = {
      ...recovered,
      ...snapshot,
    };
    await recordDeploymentDecision(
      store,
      decisionTable(),
      RELEASE_ENVIRONMENT_DECISION,
      JSON.stringify(persisted),
      'automatic Git migration'
    );
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
