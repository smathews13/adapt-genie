import { describe, expect, it, vi } from 'vitest';
import type { SocketConnection } from '../lib/socket-lifecycle';
import { DEFAULT_SLACK_OPERATIONAL_SETTINGS } from '../../shared/slack-settings';
import { SlackAdapterBootstrap } from './bootstrap';
import { SlackProtocolTransportUnavailableError } from './socket-mode-adapter';
import type { SlackRuntimeConfig } from './config';

const config: SlackRuntimeConfig = {
  environment: 'test',
  enabled: true,
  killSwitch: false,
  allowedTeamId: 'TALLOWED',
  allowedTeamHash: 'hash',
  databricksWorkspaceHost: 'https://example.cloud.databricks.com',
  oauthExpectedAudience: 'adapt',
  oauthClientId: 'oauth-client',
  oauthCallbackUrl: 'https://adapt.example/api/slack/oauth/callback',
  publicBaseUrl: 'https://adapt.example',
  tokenBrokerRef: 'broker-registration',
  appTokenSecretRef: 'APP_TOKEN',
  botTokenSecretRef: 'BOT_TOKEN',
  clientSecretRef: 'CLIENT_SECRET',
  signingSecretRef: 'SIGNING_SECRET',
  registrationId: 'test-registration',
  testRegistrationId: 'test-registration',
  productionRegistrationId: 'production-registration',
  caps: {
    globalConcurrency: 1,
    workspaceConcurrency: 1,
    userConcurrency: 1,
    conversationConcurrency: 1,
    globalPerMinute: 1,
    workspacePerMinute: 1,
    userPerMinute: 1,
    conversationPerMinute: 1,
  },
};

function store(settings = { ...DEFAULT_SLACK_OPERATIONAL_SETTINGS, enabled: true, killSwitch: false }) {
  return {
    lakebase: {
      query: vi.fn().mockResolvedValue({
        rows: [{ settings: { ...settings, allowedRegistrationId: 'test-registration' }, revision: 1 }],
      }),
    },
  };
}

function connection(start = vi.fn().mockResolvedValue(undefined)) {
  const stop = vi.fn().mockResolvedValue(undefined);
  const socket: SocketConnection = {
    start,
    acknowledge: vi.fn().mockResolvedValue(undefined),
    stop,
  };
  return { socket, stop };
}

describe('Slack adapter bootstrap', () => {
  it.each([
    [{ ready: false as const, reason: 'disabled' as const, detail: '' }, 'disabled'],
    [{ ready: false as const, reason: 'kill_switch' as const, detail: '' }, 'kill_switch'],
  ])('does not open a socket when configuration is %s', async (configResult, reason) => {
    const createConnection = vi.fn();
    const bootstrap = new SlackAdapterBootstrap(store(), {
      readConfig: () => configResult,
      createConnection,
      process: vi.fn(),
    });
    await expect(bootstrap.start()).resolves.toEqual({ ready: false, reason });
    expect(createConnection).not.toHaveBeenCalled();
  });

  it('opens at most one connection and stops it', async () => {
    const { socket, stop } = connection();
    const factory = vi.fn(() => socket);
    const bootstrap = new SlackAdapterBootstrap(store(), {
      readConfig: () => ({ ready: true, config }),
      resolveSecrets: () => ({ ready: true, secrets: { appToken: 'xapp-secret', botToken: 'xoxb-secret' } }),
      createConnection: () => factory,
      process: vi.fn().mockResolvedValue(undefined),
    });
    await Promise.all([bootstrap.start(), bootstrap.start()]);
    expect(factory).toHaveBeenCalledOnce();
    await bootstrap.stop();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('keeps readiness false without a processor or when socket startup fails', async () => {
    const base = {
      readConfig: () => ({ ready: true as const, config }),
      resolveSecrets: () => ({ ready: true as const, secrets: { appToken: 'xapp-secret', botToken: 'xoxb-secret' } }),
    };
    await expect(
      new SlackAdapterBootstrap(store(), {
        ...base,
        createConnection: () => () => connection().socket,
      }).start()
    ).resolves.toEqual({
      ready: false,
      reason: 'processor_unavailable',
    });
    const bootstrap = new SlackAdapterBootstrap(store(), {
      ...base,
      process: vi.fn().mockResolvedValue(undefined),
      createConnection: () => () => connection(vi.fn().mockRejectedValue(new Error('socket refused'))).socket,
    });
    await expect(bootstrap.start()).resolves.toEqual({ ready: false, reason: 'startup_failed' });
  });

  it('reports a missing native Slack protocol transport as unavailable', async () => {
    const bootstrap = new SlackAdapterBootstrap(store(), {
      readConfig: () => ({ ready: true, config }),
      resolveSecrets: () => ({ ready: true, secrets: { appToken: 'xapp-secret', botToken: 'xoxb-secret' } }),
      assertTransportAvailable: () => {
        throw new SlackProtocolTransportUnavailableError();
      },
      process: vi.fn().mockResolvedValue(undefined),
    });
    await expect(bootstrap.start()).resolves.toEqual({ ready: false, reason: 'transport_unavailable' });
  });

  it('keeps readiness false when the delegated-token broker is unavailable', async () => {
    const bootstrap = new SlackAdapterBootstrap(store(), {
      readConfig: () => ({ ready: true, config }),
      resolveSecrets: () => ({ ready: true, secrets: { appToken: 'xapp-secret', botToken: 'xoxb-secret' } }),
      assertTransportAvailable: () => undefined,
      createProcessor: () => vi.fn(),
      brokerAvailable: () => false,
    });
    await expect(bootstrap.start()).resolves.toEqual({ ready: false, reason: 'broker_unavailable' });
  });

  it('blocks the next event when the live kill switch turns on while keeping status inspectable', async () => {
    let handlers: Parameters<SocketConnection['start']>[0] | undefined;
    let killSwitch = false;
    const settingsStore = {
      lakebase: {
        query: vi.fn().mockImplementation(() =>
          Promise.resolve({
            rows: [
              {
                settings: {
                  ...DEFAULT_SLACK_OPERATIONAL_SETTINGS,
                  enabled: true,
                  killSwitch,
                  allowedRegistrationId: 'test-registration',
                },
                revision: killSwitch ? 2 : 1,
              },
            ],
          })
        ),
      },
    };
    const socket: SocketConnection = {
      start: vi.fn().mockImplementation((value: Parameters<SocketConnection['start']>[0]) => {
        handlers = value;
        return Promise.resolve();
      }),
      acknowledge: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const process = vi.fn();
    const bootstrap = new SlackAdapterBootstrap(settingsStore, {
      readConfig: () => ({ ready: true, config }),
      resolveSecrets: () => ({ ready: true, secrets: { appToken: 'xapp-secret', botToken: 'xoxb-secret' } }),
      createConnection: () => () => socket,
      process,
    });
    await expect(bootstrap.start()).resolves.toEqual({ ready: true, reason: 'running' });
    killSwitch = true;
    await handlers?.onEnvelope({
      id: 'Ev01',
      payload: {
        team_id: 'TALLOWED',
        event_id: 'Ev01',
        event: {
          type: 'message',
          channel_type: 'im',
          user: 'U01',
          channel: 'D01',
          ts: '123.456',
          text: 'must not run',
        },
      },
    });
    expect(process).not.toHaveBeenCalled();
    expect(bootstrap.readiness()).toEqual({ ready: false, reason: 'kill_switch' });
  });
});
