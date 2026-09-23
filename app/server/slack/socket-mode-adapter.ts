import { inspect } from 'node:util';
import type { SocketConnection, SocketConnectionHandlers } from '../lib/socket-lifecycle';
import { hashSlackIdentifier, type SlackRuntimeConfig, type SlackResolvedSecrets } from './config';
import {
  SlackWebApiMessageClient,
  type SlackHttpFetch,
  type SlackHttpResponse,
  type SlackMessageClient,
} from './message-client';

export const SLACK_SOCKET_OPEN_URL = 'https://slack.com/api/apps.connections.open';
export const DEFAULT_SLACK_SOCKET_STARTUP_TIMEOUT_MS = 10_000;
export const DEFAULT_SLACK_SOCKET_MAX_PAYLOAD_BYTES = 1_048_576;

export type SlackSocketFetch = SlackHttpFetch;

interface SlackWebSocketEvent {
  data?: unknown;
}

export interface SlackWebSocketBoundary {
  readonly readyState: number;
  binaryType?: string;
  addEventListener(event: 'open' | 'message' | 'close' | 'error', listener: (event: SlackWebSocketEvent) => void): void;
  removeEventListener(
    event: 'open' | 'message' | 'close' | 'error',
    listener: (event: SlackWebSocketEvent) => void
  ): void;
  send(data: string): void;
  close(code?: number): void;
}

export type SlackWebSocketFactory = (url: string) => SlackWebSocketBoundary;

export interface SlackSocketProtocolDependencies {
  fetch?: SlackSocketFetch;
  webSocketFactory?: SlackWebSocketFactory;
  messageClient?: SlackMessageClient;
  startupTimeoutMs?: number;
  maxPayloadBytes?: number;
}

export class SlackProtocolTransportUnavailableError extends Error {
  constructor(message = 'Slack Socket Mode protocol transport is unavailable.') {
    super(message);
    this.name = 'SlackProtocolTransportUnavailableError';
  }
}

function defaultSocketFetch(url: string, init: Parameters<SlackSocketFetch>[1]): Promise<SlackHttpResponse> {
  if (typeof globalThis.fetch !== 'function') throw new SlackProtocolTransportUnavailableError();
  return globalThis.fetch(url, init) as Promise<SlackHttpResponse>;
}

function defaultWebSocketFactory(url: string): SlackWebSocketBoundary {
  const Constructor = (globalThis as { WebSocket?: new (address: string) => SlackWebSocketBoundary }).WebSocket;
  if (!Constructor) throw new SlackProtocolTransportUnavailableError();
  return new Constructor(url);
}

export function assertSlackProtocolTransportAvailable(): void {
  if (typeof globalThis.fetch !== 'function') throw new SlackProtocolTransportUnavailableError();
  if (!(globalThis as { WebSocket?: unknown }).WebSocket) throw new SlackProtocolTransportUnavailableError();
}

export interface SlackDirectMessageRuntime {
  teamId: string;
  userId: string;
  channelId: string;
  threadId: string;
  messageTimestamp: string;
  prompt: string;
}

export class SafeSlackDirectMessage {
  readonly kind = 'message.im' as const;
  readonly workspaceHash: string;
  readonly eventHash: string;
  readonly userHash: string;
  readonly channelHash: string;
  readonly threadHash: string;
  readonly messageTimestampHash: string;
  readonly #runtime: SlackDirectMessageRuntime;

  constructor(input: {
    workspaceHash: string;
    eventHash: string;
    userHash: string;
    channelHash: string;
    threadHash: string;
    messageTimestampHash: string;
    runtime: SlackDirectMessageRuntime;
  }) {
    this.workspaceHash = input.workspaceHash;
    this.eventHash = input.eventHash;
    this.userHash = input.userHash;
    this.channelHash = input.channelHash;
    this.threadHash = input.threadHash;
    this.messageTimestampHash = input.messageTimestampHash;
    this.#runtime = Object.freeze({ ...input.runtime });
  }

  get prompt(): string {
    return this.#runtime.prompt;
  }

  runtime(): Readonly<SlackDirectMessageRuntime> {
    return this.#runtime;
  }

  toJSON(): Record<string, string> {
    return {
      kind: this.kind,
      workspaceHash: this.workspaceHash,
      eventHash: this.eventHash,
      userHash: this.userHash,
      channelHash: this.channelHash,
      threadHash: this.threadHash,
      messageTimestampHash: this.messageTimestampHash,
    };
  }

  [inspect.custom](): string {
    return `SafeSlackDirectMessage ${inspect(this.toJSON())}`;
  }
}

type ObjectLike = Record<string, unknown>;
function object(value: unknown): ObjectLike | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as ObjectLike) : null;
}

function nonempty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function normalizeSlackDirectMessage(
  input: { body?: unknown; event?: unknown },
  options: { allowedTeamId: string; botUserId?: string | null }
): SafeSlackDirectMessage | null {
  const body = object(input.body);
  const event = object(input.event);
  if (!body || !event) return null;
  const teamId = nonempty(body.team_id);
  if (!teamId || teamId !== options.allowedTeamId) return null;
  if (event.type !== 'message' || event.channel_type !== 'im') return null;
  if (event.subtype !== undefined || event.bot_id !== undefined) return null;
  const eventId = nonempty(body.event_id);
  const userId = nonempty(event.user);
  const channelId = nonempty(event.channel);
  const timestamp = nonempty(event.ts);
  const prompt = nonempty(event.text);
  if (!eventId || !userId || !channelId || !timestamp || !prompt) return null;
  if (options.botUserId && userId === options.botUserId) return null;
  const thread = nonempty(event.thread_ts) ?? timestamp;
  return new SafeSlackDirectMessage({
    workspaceHash: hashSlackIdentifier(teamId),
    eventHash: hashSlackIdentifier(eventId),
    userHash: hashSlackIdentifier(userId),
    channelHash: hashSlackIdentifier(channelId),
    threadHash: hashSlackIdentifier(thread),
    messageTimestampHash: hashSlackIdentifier(timestamp),
    runtime: {
      teamId,
      userId,
      channelId,
      threadId: thread,
      messageTimestamp: timestamp,
      prompt,
    },
  });
}

function payloadText(value: unknown, limit: number): string | null {
  if (typeof value === 'string') {
    return new TextEncoder().encode(value).byteLength <= limit ? value : null;
  }
  if (value instanceof ArrayBuffer) {
    return value.byteLength <= limit ? new TextDecoder().decode(value) : null;
  }
  if (ArrayBuffer.isView(value)) {
    return value.byteLength <= limit
      ? new TextDecoder().decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
      : null;
  }
  return null;
}

async function responseObject(
  response: Awaited<ReturnType<SlackHttpFetch>>,
  maxBytes = 65_536
): Promise<ObjectLike | null> {
  const source = await response.text();
  if (new TextEncoder().encode(source).byteLength > maxBytes) return null;
  try {
    return object(JSON.parse(source) as unknown);
  } catch {
    return null;
  }
}

export class SlackSocketModeConnection implements SocketConnection {
  readonly #secrets: SlackResolvedSecrets;
  readonly #fetch: SlackSocketFetch;
  readonly #webSocketFactory: SlackWebSocketFactory;
  readonly #messageClient: SlackMessageClient;
  readonly #startupTimeoutMs: number;
  readonly #maxPayloadBytes: number;
  readonly #pendingAcks = new Set<string>();
  #handlers: SocketConnectionHandlers | null = null;
  #socket: SlackWebSocketBoundary | null = null;
  #startupTimer: ReturnType<typeof setTimeout> | null = null;
  #startupResolve: (() => void) | null = null;
  #startupReject: ((error: Error) => void) | null = null;
  #opened = false;
  #hello = false;
  #started = false;
  #stopping = false;
  #signalSent = false;

  readonly #onOpen = () => {
    this.#opened = true;
    this.#settleStartup();
  };

  readonly #onMessage = (event: SlackWebSocketEvent) => {
    const source = payloadText(event.data, this.#maxPayloadBytes);
    if (!source) return;
    let parsed: ObjectLike | null = null;
    try {
      parsed = object(JSON.parse(source) as unknown);
    } catch {
      return;
    }
    if (!parsed) return;
    const type = nonempty(parsed.type);
    if (type === 'hello') {
      this.#hello = true;
      this.#settleStartup();
      return;
    }
    if (type === 'disconnect') {
      const reason = nonempty(parsed.reason);
      if (reason === 'warning' || reason === 'refresh_requested') this.#signalRefresh();
      else this.#signalDisconnect();
      return;
    }
    if (type !== 'events_api') return;
    const envelopeId = nonempty(parsed.envelope_id);
    const payload = object(parsed.payload);
    if (!envelopeId || !payload || !this.#handlers) return;
    this.#pendingAcks.add(envelopeId);
    void this.#handlers.onEnvelope({ id: envelopeId, payload }).catch(() => undefined);
  };

  readonly #onClose = () => {
    if (!this.#started) {
      this.#abortStartup();
      return;
    }
    this.#signalDisconnect();
  };

  readonly #onError = () => {
    if (!this.#started) {
      this.#abortStartup();
      return;
    }
    this.#signalDisconnect();
  };

  constructor(
    _config: SlackRuntimeConfig,
    secrets: SlackResolvedSecrets,
    dependencies: SlackSocketProtocolDependencies = {}
  ) {
    this.#secrets = secrets;
    this.#fetch = dependencies.fetch ?? defaultSocketFetch;
    this.#webSocketFactory = dependencies.webSocketFactory ?? defaultWebSocketFactory;
    this.#messageClient =
      dependencies.messageClient ?? new SlackWebApiMessageClient(secrets.botToken, dependencies.fetch);
    this.#startupTimeoutMs = Math.max(1, dependencies.startupTimeoutMs ?? DEFAULT_SLACK_SOCKET_STARTUP_TIMEOUT_MS);
    this.#maxPayloadBytes = Math.max(1, dependencies.maxPayloadBytes ?? DEFAULT_SLACK_SOCKET_MAX_PAYLOAD_BYTES);
  }

  messageClient(): SlackMessageClient {
    return this.#messageClient;
  }

  async start(handlers: SocketConnectionHandlers): Promise<void> {
    this.#handlers = handlers;
    this.#stopping = false;
    this.#signalSent = false;
    this.#opened = false;
    this.#hello = false;
    this.#started = false;
    const abort = new AbortController();
    const startup = new Promise<void>((resolve, reject) => {
      this.#startupResolve = resolve;
      this.#startupReject = reject;
      this.#startupTimer = setTimeout(() => {
        abort.abort();
        this.#abortStartup();
      }, this.#startupTimeoutMs);
    });
    void this.#openSocket(abort.signal).catch(() => this.#abortStartup());
    await startup;
    this.#started = true;
  }

  async #openSocket(signal: AbortSignal): Promise<void> {
    const response = await this.#fetch(SLACK_SOCKET_OPEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.#secrets.appToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: '',
      signal,
    });
    const body = await responseObject(response);
    const url = nonempty(body?.url);
    if (!response.ok || body?.ok !== true || !url) throw new SlackProtocolTransportUnavailableError();
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new SlackProtocolTransportUnavailableError();
    }
    if (parsedUrl.protocol !== 'wss:') throw new SlackProtocolTransportUnavailableError();
    const socket = this.#webSocketFactory(parsedUrl.toString());
    this.#socket = socket;
    socket.binaryType = 'arraybuffer';
    this.#addListeners(socket);
    this.#settleStartup();
  }

  acknowledge(envelopeId: string): Promise<void> {
    if (!this.#pendingAcks.delete(envelopeId)) {
      return Promise.reject(new SlackProtocolTransportUnavailableError());
    }
    const socket = this.#socket;
    if (!socket || socket.readyState !== 1) {
      return Promise.reject(new SlackProtocolTransportUnavailableError());
    }
    try {
      socket.send(JSON.stringify({ envelope_id: envelopeId }));
      return Promise.resolve();
    } catch {
      return Promise.reject(new SlackProtocolTransportUnavailableError());
    }
  }

  stop(): Promise<void> {
    this.#stopping = true;
    this.#handlers = null;
    this.#pendingAcks.clear();
    this.#clearStartup();
    const socket = this.#socket;
    this.#socket = null;
    if (!socket) return Promise.resolve();
    this.#removeListeners(socket);
    if (socket.readyState === 0 || socket.readyState === 1) socket.close(1000);
    return Promise.resolve();
  }

  #addListeners(socket: SlackWebSocketBoundary): void {
    socket.addEventListener('open', this.#onOpen);
    socket.addEventListener('message', this.#onMessage);
    socket.addEventListener('close', this.#onClose);
    socket.addEventListener('error', this.#onError);
  }

  #removeListeners(socket: SlackWebSocketBoundary): void {
    socket.removeEventListener('open', this.#onOpen);
    socket.removeEventListener('message', this.#onMessage);
    socket.removeEventListener('close', this.#onClose);
    socket.removeEventListener('error', this.#onError);
  }

  #settleStartup(): void {
    if (!this.#opened || !this.#hello || !this.#startupResolve) return;
    const resolve = this.#startupResolve;
    this.#clearStartup();
    resolve();
  }

  #failStartup(): void {
    if (!this.#startupReject) return;
    const reject = this.#startupReject;
    this.#clearStartup();
    reject(new SlackProtocolTransportUnavailableError());
  }

  #abortStartup(): void {
    const socket = this.#socket;
    this.#socket = null;
    if (socket) {
      this.#removeListeners(socket);
      if (socket.readyState === 0 || socket.readyState === 1) socket.close();
    }
    this.#failStartup();
  }

  #clearStartup(): void {
    if (this.#startupTimer) clearTimeout(this.#startupTimer);
    this.#startupTimer = null;
    this.#startupResolve = null;
    this.#startupReject = null;
  }

  #signalRefresh(): void {
    if (this.#stopping || this.#signalSent || !this.#handlers) return;
    this.#signalSent = true;
    this.#handlers.onRefresh();
  }

  #signalDisconnect(): void {
    if (this.#stopping || this.#signalSent || !this.#handlers) return;
    this.#signalSent = true;
    this.#handlers.onDisconnect();
  }
}

export function createSlackEnvelopeHandler(input: {
  config: SlackRuntimeConfig;
  botUserId?: string | null;
  process(event: SafeSlackDirectMessage): Promise<void>;
}): (envelope: { payload: unknown }) => Promise<void> {
  return async (envelope) => {
    const body = object(envelope.payload);
    if (!body) return;
    const event = normalizeSlackDirectMessage(
      { body, event: body.event },
      { allowedTeamId: input.config.allowedTeamId, botUserId: input.botUserId }
    );
    if (event) await input.process(event);
  };
}
