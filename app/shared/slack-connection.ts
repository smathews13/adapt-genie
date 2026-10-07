import { z } from 'zod';

export const SLACK_OAUTH_CALLBACK_PATH = '/api/slack/oauth/callback';

/** Secret key names the setup instructions ask for, used when an admin does not choose others. */
export const DEFAULT_SLACK_SECRET_KEYS = {
  appToken: 'adapt-slack-app-token',
  botToken: 'adapt-slack-bot-oauth-token',
  oauthClientSecret: 'adapt-slack-oauth-client-secret',
  brokerEncryptionKey: 'adapt-slack-broker-key',
} as const;

function httpsOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

const HttpsOrigin = z
  .string()
  .trim()
  .transform((value, context) => {
    const origin = httpsOrigin(value);
    if (!origin) context.addIssue({ code: 'custom', message: 'Use a full https address.' });
    return origin ?? value;
  });

/**
 * The per-environment Slack values an admin supplies once. Everything else the
 * adapter needs is derived from these, so a customer never edits app.yaml.
 */
export const SlackConnectionSchema = z.strictObject({
  environment: z.enum(['test', 'production']),
  allowedTeamId: z
    .string()
    .trim()
    .regex(/^T[A-Z0-9]+$/, 'Use the Slack Team ID that starts with T, not the Enterprise ID that starts with E.'),
  databricksWorkspaceHost: HttpsOrigin,
  publicBaseUrl: HttpsOrigin,
  oauthClientId: z.string().trim().min(1).max(256),
  secretScope: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]{1,128}$/, 'Use the secret scope name.'),
});

export type SlackConnection = z.infer<typeof SlackConnectionSchema>;

/** Fixed, never customer-chosen values that the adapter's own validation still requires. */
export const SLACK_CONNECTION_FIXED = {
  testRegistrationId: 'adapt-slack-test',
  productionRegistrationId: 'adapt-slack-production',
  tokenBrokerRef: 'adapt-slack-broker',
  caps: {
    globalConcurrency: '8',
    workspaceConcurrency: '4',
    userConcurrency: '2',
    conversationConcurrency: '1',
    globalPerMinute: '100',
    workspacePerMinute: '50',
    userPerMinute: '10',
    conversationPerMinute: '5',
  },
} as const;

export interface SlackConnectionResponse {
  connection: Partial<SlackConnection> | null;
  complete: boolean;
  managedByRelease: boolean;
  suggested: { publicBaseUrl: string; databricksWorkspaceHost: string; callbackUrl: string };
  secrets: { scope: string | null; keys: typeof DEFAULT_SLACK_SECRET_KEYS };
  requiresRestart: boolean;
}
