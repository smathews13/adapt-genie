import { describe, expect, it, vi } from 'vitest';
import type { RunEnvelope } from '../../shared/channel/run-contracts';
import { SafeSlackDirectMessage } from './socket-mode-adapter';
import { SlackDeliveryService } from './delivery-service';
import { SlackMessageTransportError } from './message-client';
import type { SlackDelivery } from './state-store';

const event = new SafeSlackDirectMessage({
  workspaceHash: 'w',
  eventHash: 'e',
  userHash: 'u',
  channelHash: 'c',
  threadHash: 't',
  messageTimestampHash: 'm',
  runtime: {
    teamId: 'TTEAM',
    userId: 'UUSER',
    channelId: 'DCHANNEL',
    threadId: '123.456',
    messageTimestamp: '123.456',
    prompt: 'must remain memory only',
  },
});

const delivery: SlackDelivery = {
  deliveryId: 'delivery-1',
  runId: 'run-1',
  channelHash: 'c',
  threadHash: 't',
  status: 'pending',
  deliveryKind: 'run',
  deliveryState: 'progress_sent',
  safeErrorClass: null,
  messageId: null,
  attemptCount: 0,
  revision: 2,
};

const complete: RunEnvelope = {
  schemaVersion: 1,
  runId: 'run-1',
  conversationId: 'conversation-1',
  state: 'complete',
  createdAt: '2026-09-21T20:00:00.000Z',
  updatedAt: '2026-09-21T20:01:00.000Z',
  correlationId: null,
  answer: {
    takeaway: 'Complete',
    narrative: 'A concise answer.',
    content: '',
    figures: [],
    charts: [],
    sources: [],
    caveats: [],
    derivation: [],
    sql: '',
    traceLink: null,
  },
  clarification: null,
  blocked: null,
  error: null,
};

describe('Slack delivery service', () => {
  it('honors Retry-After, preserves the DM thread, and retries a completed envelope without rerunning', async () => {
    const postMessage = vi
      .fn()
      .mockRejectedValueOnce(new SlackMessageTransportError('ratelimited', 2, true))
      .mockResolvedValueOnce({ messageId: '124.000' });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          ...delivery,
          delivery_id: delivery.deliveryId,
          run_id: delivery.runId,
          channel_hash: delivery.channelHash,
          thread_hash: delivery.threadHash,
          delivery_kind: delivery.deliveryKind,
          delivery_state: 'final_sent',
          safe_error_class: null,
          message_id: '124.000',
          attempt_count: 1,
          revision: 3,
          status: 'sent',
        },
      ],
    });
    const get = vi.fn().mockResolvedValue(complete);
    const service = new SlackDeliveryService(
      { query },
      { postMessage },
      { get },
      vi.fn(),
      (runId) => `https://adapt.example/runs/${runId}`,
      { sleep, maxAttempts: 2, egressPolicy: () => Promise.resolve(true) }
    );
    await service.deliverRun({ delivery, event, owner: 'reader@example.com', initial: complete });
    expect(get).not.toHaveBeenCalled();
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ channel: 'DCHANNEL', threadTs: '123.456' }));
    expect(JSON.stringify(postMessage.mock.calls)).not.toContain('must remain memory only');
    expect(query.mock.calls[0]?.[1]).toContain('run-1');
  });

  it('posts a pre-run link-out with a nullable run id', async () => {
    const postMessage = vi.fn().mockResolvedValue({ messageId: '125.000' });
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          delivery_id: 'blocked-1',
          run_id: null,
          channel_hash: 'c',
          thread_hash: 't',
          status: 'sent',
          delivery_kind: 'link_out',
          delivery_state: 'final_sent',
          safe_error_class: null,
          message_id: '125.000',
          attempt_count: 1,
          revision: 2,
        },
      ],
    });
    const service = new SlackDeliveryService(
      { query },
      { postMessage },
      { get: vi.fn() },
      vi.fn(),
      () => 'https://adapt.example/runs/unused',
      { egressPolicy: () => Promise.resolve(true) }
    );
    await service.deliverLinkOut({
      delivery: { ...delivery, deliveryId: 'blocked-1', runId: null, deliveryKind: 'link_out', revision: 1 },
      event,
      message: 'Sign in.',
      actionUrl: 'https://adapt.example/api/slack/link?state=opaque',
    });
    const params = query.mock.calls[0]?.[1] as unknown[] | undefined;
    expect(params?.[1]).toBeNull();
    expect(JSON.stringify(postMessage.mock.calls)).not.toContain('UUSER');
  });

  it.each([
    ['denied', () => Promise.resolve(false)],
    ['unavailable', () => Promise.reject(new Error('policy store unavailable'))],
  ])('marks Slack delivery blocked when egress is %s and never calls the Web API', async (_case, egressPolicy) => {
    const postMessage = vi.fn();
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          delivery_id: 'delivery-1',
          run_id: 'run-1',
          channel_hash: 'c',
          thread_hash: 't',
          status: 'failed',
          delivery_kind: 'run',
          delivery_state: 'permanent_failed',
          safe_error_class: 'egress_blocked',
          message_id: null,
          attempt_count: 1,
          revision: 3,
        },
      ],
    });
    const service = new SlackDeliveryService(
      { query },
      { postMessage },
      { get: vi.fn() },
      vi.fn(),
      () => 'https://adapt.example/runs/run-1',
      { egressPolicy }
    );
    const result = await service.deliverEnvelope({ delivery, event, envelope: complete });
    expect(postMessage).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'failed', safeErrorClass: 'egress_blocked' });
  });
});
