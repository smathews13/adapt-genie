import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout, timedOutMessage } from './fetch-timeout';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchWithTimeout', () => {
  it('rejects with a readable sentence, never the raw abort reason, when the transport aborts', async () => {
    // A transport that honours the signal rejects exactly the way the watchlist
    // rail was surfacing verbatim: "signal is aborted without reason".
    vi.stubGlobal(
      'fetch',
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('signal is aborted without reason', 'AbortError'))
          );
        })
    );
    await expect(fetchWithTimeout('/api/watchlist-trends', {}, 20)).rejects.toThrow(timedOutMessage(20));
  });

  it('still settles with the same sentence when a transport ignores the signal', async () => {
    vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
    await expect(fetchWithTimeout('/api/watchlist-trends', {}, 20)).rejects.toThrow(timedOutMessage(20));
  });

  it('passes a fast answer straight through', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('ok', { status: 200 })));
    const response = await fetchWithTimeout('/api/watchlist-trends', {}, 5_000);
    expect(response.status).toBe(200);
  });
});
