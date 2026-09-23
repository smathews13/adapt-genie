export interface SocketEnvelope {
  id: string;
  payload: unknown;
}

export interface SocketConnectionHandlers {
  onEnvelope(envelope: SocketEnvelope): Promise<void>;
  onRefresh(): void;
  onDisconnect(): void;
}

/** Minimal transport port; a later Slack adapter may implement it with any SDK. */
export interface SocketConnection {
  start(handlers: SocketConnectionHandlers): Promise<void>;
  acknowledge(envelopeId: string): Promise<void>;
  stop(): Promise<void>;
}

export type SocketConnectionFactory = () => SocketConnection;
export type SocketEnvelopeHandler = (envelope: SocketEnvelope) => Promise<void>;

export interface SocketLifecycleOptions {
  initialBackoffMs?: number;
  maxBackoffMs?: number;
}

/**
 * Owns one transport-neutral socket connection and its reconnect lifecycle.
 *
 * Connection replacement is serialized: the old connection is stopped before
 * a timer may create its successor.
 */
export class SocketLifecycleController {
  readonly #createConnection: SocketConnectionFactory;
  readonly #handleEnvelope: SocketEnvelopeHandler;
  readonly #initialBackoffMs: number;
  readonly #maxBackoffMs: number;
  #connection: SocketConnection | null = null;
  #running = false;
  #connecting: Promise<void> | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #attempt = 0;

  constructor(
    createConnection: SocketConnectionFactory,
    handleEnvelope: SocketEnvelopeHandler,
    options: SocketLifecycleOptions = {}
  ) {
    this.#createConnection = createConnection;
    this.#handleEnvelope = handleEnvelope;
    this.#initialBackoffMs = Math.max(1, options.initialBackoffMs ?? 250);
    this.#maxBackoffMs = Math.max(this.#initialBackoffMs, options.maxBackoffMs ?? 10_000);
  }

  async start(): Promise<void> {
    if (this.#running) {
      await this.#connecting;
      return;
    }
    this.#running = true;
    await this.#connect();
  }

  /** Whether the initial/current transport has opened successfully. */
  isConnected(): boolean {
    return this.#running && this.#connection !== null && this.#connecting === null;
  }

  async stop(): Promise<void> {
    this.#running = false;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    const connection = this.#connection;
    this.#connection = null;
    if (connection) await connection.stop();
    await this.#connecting;
  }

  async #connect(): Promise<void> {
    if (!this.#running || this.#connecting || this.#connection) return;
    const operation = this.#openConnection();
    this.#connecting = operation;
    try {
      await operation;
    } finally {
      if (this.#connecting === operation) this.#connecting = null;
    }
  }

  async #openConnection(): Promise<void> {
    const connection = this.#createConnection();
    this.#connection = connection;
    try {
      await connection.start({
        onEnvelope: async (envelope) => {
          await connection.acknowledge(envelope.id);
          await this.#handleEnvelope(envelope);
        },
        onRefresh: () => void this.#replace(connection),
        onDisconnect: () => void this.#replace(connection),
      });
      this.#attempt = 0;
    } catch {
      if (this.#connection === connection) this.#connection = null;
      await connection.stop().catch(() => undefined);
      this.#scheduleReconnect();
    }
  }

  async #replace(connection: SocketConnection): Promise<void> {
    if (!this.#running || this.#connection !== connection) return;
    this.#connection = null;
    await connection.stop().catch(() => undefined);
    this.#scheduleReconnect();
  }

  #scheduleReconnect(): void {
    if (!this.#running || this.#reconnectTimer) return;
    const delay = Math.min(this.#initialBackoffMs * 2 ** this.#attempt, this.#maxBackoffMs);
    this.#attempt += 1;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      void this.#connect();
    }, delay);
  }
}
