import { describe, expect, it } from 'vitest';
import { readSlackInstallationScope, readSlackRuntimeConfig, resolveSlackSecrets } from './config';

function validEnv(): NodeJS.ProcessEnv {
  return {
    SLACK_ADAPTER_ENVIRONMENT: 'test',
    SLACK_ADAPTER_ENABLED: 'true',
    SLACK_ADAPTER_KILL_SWITCH: 'false',
    SLACK_ADAPTER_ALLOWED_TEAM_ID: 'T012ABC',
    SLACK_ADAPTER_DATABRICKS_WORKSPACE: 'https://example.cloud.databricks.com',
    SLACK_ADAPTER_OAUTH_EXPECTED_AUDIENCE: 'adapt',
    SLACK_ADAPTER_OAUTH_CLIENT_ID: 'oauth-client',
    SLACK_ADAPTER_OAUTH_SCOPES: 'all-apis offline_access openid profile email',
    SLACK_ADAPTER_OAUTH_CALLBACK_URL: 'https://adapt.example/api/slack/oauth/callback',
    SLACK_ADAPTER_PUBLIC_BASE_URL: 'https://adapt.example',
    SLACK_ADAPTER_TOKEN_BROKER_REF: 'broker-registration',
    SLACK_ADAPTER_APP_TOKEN_SECRET_REF: 'SLACK_APP_TOKEN',
    SLACK_ADAPTER_BOT_TOKEN_SECRET_REF: 'SLACK_BOT_TOKEN',
    SLACK_ADAPTER_CLIENT_SECRET_REF: 'SLACK_CLIENT_SECRET',
    SLACK_ADAPTER_SIGNING_SECRET_REF: 'SLACK_SIGNING_SECRET',
    SLACK_ADAPTER_TEST_REGISTRATION_ID: 'registration-test',
    SLACK_ADAPTER_PRODUCTION_REGISTRATION_ID: 'registration-production',
    SLACK_ADAPTER_GLOBAL_CONCURRENCY: '8',
    SLACK_ADAPTER_WORKSPACE_CONCURRENCY: '4',
    SLACK_ADAPTER_USER_CONCURRENCY: '2',
    SLACK_ADAPTER_CONVERSATION_CONCURRENCY: '1',
    SLACK_ADAPTER_GLOBAL_PER_MINUTE: '100',
    SLACK_ADAPTER_WORKSPACE_PER_MINUTE: '50',
    SLACK_ADAPTER_USER_PER_MINUTE: '10',
    SLACK_ADAPTER_CONVERSATION_PER_MINUTE: '5',
  };
}

describe('Slack runtime configuration', () => {
  it('defaults disabled and fail closed', () => {
    expect(readSlackRuntimeConfig({})).toEqual({
      ready: false,
      reason: 'disabled',
      detail: 'Slack adapter is disabled.',
    });
  });

  it('requires distinct test and production registrations', () => {
    const env = validEnv();
    env.SLACK_ADAPTER_PRODUCTION_REGISTRATION_ID = 'registration-test';
    expect(readSlackRuntimeConfig(env)).toMatchObject({ ready: false, reason: 'invalid_configuration' });
  });

  it('fails readiness on a missing OAuth audience instead of using an app-SP fallback', () => {
    const env = validEnv();
    delete env.SLACK_ADAPTER_OAUTH_EXPECTED_AUDIENCE;
    expect(readSlackRuntimeConfig(env)).toMatchObject({ ready: false, reason: 'invalid_configuration' });
  });

  it('rejects a deployment whose delegated OAuth scopes drift from the reviewed contract', () => {
    const env = validEnv();
    env.SLACK_ADAPTER_OAUTH_SCOPES = 'all-apis';
    expect(readSlackRuntimeConfig(env)).toMatchObject({ ready: false, reason: 'invalid_configuration' });
  });

  it('selects only the current environment registration and resolves secret refs', () => {
    const result = readSlackRuntimeConfig(validEnv());
    expect(result).toMatchObject({ ready: true });
    if (!result.ready) return;
    expect(result.config.registrationId).toBe('registration-test');
    expect(result.config.allowedTeamHash).toHaveLength(64);
    expect(
      resolveSlackSecrets(result.config, {
        SLACK_APP_TOKEN: 'xapp-secret',
        SLACK_BOT_TOKEN: 'xoxb-secret',
      })
    ).toMatchObject({ ready: true });
  });

  it('derives uninstall scope from configured environment/team without requiring Slack to be enabled', () => {
    const env = validEnv();
    env.SLACK_ADAPTER_ENABLED = 'false';
    expect(readSlackInstallationScope(env)).toMatchObject({
      environment: 'test',
      registrationId: 'registration-test',
    });
    expect(readSlackInstallationScope(env)?.workspaceHash).toHaveLength(64);
  });
});
