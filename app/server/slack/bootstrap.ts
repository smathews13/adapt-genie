import { SocketLifecycleController, type SocketConnectionFactory } from '../lib/socket-lifecycle';
import type { LakebaseReader } from '../lib/lakebase-store';
import {
  assertSlackProtocolTransportAvailable,
  createSlackEnvelopeHandler,
  type SafeSlackDirectMessage,
  SlackProtocolTransportUnavailableError,
  SlackSocketModeConnection,
} from './socket-mode-adapter';
import {
  readSlackRuntimeConfig,
  resolveSlackSecrets,
  type SlackRuntimeConfig,
  type SlackResolvedSecrets,
} from './config';
import type { SlackMessageClient } from './message-client';
import { readEffectiveSlackSettings } from './settings-store';

export type SlackReadiness =
  | { ready: true; reason: 'running' }
  | {
      ready: false;
      reason:
        | 'disabled'
        | 'kill_switch'
        | 'invalid_configuration'
        | 'settings_unavailable'
        | 'registration_mismatch'
        | 'secrets_unavailable'
        | 'processor_unavailable'
        | 'broker_unavailable'
        | 'transport_unavailable'
        | 'startup_failed'
        | 'stopped';
    };

export interface SlackBootstrapDependencies {
  readConfig?: () => ReturnType<typeof readSlackRuntimeConfig>;
  resolveSecrets?: (config: SlackRuntimeConfig) => ReturnType<typeof resolveSlackSecrets>;
  assertTransportAvailable?: () => void;
  createConnection?: (config: SlackRuntimeConfig, secrets: SlackResolvedSecrets) => SocketConnectionFactory;
  process?: (event: SafeSlackDirectMessage) => Promise<void>;
  createProcessor?: (
    config: SlackRuntimeConfig,
    secrets: SlackResolvedSecrets,
    client: SlackMessageClient
  ) => (event: SafeSlackDirectMessage) => Promise<unknown>;
  brokerAvailable?: () => boolean;
}

export class SlackAdapterBootstrap {
  readonly #store: LakebaseReader;
  readonly #dependencies: SlackBootstrapDependencies;
  #lifecycle: SocketLifecycleController | null = null;
  #starting: Promise<SlackReadiness> | null = null;
  #readiness: SlackReadiness = { ready: false, reason: 'stopped' };

  constructor(store: LakebaseReader, dependencies: SlackBootstrapDependencies = {}) {
    this.#store = store;
    this.#dependencies = dependencies;
  }

  readiness(): SlackReadiness {
    return this.#readiness;
  }

  start(): Promise<SlackReadiness> {
    if (this.#lifecycle) return Promise.resolve(this.#readiness);
    if (this.#starting) return this.#starting;
    this.#starting = this.#startOnce().finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  async #startOnce(): Promise<SlackReadiness> {
    const configResult = (this.#dependencies.readConfig ?? readSlackRuntimeConfig)();
    if (!configResult.ready) return (this.#readiness = { ready: false, reason: configResult.reason });
    const config = configResult.config;
    const document = await readEffectiveSlackSettings(this.#store);
    if (!document.storeReady) return (this.#readiness = { ready: false, reason: 'settings_unavailable' });
    if (!document.settings.enabled) return (this.#readiness = { ready: false, reason: 'disabled' });
    if (document.settings.killSwitch) return (this.#readiness = { ready: false, reason: 'kill_switch' });
    if (document.settings.allowedRegistrationId !== config.registrationId) {
      return (this.#readiness = { ready: false, reason: 'registration_mismatch' });
    }
    const secretResult = (this.#dependencies.resolveSecrets ?? resolveSlackSecrets)(config);
    if (!secretResult.ready) return (this.#readiness = { ready: false, reason: secretResult.reason });
    if (!this.#dependencies.createConnection) {
      try {
        (this.#dependencies.assertTransportAvailable ?? assertSlackProtocolTransportAvailable)();
      } catch (error) {
        if (error instanceof SlackProtocolTransportUnavailableError) {
          return (this.#readiness = { ready: false, reason: 'transport_unavailable' });
        }
        throw error;
      }
    }
    if (!this.#dependencies.process && !this.#dependencies.createProcessor) {
      return (this.#readiness = { ready: false, reason: 'processor_unavailable' });
    }
    if (this.#dependencies.createProcessor && !this.#dependencies.brokerAvailable?.()) {
      return (this.#readiness = { ready: false, reason: 'broker_unavailable' });
    }
    let process: ((event: SafeSlackDirectMessage) => Promise<unknown>) | undefined = this.#dependencies.process;
    let createConnection: SocketConnectionFactory;
    if (this.#dependencies.createConnection) {
      createConnection = this.#dependencies.createConnection(config, secretResult.secrets);
    } else {
      const connection = new SlackSocketModeConnection(config, secretResult.secrets);
      process =
        process ?? this.#dependencies.createProcessor?.(config, secretResult.secrets, connection.messageClient());
      createConnection = () => connection;
    }
    if (!process) return (this.#readiness = { ready: false, reason: 'processor_unavailable' });
    const lifecycle = new SocketLifecycleController(
      createConnection,
      createSlackEnvelopeHandler({
        config,
        process: async (event) => {
          // Re-read operational state at the event boundary. A kill switch
          // changed after Socket Mode connected must stop the next event before
          // identity resolution or run admission; status remains inspectable.
          const current = await readEffectiveSlackSettings(this.#store);
          if (!current.storeReady) {
            this.#readiness = { ready: false, reason: 'settings_unavailable' };
            return;
          }
          if (!current.settings.enabled) {
            this.#readiness = { ready: false, reason: 'disabled' };
            return;
          }
          if (current.settings.killSwitch) {
            this.#readiness = { ready: false, reason: 'kill_switch' };
            return;
          }
          await process?.(event);
        },
      })
    );
    try {
      await lifecycle.start();
      if (!lifecycle.isConnected()) {
        await lifecycle.stop();
        return (this.#readiness = { ready: false, reason: 'startup_failed' });
      }
      this.#lifecycle = lifecycle;
      return (this.#readiness = { ready: true, reason: 'running' });
    } catch {
      await lifecycle.stop().catch(() => undefined);
      return (this.#readiness = { ready: false, reason: 'startup_failed' });
    }
  }

  async stop(): Promise<void> {
    const lifecycle = this.#lifecycle;
    this.#lifecycle = null;
    await lifecycle?.stop();
    this.#readiness = { ready: false, reason: 'stopped' };
  }
}
