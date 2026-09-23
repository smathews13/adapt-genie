import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SocketLifecycleController } from '../lib/socket-lifecycle';
import type { SlackRuntimeConfig } from './config';
import {
  normalizeSlackDirectMessage,
  SLACK_SOCKET_OPEN_URL,
  SlackProtocolTransportUnavailableError,
  SlackSocketModeConnection,
  type SlackSocketFetch,
  type SlackWebSocketBoundary,
} from './socket-mode-adapter';

const config: SlackRuntimeConfig = {
  environment: 'test',
  enabled: true,
  killSwitch: false,
  allowedTeamId: 'TALLOWED',
  allowedTeamHash: 'workspace-hash',
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
    globalConcurrency: 2,
    workspaceConcurrency: 2,
    userConcurrency: 1,
    conversationConcurrency: 1,
    globalPerMinute: 10,
    workspacePerMinute: 10,
    userPerMinute: 5,
    conversationPerMinute: 5,
  },
};

function directMessage(overrides: Record<string, unknown> = {}) {
  return {
    team_id: 'TALLOWED',
    event_id: 'Ev01',
    event: {
      type: 'message',
      channel_type: 'im',
      user: 'U01',
      channel: 'D01',
      ts: '123.456',
      text: 'safe in-memory prompt',
      ...overrides,
    },
  };
}

class FakeWebSocket implements SlackWebSocketBoundary {
  readyState = 0;
  binaryType = '';
  readonly sent: string[] = [];
  readonly close = vi.fn((code?: number) => {
    void code;
    this.readyState = 3;
  });
  readonly #listeners = new Map<string, Set<(event: { data?: unknown }) => void>>();

  addEventListener(event: string, listener: (event: { data?: unknown }) => void): void {
    const listeners = this.#listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(event, listeners);
  }

  removeEventListener(event: string, listener: (event: { data?: unknown }) => void): void {
    this.#listeners.get(event)?.delete(listener);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  emit(event: 'open' | 'message' | 'close' | 'error', data?: unknown): void {
    if (event === 'open') this.readyState = 1;
    if (event === 'close') this.readyState = 3;
    for (const listener of this.#listeners.get(event) ?? []) listener({ data });
  }
}

function socketOpenFetch(url = 'wss://socket.example/opaque'): SlackSocketFetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify({ ok: true, url })),
  });
}

function connection(options: { fetch?: SlackSocketFetch; maxPayloadBytes?: number; startupTimeoutMs?: number } = {}) {
  const sockets: FakeWebSocket[] = [];
  const fetch = options.fetch ?? socketOpenFetch();
  const instance = new SlackSocketModeConnection(
    config,
    { appToken: 'xapp-runtime-secret', botToken: 'xoxb-runtime-secret' },
    {
      fetch,
      maxPayloadBytes: options.maxPayloadBytes,
      startupTimeoutMs: options.startupTimeoutMs,
      webSocketFactory: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
      messageClient: { postMessage: vi.fn() },
    }
  );
  return { instance, sockets, fetch };
}

async function startConnection(
  instance: SlackSocketModeConnection,
  sockets: FakeWebSocket[],
  handlers = {
    onEnvelope: vi.fn().mockResolvedValue(undefined),
    onRefresh: vi.fn(),
    onDisconnect: vi.fn(),
  }
) {
  const started = instance.start(handlers);
  await vi.waitFor(() => expect(sockets).toHaveLength(1));
  sockets[0]?.emit('open');
  sockets[0]?.emit('message', JSON.stringify({ type: 'hello' }));
  await started;
  return handlers;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('scanner-safe Slack Socket Mode protocol', () => {
  it('normalizes only allowed-team human DMs and redacts raw ids and prompts', () => {
    const normalized = normalizeSlackDirectMessage(
      { body: directMessage(), event: directMessage().event },
      { allowedTeamId: 'TALLOWED', botUserId: 'UBOT' }
    );
    expect(normalized).toMatchObject({ kind: 'message.im', prompt: 'safe in-memory prompt' });
    expect(normalized?.workspaceHash).toHaveLength(64);
    expect(JSON.stringify(normalized)).not.toMatch(/TALLOWED|U01|D01|safe in-memory prompt/);
    expect(inspect(normalized)).not.toMatch(/TALLOWED|safe in-memory prompt/);
    expect(normalized?.runtime()).toMatchObject({ teamId: 'TALLOWED', userId: 'U01', channelId: 'D01' });
    expect(
      normalizeSlackDirectMessage(
        { body: { ...directMessage(), team_id: 'TOTHER' }, event: directMessage().event },
        { allowedTeamId: 'TALLOWED' }
      )
    ).toBeNull();
    expect(
      normalizeSlackDirectMessage(
        { body: directMessage(), event: { ...directMessage().event, channel_type: 'channel' } },
        { allowedTeamId: 'TALLOWED' }
      )
    ).toBeNull();
  });

  it('opens a Socket Mode URL with bearer auth and waits for open plus hello', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { instance, sockets, fetch } = connection();
    const started = instance.start({ onEnvelope: vi.fn(), onRefresh: vi.fn(), onDisconnect: vi.fn() });
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    let settled = false;
    void started.then(() => {
      settled = true;
    });
    sockets[0]?.emit('open');
    await Promise.resolve();
    expect(settled).toBe(false);
    sockets[0]?.emit('message', JSON.stringify({ type: 'hello' }));
    await started;
    expect(fetch).toHaveBeenCalledWith(
      SLACK_SOCKET_OPEN_URL,
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer xapp-runtime-secret',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })
    );
    expect(sockets[0]?.binaryType).toBe('arraybuffer');
    expect(JSON.stringify(instance)).not.toMatch(/xapp-runtime-secret|socket\.example/);
    expect([...info.mock.calls, ...warn.mock.calls, ...error.mock.calls].flat().join(' ')).not.toMatch(
      /xapp-runtime-secret|socket\.example/
    );
    await instance.stop();
    expect(sockets[0]?.close).toHaveBeenCalledWith(1000);
  });

  it('ACKs the real envelope id exactly once before processing', async () => {
    const order: string[] = [];
    const { instance, sockets } = connection();
    const controller = new SocketLifecycleController(
      () => instance,
      (envelope) => {
        expect(envelope.payload).toEqual(directMessage());
        order.push('process');
        return Promise.resolve();
      }
    );
    const started = controller.start();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const socket = sockets[0];
    socket?.emit('open');
    socket?.emit('message', JSON.stringify({ type: 'hello' }));
    await started;
    const send = socket?.send.bind(socket);
    if (!socket || !send) throw new Error('socket fixture missing');
    vi.spyOn(socket, 'send').mockImplementation((data) => {
      order.push('ack');
      send(data);
    });
    socket.emit('message', JSON.stringify({ type: 'events_api', envelope_id: 'En01', payload: directMessage() }));
    await vi.waitFor(() => expect(order).toEqual(['ack', 'process']));
    expect(socket.sent).toEqual([JSON.stringify({ envelope_id: 'En01' })]);
    await expect(instance.acknowledge('En01')).rejects.toBeInstanceOf(SlackProtocolTransportUnavailableError);
    expect(socket.sent).toHaveLength(1);
    await controller.stop();
  });

  it('ignores malformed, non-object, unsupported, and oversized payloads without logging them', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { instance, sockets } = connection({ maxPayloadBytes: 128 });
    const handlers = await startConnection(instance, sockets);
    const socket = sockets[0];
    socket?.emit('message', '{secret malformed');
    socket?.emit('message', '[]');
    socket?.emit('message', JSON.stringify({ type: 'commands', envelope_id: 'En02', payload: {} }));
    socket?.emit('message', 'x'.repeat(129));
    await Promise.resolve();
    expect(handlers.onEnvelope).not.toHaveBeenCalled();
    expect(error.mock.calls.flat().join(' ')).not.toContain('secret malformed');
    await instance.stop();
  });

  it.each([
    ['warning', 'refresh'],
    ['refresh_requested', 'refresh'],
    ['link_disabled', 'disconnect'],
  ] as const)('maps disconnect reason %s to lifecycle %s', async (reason, signal) => {
    const { instance, sockets } = connection();
    const handlers = await startConnection(instance, sockets);
    sockets[0]?.emit('message', JSON.stringify({ type: 'disconnect', reason }));
    sockets[0]?.emit('close');
    expect(handlers.onRefresh).toHaveBeenCalledTimes(signal === 'refresh' ? 1 : 0);
    expect(handlers.onDisconnect).toHaveBeenCalledTimes(signal === 'disconnect' ? 1 : 0);
    await instance.stop();
  });

  it('signals close/error once and stop clears listeners and pending ACKs', async () => {
    const { instance, sockets } = connection();
    const handlers = await startConnection(instance, sockets);
    const socket = sockets[0];
    socket?.emit('message', JSON.stringify({ type: 'events_api', envelope_id: 'EnPending', payload: directMessage() }));
    socket?.emit('error');
    socket?.emit('close');
    expect(handlers.onDisconnect).toHaveBeenCalledOnce();
    await instance.stop();
    expect(socket?.close).not.toHaveBeenCalled();
    socket?.emit('close');
    expect(handlers.onDisconnect).toHaveBeenCalledOnce();
    await expect(instance.acknowledge('EnPending')).rejects.toBeInstanceOf(SlackProtocolTransportUnavailableError);
  });

  it('fails startup on timeout, HTTP/API errors, and invalid WebSocket URLs', async () => {
    vi.useFakeTimers();
    const hangingFetch: SlackSocketFetch = vi.fn(
      () => new Promise<Awaited<ReturnType<SlackSocketFetch>>>(() => undefined)
    );
    const timed = connection({ fetch: hangingFetch, startupTimeoutMs: 10 }).instance.start({
      onEnvelope: vi.fn(),
      onRefresh: vi.fn(),
      onDisconnect: vi.fn(),
    });
    const timedExpectation = expect(timed).rejects.toBeInstanceOf(SlackProtocolTransportUnavailableError);
    await vi.advanceTimersByTimeAsync(10);
    await timedExpectation;
    vi.useRealTimers();

    for (const fetch of [
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: { get: () => null },
        text: () => Promise.resolve('{}'),
      }),
      socketOpenFetch('https://not-websocket.example'),
    ]) {
      await expect(
        connection({ fetch }).instance.start({
          onEnvelope: vi.fn(),
          onRefresh: vi.fn(),
          onDisconnect: vi.fn(),
        })
      ).rejects.toBeInstanceOf(SlackProtocolTransportUnavailableError);
    }
  });
});
