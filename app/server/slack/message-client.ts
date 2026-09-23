import type { SlackMessage } from '../../shared/channel/slack-message';

export const SLACK_CHAT_POST_MESSAGE_URL = 'https://slack.com/api/chat.postMessage';
export const DEFAULT_SLACK_WEB_API_MAX_RESPONSE_BYTES = 262_144;

export interface SlackPostMessageInput extends SlackMessage {
  channel: string;
  threadTs: string;
}

export interface SlackPostMessageResult {
  messageId: string;
}

export interface SlackMessageClient {
  postMessage(input: SlackPostMessageInput): Promise<SlackPostMessageResult>;
}

export interface SlackHttpResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type SlackHttpFetch = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  }
) => Promise<SlackHttpResponse>;

function defaultSlackFetch(url: string, init: Parameters<SlackHttpFetch>[1]): Promise<SlackHttpResponse> {
  if (typeof globalThis.fetch !== 'function') {
    return Promise.reject(new SlackMessageTransportError('transport_unavailable', null, false));
  }
  return globalThis.fetch(url, init) as Promise<SlackHttpResponse>;
}

export class SlackMessageTransportError extends Error {
  constructor(
    readonly safeErrorClass: string,
    readonly retryAfterSeconds: number | null,
    readonly transient: boolean
  ) {
    super(`Slack message transport failed: ${safeErrorClass}`);
    this.name = 'SlackMessageTransportError';
  }
}

const PERMANENT_ERRORS = new Set([
  'account_inactive',
  'channel_not_found',
  'invalid_auth',
  'is_archived',
  'missing_scope',
  'not_authed',
  'restricted_action',
]);

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeError(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[a-z0-9_]+$/i.test(value) ? value : fallback;
}

function retryAfter(headers: SlackHttpResponse['headers']): number | null {
  const raw = headers.get('retry-after')?.trim() ?? '';
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function responseObject(response: SlackHttpResponse, maxBytes: number): Promise<Record<string, unknown> | null> {
  const source = await response.text();
  if (new TextEncoder().encode(source).byteLength > maxBytes) return null;
  try {
    return object(JSON.parse(source) as unknown);
  } catch {
    return null;
  }
}

/** Scanner-safe Slack Web API protocol client using only injected/native fetch. */
export class SlackWebApiMessageClient implements SlackMessageClient {
  readonly #token: string;
  readonly #fetch: SlackHttpFetch;
  readonly #maxResponseBytes: number;

  constructor(
    token: string,
    fetch: SlackHttpFetch = defaultSlackFetch,
    maxResponseBytes = DEFAULT_SLACK_WEB_API_MAX_RESPONSE_BYTES
  ) {
    this.#token = token;
    this.#fetch = fetch;
    this.#maxResponseBytes = Math.max(1, maxResponseBytes);
  }

  async postMessage(input: SlackPostMessageInput): Promise<SlackPostMessageResult> {
    let response: SlackHttpResponse;
    try {
      response = await this.#fetch(SLACK_CHAT_POST_MESSAGE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          channel: input.channel,
          thread_ts: input.threadTs,
          reply_broadcast: false,
          text: input.text,
          blocks: input.blocks,
        }),
      });
    } catch (error) {
      if (error instanceof SlackMessageTransportError) throw error;
      throw new SlackMessageTransportError('transport_error', null, true);
    }
    const retrySeconds = retryAfter(response.headers);
    if (response.status === 429) throw new SlackMessageTransportError('ratelimited', retrySeconds, true);
    if (response.status >= 500) {
      throw new SlackMessageTransportError(`http_${response.status}`, retrySeconds, true);
    }
    const body = await responseObject(response, this.#maxResponseBytes);
    if (!response.ok) {
      const code = safeError(body?.error, `http_${response.status}`);
      throw new SlackMessageTransportError(code, retrySeconds, false);
    }
    if (body?.ok !== true || typeof body.ts !== 'string' || !body.ts.trim()) {
      const code = safeError(body?.error, 'invalid_response');
      throw new SlackMessageTransportError(code, retrySeconds, !PERMANENT_ERRORS.has(code));
    }
    return { messageId: body.ts };
  }
}
