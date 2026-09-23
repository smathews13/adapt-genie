import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import {
  SLACK_CHAT_POST_MESSAGE_URL,
  SlackMessageTransportError,
  SlackWebApiMessageClient,
  type SlackHttpFetch,
} from './message-client';

function response(input: { status?: number; ok?: boolean; body?: unknown; retryAfter?: string | null }) {
  return {
    status: input.status ?? 200,
    ok: input.ok ?? true,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'retry-after' ? (input.retryAfter ?? null) : null),
    },
    text: () => Promise.resolve(JSON.stringify(input.body ?? { ok: true, ts: '123.456' })),
  };
}

const message = {
  channel: 'D1',
  threadTs: '111.222',
  text: 'Accessible fallback',
  blocks: [{ type: 'section' as const, text: { type: 'mrkdwn' as const, text: 'Answer' } }],
};

describe('scanner-safe Slack Web API protocol client', () => {
  it('posts the exact threaded DM JSON payload with native/injected fetch', async () => {
    const fetch: SlackHttpFetch = vi.fn().mockResolvedValue(response({}));
    const client = new SlackWebApiMessageClient('xoxb-runtime-secret', fetch);
    await expect(client.postMessage(message)).resolves.toEqual({ messageId: '123.456' });
    expect(fetch).toHaveBeenCalledWith(SLACK_CHAT_POST_MESSAGE_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer xoxb-runtime-secret',
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel: 'D1',
        thread_ts: '111.222',
        reply_broadcast: false,
        text: 'Accessible fallback',
        blocks: message.blocks,
      }),
    });
    expect(JSON.stringify(client)).not.toContain('xoxb-runtime-secret');
    expect(inspect(client)).not.toContain('xoxb-runtime-secret');
  });

  it('classifies 429 Retry-After and 5xx responses as transient without reading raw detail', async () => {
    const rateLimited = new SlackWebApiMessageClient(
      'xoxb-secret',
      vi.fn().mockResolvedValue(response({ status: 429, ok: false, retryAfter: '2.5', body: 'raw secret' }))
    );
    await expect(rateLimited.postMessage(message)).rejects.toMatchObject({
      safeErrorClass: 'ratelimited',
      retryAfterSeconds: 2.5,
      transient: true,
    });
    const serverError = new SlackWebApiMessageClient(
      'xoxb-secret',
      vi.fn().mockResolvedValue(response({ status: 503, ok: false, body: { error: 'internal_detail' } }))
    );
    await expect(serverError.postMessage(message)).rejects.toMatchObject({
      safeErrorClass: 'http_503',
      transient: true,
    });
  });

  it('keeps permanent Slack errors and malformed responses typed and redacted', async () => {
    const permanent = new SlackWebApiMessageClient(
      'xoxb-never-log',
      vi.fn().mockResolvedValue(response({ body: { ok: false, error: 'invalid_auth', detail: 'xoxb-never-log' } }))
    );
    const failure = await permanent.postMessage(message).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SlackMessageTransportError);
    expect(failure).toMatchObject({ transient: false, safeErrorClass: 'invalid_auth' });
    expect(JSON.stringify(failure)).not.toContain('xoxb-never-log');
    expect(inspect(failure)).not.toContain('xoxb-never-log');

    const malformed = new SlackWebApiMessageClient(
      'xoxb-secret',
      vi.fn().mockResolvedValue({
        ...response({}),
        text: () => Promise.resolve('{not-json'),
      })
    );
    await expect(malformed.postMessage(message)).rejects.toMatchObject({
      safeErrorClass: 'invalid_response',
      transient: true,
    });
  });

  it('redacts thrown fetch errors even when their messages contain token or payload data', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = new SlackWebApiMessageClient('xoxb-sensitive', () =>
      Promise.reject(new Error('xoxb-sensitive Accessible fallback'))
    );
    const failure = await client.postMessage(message).catch((caught: unknown) => caught);
    expect(failure).toMatchObject({ safeErrorClass: 'transport_error', transient: true });
    expect(JSON.stringify(failure)).not.toMatch(/xoxb-sensitive|Accessible fallback/);
    expect([...info.mock.calls, ...error.mock.calls].flat().join(' ')).not.toMatch(
      /xoxb-sensitive|Accessible fallback/
    );
  });
});
