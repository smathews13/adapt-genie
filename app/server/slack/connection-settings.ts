import { appTable } from '../../shared/app-schema';
import {
  DEFAULT_SLACK_SECRET_KEYS,
  SLACK_CONNECTION_FIXED,
  SLACK_OAUTH_CALLBACK_PATH,
  SlackConnectionSchema,
  type SlackConnection,
} from '../../shared/slack-connection';
import {
  DEPLOYMENT_DECISIONS_TABLE_NAME,
  readDeploymentDecision,
  recordDeploymentDecision,
  type DecisionStore,
} from '../lib/deployment-decisions';
import { RELEASE_ENVIRONMENT_DECISION } from '../lib/release-environment';

type Env = Record<string, string | undefined>;

const SECRET_ENV = {
  appToken: 'SLACK_ADAPTER_APP_TOKEN',
  botToken: 'SLACK_ADAPTER_BOT_TOKEN',
  oauthClientSecret: 'SLACK_ADAPTER_OAUTH_CLIENT_SECRET',
  brokerEncryptionKey: 'SLACK_ADAPTER_BROKER_ENCRYPTION_KEY',
} as const;

const SECRET_REF_ENV = {
  appToken: 'SLACK_ADAPTER_APP_TOKEN_SECRET_REF',
  botToken: 'SLACK_ADAPTER_BOT_TOKEN_SECRET_REF',
  oauthClientSecret: 'SLACK_ADAPTER_OAUTH_CLIENT_SECRET_REF',
  brokerEncryptionKey: 'SLACK_ADAPTER_BROKER_ENCRYPTION_KEY_REF',
} as const;

const SECRET_KEY_ENV = {
  appToken: 'SLACK_ADAPTER_APP_TOKEN_SECRET_KEY',
  botToken: 'SLACK_ADAPTER_BOT_TOKEN_SECRET_KEY',
  oauthClientSecret: 'SLACK_ADAPTER_OAUTH_CLIENT_SECRET_KEY',
  brokerEncryptionKey: 'SLACK_ADAPTER_BROKER_ENCRYPTION_KEY_SECRET_KEY',
} as const;

type SecretName = keyof typeof SECRET_ENV;
const SECRET_NAMES = Object.keys(SECRET_ENV) as SecretName[];

/** Every environment key this module may write into the app-owned snapshot. */
export const SLACK_CONNECTION_ENV_KEYS = [
  'SLACK_ADAPTER_ENVIRONMENT',
  'SLACK_ADAPTER_ENABLED',
  'SLACK_ADAPTER_KILL_SWITCH',
  'SLACK_ADAPTER_ALLOWED_TEAM_ID',
  'SLACK_ADAPTER_TEST_REGISTRATION_ID',
  'SLACK_ADAPTER_PRODUCTION_REGISTRATION_ID',
  'SLACK_ADAPTER_DATABRICKS_WORKSPACE',
  'SLACK_ADAPTER_OAUTH_EXPECTED_AUDIENCE',
  'SLACK_ADAPTER_OAUTH_CLIENT_ID',
  'SLACK_ADAPTER_OAUTH_CALLBACK_URL',
  'SLACK_ADAPTER_PUBLIC_BASE_URL',
  'SLACK_ADAPTER_TOKEN_BROKER_REF',
  'SLACK_ADAPTER_GLOBAL_CONCURRENCY',
  'SLACK_ADAPTER_WORKSPACE_CONCURRENCY',
  'SLACK_ADAPTER_USER_CONCURRENCY',
  'SLACK_ADAPTER_CONVERSATION_CONCURRENCY',
  'SLACK_ADAPTER_GLOBAL_PER_MINUTE',
  'SLACK_ADAPTER_WORKSPACE_PER_MINUTE',
  'SLACK_ADAPTER_USER_PER_MINUTE',
  'SLACK_ADAPTER_CONVERSATION_PER_MINUTE',
  'SLACK_ADAPTER_SECRET_SCOPE',
  ...Object.values(SECRET_REF_ENV),
  ...Object.values(SECRET_KEY_ENV),
] as const;

function decisionTable(): string {
  return appTable(DEPLOYMENT_DECISIONS_TABLE_NAME);
}

/**
 * The environment the Slack adapter reads. The master switch is armed because
 * the real on/off control is the separate, default-off operational settings
 * document; saving connection values must not by itself turn Slack on.
 */
export function slackConnectionEnv(connection: SlackConnection): Record<string, string> {
  const env: Record<string, string> = {
    SLACK_ADAPTER_ENVIRONMENT: connection.environment,
    SLACK_ADAPTER_ENABLED: 'true',
    SLACK_ADAPTER_KILL_SWITCH: 'false',
    SLACK_ADAPTER_ALLOWED_TEAM_ID: connection.allowedTeamId,
    SLACK_ADAPTER_TEST_REGISTRATION_ID: SLACK_CONNECTION_FIXED.testRegistrationId,
    SLACK_ADAPTER_PRODUCTION_REGISTRATION_ID: SLACK_CONNECTION_FIXED.productionRegistrationId,
    SLACK_ADAPTER_DATABRICKS_WORKSPACE: connection.databricksWorkspaceHost,
    SLACK_ADAPTER_OAUTH_EXPECTED_AUDIENCE: connection.databricksWorkspaceHost,
    SLACK_ADAPTER_OAUTH_CLIENT_ID: connection.oauthClientId,
    SLACK_ADAPTER_OAUTH_CALLBACK_URL: new URL(SLACK_OAUTH_CALLBACK_PATH, connection.publicBaseUrl).toString(),
    SLACK_ADAPTER_PUBLIC_BASE_URL: connection.publicBaseUrl,
    SLACK_ADAPTER_TOKEN_BROKER_REF: SLACK_CONNECTION_FIXED.tokenBrokerRef,
    SLACK_ADAPTER_GLOBAL_CONCURRENCY: SLACK_CONNECTION_FIXED.caps.globalConcurrency,
    SLACK_ADAPTER_WORKSPACE_CONCURRENCY: SLACK_CONNECTION_FIXED.caps.workspaceConcurrency,
    SLACK_ADAPTER_USER_CONCURRENCY: SLACK_CONNECTION_FIXED.caps.userConcurrency,
    SLACK_ADAPTER_CONVERSATION_CONCURRENCY: SLACK_CONNECTION_FIXED.caps.conversationConcurrency,
    SLACK_ADAPTER_GLOBAL_PER_MINUTE: SLACK_CONNECTION_FIXED.caps.globalPerMinute,
    SLACK_ADAPTER_WORKSPACE_PER_MINUTE: SLACK_CONNECTION_FIXED.caps.workspacePerMinute,
    SLACK_ADAPTER_USER_PER_MINUTE: SLACK_CONNECTION_FIXED.caps.userPerMinute,
    SLACK_ADAPTER_CONVERSATION_PER_MINUTE: SLACK_CONNECTION_FIXED.caps.conversationPerMinute,
    SLACK_ADAPTER_SECRET_SCOPE: connection.secretScope,
  };
  for (const name of SECRET_NAMES) {
    env[SECRET_REF_ENV[name]] = SECRET_ENV[name];
    env[SECRET_KEY_ENV[name]] = DEFAULT_SLACK_SECRET_KEYS[name];
  }
  return env;
}

/** The admin-entered values, read back from an environment or snapshot. Null unless all are present and valid. */
export function slackConnectionFromEnv(env: Env): SlackConnection | null {
  const parsed = SlackConnectionSchema.safeParse({
    environment: env.SLACK_ADAPTER_ENVIRONMENT?.trim(),
    allowedTeamId: env.SLACK_ADAPTER_ALLOWED_TEAM_ID,
    databricksWorkspaceHost: env.SLACK_ADAPTER_DATABRICKS_WORKSPACE,
    publicBaseUrl: env.SLACK_ADAPTER_PUBLIC_BASE_URL,
    oauthClientId: env.SLACK_ADAPTER_OAUTH_CLIENT_ID,
    secretScope: env.SLACK_ADAPTER_SECRET_SCOPE,
  });
  return parsed.success ? parsed.data : null;
}

/** Partial view for pre-filling the form, tolerant of half-entered values. */
export function slackConnectionDraftFromEnv(env: Env): Partial<SlackConnection> {
  const draft: Partial<SlackConnection> = {};
  const environment = env.SLACK_ADAPTER_ENVIRONMENT?.trim();
  if (environment === 'test' || environment === 'production') draft.environment = environment;
  const text = (key: string) => env[key]?.trim() || undefined;
  const team = text('SLACK_ADAPTER_ALLOWED_TEAM_ID');
  if (team) draft.allowedTeamId = team;
  const host = text('SLACK_ADAPTER_DATABRICKS_WORKSPACE');
  if (host) draft.databricksWorkspaceHost = host;
  const base = text('SLACK_ADAPTER_PUBLIC_BASE_URL');
  if (base) draft.publicBaseUrl = base;
  const client = text('SLACK_ADAPTER_OAUTH_CLIENT_ID');
  if (client) draft.oauthClientId = client;
  const scope = text('SLACK_ADAPTER_SECRET_SCOPE');
  if (scope) draft.secretScope = scope;
  return draft;
}

function parseSnapshot(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    );
  } catch {
    return {};
  }
}

export async function readStoredSlackSnapshot(store: DecisionStore): Promise<Record<string, string>> {
  return parseSnapshot(await readDeploymentDecision(store, decisionTable(), RELEASE_ENVIRONMENT_DECISION));
}

/**
 * Merge the connection into the app-owned release snapshot, leaving every
 * other recorded value untouched. That snapshot is what Deploy from Git
 * restores, so a Git update never needs these values in app.yaml.
 */
export async function writeSlackConnection(
  store: DecisionStore,
  connection: SlackConnection,
  actor: string
): Promise<boolean> {
  const existing = await readStoredSlackSnapshot(store);
  return recordDeploymentDecision(
    store,
    decisionTable(),
    RELEASE_ENVIRONMENT_DECISION,
    JSON.stringify({ ...existing, ...slackConnectionEnv(connection) }),
    actor
  );
}

export interface SlackSecretReader {
  (scope: string, key: string): Promise<string | null>;
}

export interface SlackSecretHydration {
  loaded: SecretName[];
  missing: SecretName[];
}

/**
 * Fill any Slack secret that no app.yaml binding provided by reading it from
 * the configured secret scope as the app's own identity. An existing
 * environment value always wins, so deployments bound through app resources
 * behave exactly as before. Values are written only to the process
 * environment, never logged.
 */
export async function hydrateSlackSecrets(env: Env, read: SlackSecretReader): Promise<SlackSecretHydration> {
  const result: SlackSecretHydration = { loaded: [], missing: [] };
  const scope = env.SLACK_ADAPTER_SECRET_SCOPE?.trim();
  if (!scope) return result;
  for (const name of SECRET_NAMES) {
    const envName = env[SECRET_REF_ENV[name]]?.trim() || SECRET_ENV[name];
    if (env[envName]?.trim()) continue;
    const key = env[SECRET_KEY_ENV[name]]?.trim() || DEFAULT_SLACK_SECRET_KEYS[name];
    const value = await read(scope, key).catch(() => null);
    if (value?.trim()) {
      env[envName] = value.trim();
      result.loaded.push(name);
    } else {
      result.missing.push(name);
    }
  }
  return result;
}

export async function readSecretWithAppIdentity(scope: string, key: string): Promise<string | null> {
  const { WorkspaceClient } = await import('@databricks/sdk-experimental');
  const response = await new WorkspaceClient({}).secrets.getSecret({ scope, key });
  return response.value ? Buffer.from(response.value, 'base64').toString('utf8') : null;
}
