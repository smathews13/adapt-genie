import { afterEach, describe, expect, it, vi } from 'vitest';

import { SocketLifecycleController, type SocketConnection, type SocketConnectionHandlers } from './socket-lifecycle';

class FakeConnection implements SocketConnection {
  handlers: SocketConnectionHandlers | null = null;
  acknowledgements: string[] = [];
  acknowledgementCompletions: string[] = [];
  active = false;
  readonly onActiveChanged: (delta: number) => void;

  constructor(onActiveChanged: (delta: number) => void) {
    this.onActiveChanged = onActiveChanged;
  }

  start(handlers: SocketConnectionHandlers): Promise<void> {
    this.handlers = handlers;
    this.active = true;
    this.onActiveChanged(1);
    return Promise.resolve();
  }

  acknowledge(envelopeId: string): Promise<void> {
    this.acknowledgements.push(envelopeId);
    return Promise.resolve().then(() => {
      this.acknowledgementCompletions.push(envelopeId);
    });
  }

  stop(): Promise<void> {
    if (this.active) {
      this.active = false;
      this.onActiveChanged(-1);
    }
    return Promise.resolve();
  }

  disconnect(): void {
    this.handlers?.onDisconnect();
  }

  refresh(): void {
    this.handlers?.onRefresh();
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Socket lifecycle controller', () => {
  it('handles and acknowledges envelopes through the injected transport', async () => {
    const handled: string[] = [];
    const connections: FakeConnection[] = [];
    const controller = new SocketLifecycleController(
      () => {
        const connection = new FakeConnection(() => undefined);
        connections.push(connection);
        return connection;
      },
      (envelope) => {
        handled.push(envelope.id);
        return Promise.resolve();
      }
    );

    await controller.start();
    await connections[0]?.handlers?.onEnvelope({ id: 'envelope-1', payload: { type: 'event' } });

    expect(handled).toEqual(['envelope-1']);
    expect(connections[0]?.acknowledgements).toEqual(['envelope-1']);
    await controller.stop();
  });

  it('completes acknowledgement before slow envelope handling finishes', async () => {
    const connections: FakeConnection[] = [];
    let releaseHandler: (() => void) | undefined;
    let handlerStarted = false;
    let handlingFinished = false;
    const blockedHandler = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const controller = new SocketLifecycleController(
      () => {
        const connection = new FakeConnection(() => undefined);
        connections.push(connection);
        return connection;
      },
      async () => {
        handlerStarted = true;
        await blockedHandler;
        handlingFinished = true;
      }
    );

    await controller.start();
    const envelopeWork = connections[0]?.handlers?.onEnvelope({ id: 'slow-envelope', payload: {} });
    await Promise.resolve();
    await Promise.resolve();

    expect(connections[0]?.acknowledgementCompletions).toEqual(['slow-envelope']);
    expect(handlerStarted).toBe(true);
    expect(handlingFinished).toBe(false);

    releaseHandler?.();
    await envelopeWork;
    expect(handlingFinished).toBe(true);
    await controller.stop();
  });

  it.each(['disconnect', 'refresh'] as const)(
    'reconnects after %s with at most one active connection',
    async (event) => {
      vi.useFakeTimers();
      const connections: FakeConnection[] = [];
      let active = 0;
      let maxActive = 0;
      const controller = new SocketLifecycleController(
        () => {
          const connection = new FakeConnection((delta) => {
            active += delta;
            maxActive = Math.max(maxActive, active);
          });
          connections.push(connection);
          return connection;
        },
        () => Promise.resolve(),
        { initialBackoffMs: 10, maxBackoffMs: 20 }
      );

      await controller.start();
      connections[0]?.[event]();
      await vi.advanceTimersByTimeAsync(9);
      expect(connections).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);

      expect(connections).toHaveLength(2);
      expect(active).toBe(1);
      expect(maxActive).toBe(1);
      await controller.stop();
      expect(active).toBe(0);
    }
  );

  it('cancels a pending reconnect on stop', async () => {
    vi.useFakeTimers();
    const connections: FakeConnection[] = [];
    const controller = new SocketLifecycleController(
      () => {
        const connection = new FakeConnection(() => undefined);
        connections.push(connection);
        return connection;
      },
      () => Promise.resolve(),
      { initialBackoffMs: 10, maxBackoffMs: 20 }
    );

    await controller.start();
    connections[0]?.disconnect();
    await Promise.resolve();
    await controller.stop();
    await vi.advanceTimersByTimeAsync(100);

    expect(connections).toHaveLength(1);
    expect(connections[0]?.active).toBe(false);
  });
});
