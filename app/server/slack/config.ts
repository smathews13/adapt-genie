import crypto from 'node:crypto';
import { z } from 'zod';

export type SlackRuntimeEnvironment = 'test' | 'production';
export const SLACK_DATABRICKS_OAUTH_SCOPES = 'all-apis offline_access openid profile email';

export interface SlackRuntimeConfig {
  environment: SlackRuntimeEnvironment;
  enabled: boolean;
  killSwitch: boolean;
  allowedTeamId: string;
  allowedTeamHash: string;
  databricksWorkspaceHost: string;
  oauthExpectedAudience: string;
  oauthClientId: string;
  oauthCallbackUrl: string;
  publicBaseUrl: string;
  tokenBrokerRef: string;
  appTokenSecretRef: string;
  botTokenSecretRef: string;
  clientSecretRef: string;
  signingSecretRef: string;
  registrationId: string;
  testRegistrationId: string;
  productionRegistrationId: string;
  caps: {
    globalConcurrency: number;
    workspaceConcurrency: number;
    userConcurrency: number;
    conversationConcurrency: number;
    globalPerMinute: number;
    workspacePerMinute: number;
    userPerMinute: number;
    conversationPerMinute: number;
  };
}

export interface SlackInstallationScope {
  environment: SlackRuntimeEnvironment;
  registrationId: string;
  workspaceHash: string;
}

export type SlackConfigResult =
  | { ready: true; config: SlackRuntimeConfig }
  | { ready: false; reason: 'disabled' | 'kill_switch' | 'invalid_configuration'; detail: string };

const PositiveInt = z.coerce.number().int().positive();
const RuntimeSchema = z.strictObject({
  environment: z.enum(['test', 'production']),
  enabled: z.enum(['true', 'false']).transform((value) => value === 'true'),
  killSwitch: z.enum(['true', 'false']).transform((value) => value === 'true'),
  allowedTeamId: z.string().regex(/^T[A-Z0-9]+$/),
  databricksWorkspaceHost: z
    .string()
    .url()
    .refine((value) => new URL(value).protocol === 'https:'),
  oauthExpectedAudience: z.string().trim().min(1).max(256),
  oauthClientId: z.string().trim().min(1).max(256),
  oauthScopes: z.literal(SLACK_DATABRICKS_OAUTH_SCOPES),
  oauthCallbackUrl: z
    .string()
    .url()
    .refine((value) => new URL(value).protocol === 'https:'),
  publicBaseUrl: z
    .string()
    .url()
    .refine((value) => new URL(value).protocol === 'https:'),
  tokenBrokerRef: z.string().trim().min(1).max(256),
  appTokenSecretRef: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  botTokenSecretRef: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  clientSecretRef: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  signingSecretRef: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  testRegistrationId: z.string().trim().min(1).max(128),
  productionRegistrationId: z.string().trim().min(1).max(128),
  globalConcurrency: PositiveInt.max(100),
  workspaceConcurrency: PositiveInt.max(50),
  userConcurrency: PositiveInt.max(20),
  conversationConcurrency: PositiveInt.max(10),
  globalPerMinute: PositiveInt.max(10_000),
  workspacePerMinute: PositiveInt.max(5_000),
  userPerMinute: PositiveInt.max(1_000),
  conversationPerMinute: PositiveInt.max(500),
});

function text(env: NodeJS.ProcessEnv, name: string): string {
  return env[name]?.trim() ?? '';
}

const InstallationScopeSchema = z.strictObject({
  environment: z.enum(['test', 'production']),
  allowedTeamId: z.string().regex(/^T[A-Z0-9]+$/),
  testRegistrationId: z.string().trim().min(1).max(128),
  productionRegistrationId: z.string().trim().min(1).max(128),
});

export function hashSlackIdentifier(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function readSlackInstallationScope(env: NodeJS.ProcessEnv = process.env): SlackInstallationScope | null {
  const parsed = InstallationScopeSchema.safeParse({
    environment: text(env, 'SLACK_ADAPTER_ENVIRONMENT'),
    allowedTeamId: text(env, 'SLACK_ADAPTER_ALLOWED_TEAM_ID'),
    testRegistrationId: text(env, 'SLACK_ADAPTER_TEST_REGISTRATION_ID'),
    productionRegistrationId: text(env, 'SLACK_ADAPTER_PRODUCTION_REGISTRATION_ID'),
  });
  if (!parsed.success || parsed.data.testRegistrationId === parsed.data.productionRegistrationId) return null;
  return {
    environment: parsed.data.environment,
    registrationId:
      parsed.data.environment === 'test' ? parsed.data.testRegistrationId : parsed.data.productionRegistrationId,
    workspaceHash: hashSlackIdentifier(parsed.data.allowedTeamId),
  };
}

export function readSlackRuntimeConfig(env: NodeJS.ProcessEnv = process.env): SlackConfigResult {
  const raw = {
    environment: text(env, 'SLACK_ADAPTER_ENVIRONMENT'),
    enabled: text(env, 'SLACK_ADAPTER_ENABLED') || 'false',
    killSwitch: text(env, 'SLACK_ADAPTER_KILL_SWITCH') || 'true',
    allowedTeamId: text(env, 'SLACK_ADAPTER_ALLOWED_TEAM_ID'),
    databricksWorkspaceHost: text(env, 'SLACK_ADAPTER_DATABRICKS_WORKSPACE'),
    oauthExpectedAudience: text(env, 'SLACK_ADAPTER_OAUTH_EXPECTED_AUDIENCE'),
    oauthClientId: text(env, 'SLACK_ADAPTER_OAUTH_CLIENT_ID'),
    oauthScopes: text(env, 'SLACK_ADAPTER_OAUTH_SCOPES'),
    oauthCallbackUrl: text(env, 'SLACK_ADAPTER_OAUTH_CALLBACK_URL'),
    publicBaseUrl: text(env, 'SLACK_ADAPTER_PUBLIC_BASE_URL'),
    tokenBrokerRef: text(env, 'SLACK_ADAPTER_TOKEN_BROKER_REF'),
    appTokenSecretRef: text(env, 'SLACK_ADAPTER_APP_TOKEN_SECRET_REF'),
    botTokenSecretRef: text(env, 'SLACK_ADAPTER_BOT_TOKEN_SECRET_REF'),
    clientSecretRef: text(env, 'SLACK_ADAPTER_CLIENT_SECRET_REF'),
    signingSecretRef: text(env, 'SLACK_ADAPTER_SIGNING_SECRET_REF'),
    testRegistrationId: text(env, 'SLACK_ADAPTER_TEST_REGISTRATION_ID'),
    productionRegistrationId: text(env, 'SLACK_ADAPTER_PRODUCTION_REGISTRATION_ID'),
    globalConcurrency: text(env, 'SLACK_ADAPTER_GLOBAL_CONCURRENCY'),
    workspaceConcurrency: text(env, 'SLACK_ADAPTER_WORKSPACE_CONCURRENCY'),
    userConcurrency: text(env, 'SLACK_ADAPTER_USER_CONCURRENCY'),
    conversationConcurrency: text(env, 'SLACK_ADAPTER_CONVERSATION_CONCURRENCY'),
    globalPerMinute: text(env, 'SLACK_ADAPTER_GLOBAL_PER_MINUTE'),
    workspacePerMinute: text(env, 'SLACK_ADAPTER_WORKSPACE_PER_MINUTE'),
    userPerMinute: text(env, 'SLACK_ADAPTER_USER_PER_MINUTE'),
    conversationPerMinute: text(env, 'SLACK_ADAPTER_CONVERSATION_PER_MINUTE'),
  };
  if (raw.enabled !== 'true') {
    return { ready: false, reason: 'disabled', detail: 'Slack adapter is disabled.' };
  }
  if (raw.killSwitch !== 'false') {
    return { ready: false, reason: 'kill_switch', detail: 'Slack adapter kill switch is active.' };
  }
  const parsed = RuntimeSchema.safeParse(raw);
  if (!parsed.success) {
    return { ready: false, reason: 'invalid_configuration', detail: 'Slack runtime configuration is incomplete.' };
  }
  const registrationId =
    parsed.data.environment === 'test' ? parsed.data.testRegistrationId : parsed.data.productionRegistrationId;
  if (parsed.data.testRegistrationId === parsed.data.productionRegistrationId) {
    return {
      ready: false,
      reason: 'invalid_configuration',
      detail: 'Test and production Slack registrations must be different.',
    };
  }
  return {
    ready: true,
    config: {
      environment: parsed.data.environment,
      enabled: parsed.data.enabled,
      killSwitch: parsed.data.killSwitch,
      allowedTeamId: parsed.data.allowedTeamId,
      allowedTeamHash: hashSlackIdentifier(parsed.data.allowedTeamId),
      databricksWorkspaceHost: parsed.data.databricksWorkspaceHost,
      oauthExpectedAudience: parsed.data.oauthExpectedAudience,
      oauthClientId: parsed.data.oauthClientId,
      oauthCallbackUrl: parsed.data.oauthCallbackUrl,
      publicBaseUrl: parsed.data.publicBaseUrl,
      tokenBrokerRef: parsed.data.tokenBrokerRef,
      appTokenSecretRef: parsed.data.appTokenSecretRef,
      botTokenSecretRef: parsed.data.botTokenSecretRef,
      clientSecretRef: parsed.data.clientSecretRef,
      signingSecretRef: parsed.data.signingSecretRef,
      registrationId,
      testRegistrationId: parsed.data.testRegistrationId,
      productionRegistrationId: parsed.data.productionRegistrationId,
      caps: {
        globalConcurrency: parsed.data.globalConcurrency,
        workspaceConcurrency: parsed.data.workspaceConcurrency,
        userConcurrency: parsed.data.userConcurrency,
        conversationConcurrency: parsed.data.conversationConcurrency,
        globalPerMinute: parsed.data.globalPerMinute,
        workspacePerMinute: parsed.data.workspacePerMinute,
        userPerMinute: parsed.data.userPerMinute,
        conversationPerMinute: parsed.data.conversationPerMinute,
      },
    },
  };
}

export interface SlackResolvedSecrets {
  appToken: string;
  botToken: string;
}

export type SlackSecretResult =
  | { ready: true; secrets: SlackResolvedSecrets }
  | { ready: false; reason: 'secrets_unavailable' };

export function resolveSlackSecrets(
  config: SlackRuntimeConfig,
  env: NodeJS.ProcessEnv = process.env
): SlackSecretResult {
  const appToken = text(env, config.appTokenSecretRef);
  const botToken = text(env, config.botTokenSecretRef);
  if (!appToken.startsWith('xapp-') || !botToken.startsWith('xoxb-')) {
    return { ready: false, reason: 'secrets_unavailable' };
  }
  return { ready: true, secrets: { appToken, botToken } };
}
