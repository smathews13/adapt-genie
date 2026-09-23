import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { RunRequest } from '../../shared/channel/run-contracts';
import type { BoundIdentity } from './identity-binding';
import { GovernedRunService, type GovernedExecutor } from './governed-run-service';

const timestamp = '2026-09-21T20:00:00.000Z';

function runRow(state = 'RUNNING', terminalMessageId: string | null = null, deadlineAt = '2099-09-21T20:04:00.000Z') {
  return {
    run_id: 'run-1',
    user_email: 'reader@example.com',
    conversation_id: 'conversation-1',
    turn_id: 'turn-1',
    request_hash: 'request-hash',
    idempotency_key_hash: 'key-hash',
    plan_fingerprint: null,
    state,
    deadline_at: deadlineAt,
    identity_mode_requested: 'signed_in_user',
    identity_mode_effective: 'signed_in_user',
    identity_verified: true,
    terminal_code: null,
    terminal_message_id: terminalMessageId,
    trace_id: null,
    correlation_id: 'correlation-1',
    fencing_token: 1,
    lease_owner: 'worker:1',
    lease_expires_at: null,
    attempts: 1,
    created_at: timestamp,
    updated_at: timestamp,
    completed_at: state === 'RUNNING' ? null : timestamp,
  };
}

const identity: BoundIdentity = {
  ok: true,
  email: 'reader@example.com',
  token: 'runtime-only',
  verified: true,
  mode: 'signed_in_user',
  requestId: 'run-1',
  correlationId: 'correlation-1',
};

const request: RunRequest = {
  schemaVersion: 1,
  conversationId: 'conversation-1',
  prompt: 'Show current performance.',
  idempotencyKey: 'same-request-1',
};

describe('GovernedRunService', () => {
  it('rejects an unproven identity before storage or execution', async () => {
    const query = vi.fn();
    const executor = vi.fn();
    const service = new GovernedRunService({ lakebase: { query } }, executor);

    await expect(
      service.submit(request, { ...identity, token: '', verified: false, mode: 'app_service_principal' })
    ).rejects.toMatchObject({ status: 401, code: 'bearer_required' });
    expect(query).not.toHaveBeenCalled();
    expect(executor).not.toHaveBeenCalled();
  });

  it('refuses unsafe external context before persistence or execution', async () => {
    const query = vi.fn();
    const executor = vi.fn();
    const service = new GovernedRunService({ lakebase: { query } }, executor);

    await expect(
      service.submit(
        {
          ...request,
          externalContext: { source: 'slack', slack_user_id: 'U123', token: 'secret' },
        } as unknown as RunRequest,
        identity
      )
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    expect(executor).not.toHaveBeenCalled();
  });

  it('fails without hanging when v1 admission metadata cannot be stored', async () => {
    const query = vi.fn().mockRejectedValue(new Error('run_events unavailable'));
    let servingStarted = false;
    const execute: GovernedExecutor = async (_req, _res, overrides) => {
      await overrides?.onAdmitted?.(
        {
          runId: 'run-1',
          userEmail: identity.email,
          conversationId: request.conversationId,
          turnId: 'turn-1',
          requestHash: 'request-hash',
          idempotencyKeyHash: 'key-hash',
          planFingerprint: null,
          state: 'RECEIVED',
          deadlineAt: '2099-09-21T20:04:00.000Z',
          identityModeRequested: 'signed_in_user',
          identityModeEffective: null,
          identityVerified: null,
          terminalCode: null,
          terminalMessageId: null,
          traceId: null,
          correlationId: identity.correlationId,
          fencingToken: 1,
          leaseOwner: 'worker:1',
          leaseExpiresAt: null,
          attempts: 1,
        },
        identity.requestId
      );
      servingStarted = true;
    };
    const service = new GovernedRunService({ lakebase: { query } }, execute);

    await expect(service.submit(request, identity)).rejects.toMatchObject({
      status: 503,
      code: 'persistence_unavailable',
    });
    expect(servingStarted).toBe(false);
  });

  it('routes browser and v1 work through the same executor', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [runRow()] });
    const execute: GovernedExecutor = async (_req, _res, overrides) => {
      await overrides?.onAdmitted?.(
        {
          runId: 'run-1',
          userEmail: identity.email,
          conversationId: request.conversationId,
          turnId: 'turn-1',
          requestHash: 'request-hash',
          idempotencyKeyHash: 'key-hash',
          planFingerprint: null,
          state: 'RUNNING',
          deadlineAt: '2026-09-21T20:04:00.000Z',
          identityModeRequested: 'signed_in_user',
          identityModeEffective: 'signed_in_user',
          identityVerified: true,
          terminalCode: null,
          terminalMessageId: null,
          traceId: null,
          correlationId: identity.correlationId,
          fencingToken: 1,
          leaseOwner: 'worker:1',
          leaseExpiresAt: null,
          attempts: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
          completedAt: null,
        },
        identity.requestId
      );
    };
    const executor = vi.fn(execute);
    const service = new GovernedRunService({ lakebase: { query } }, executor);
    const req = {} as Request;
    const res = {} as Response;

    await service.executeBrowser(req, res);
    const admitted = await service.submit(request, identity);

    expect(admitted.state).toBe('running');
    expect(executor).toHaveBeenNthCalledWith(1, req, res);
    const channelRequest = executor.mock.calls[1]?.[0];
    expect(channelRequest).toMatchObject({ source: 'channel' });
    expect(channelRequest?.header('x-forwarded-email')).toBe(identity.email);
    expect(channelRequest?.header('x-request-id')).toBe(identity.requestId);
    expect(channelRequest).not.toHaveProperty('body');
    expect(executor.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({
        identity,
        idempotencyKey: request.idempotencyKey,
        runLedgerMode: 'enforce',
        budgetContext: { source: 'channel', correlationId: identity.correlationId },
      })
    );
  });

  it('maps plan approval and clarification into first-class public states', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [runRow('AWAITING_APPROVAL')] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [runRow('CLARIFICATION_REQUIRED', 'msg-1')] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            response_json: {
              type: 'clarification',
              clarification: { question: 'Which season?', options: ['2025', '2026'] },
            },
            created_at: timestamp,
          },
        ],
      });
    const service = new GovernedRunService({ lakebase: { query } }, vi.fn());

    const blocked = await service.get('run-1', identity.email);
    const clarification = await service.get('run-1', identity.email);

    expect(blocked?.state).toBe('blocked');
    expect(blocked?.blocked?.code).toBe('PLAN_APPROVAL_REQUIRED');
    expect(blocked?.blocked?.link).toContain('conversation-1');
    expect(blocked?.answer).toBeNull();
    expect(clarification).toMatchObject({
      state: 'clarification_required',
      clarification: { question: 'Which season?', choices: ['2025', '2026'] },
      answer: null,
    });
  });

  it('expires a v1 plan that was not approved before its deadline', async () => {
    const expired = {
      ...runRow('DEADLINE_EXCEEDED'),
      terminal_code: 'RUN_DEADLINE_EXCEEDED',
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [runRow('AWAITING_APPROVAL', null, '2020-01-01T00:00:00.000Z')] })
      .mockResolvedValueOnce({ rows: [expired] })
      .mockResolvedValueOnce({ rows: [] });
    const service = new GovernedRunService({ lakebase: { query } }, vi.fn());

    const result = await service.get('run-1', identity.email);

    expect(result).toMatchObject({
      state: 'expired',
      answer: null,
      error: { code: 'RUN_DEADLINE_EXCEEDED' },
    });
    expect(query.mock.calls[1]?.[0]).toContain("state = 'DEADLINE_EXCEEDED'");
  });

  it('sweeps marked v1 plans after a process restart', async () => {
    vi.useFakeTimers();
    try {
      const query = vi.fn().mockResolvedValue({ rows: [{ run_id: 'run-1' }] });
      const service = new GovernedRunService({ lakebase: { query } }, vi.fn());
      const stop = service.startPlanExpirySweep(1_000);

      await vi.advanceTimersByTimeAsync(1_000);

      expect(query).toHaveBeenCalledWith(expect.stringContaining('e.event_type = $1'), ['v1_admission']);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads only validated durable external correlation context', async () => {
    const externalContext = {
      source: 'slack' as const,
      slackWorkspaceIdHash: 'a'.repeat(64),
      slackEventIdHash: 'b'.repeat(64),
      reference: 'event:01',
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [runRow()] })
      .mockResolvedValueOnce({ rows: [{ payload: JSON.stringify(externalContext) }] });
    const service = new GovernedRunService({ lakebase: { query } }, vi.fn());

    const result = await service.get('run-1', identity.email);

    expect(result?.externalContext).toEqual(externalContext);
  });

  it('returns the durable terminal answer without inventing evidence', async () => {
    const response = {
      takeaway: 'Revenue improved.',
      narrative: 'Revenue increased in the governed period.',
      content: 'Revenue increased in the governed period.',
      figures: [{ label: 'Revenue', value: 12, display: '$12M', comparison: '+5%' }],
      charts: [],
      sources: [{ name: 'main.analytics.revenue', freshness: '2026-09-20' }],
      caveats: ['The latest day is partial.'],
      derivation: [{ source: 'revenue', metric: 'sum(amount)', window: '30d', filter: 'status=booked' }],
      sql: 'SELECT SUM(amount) FROM main.analytics.revenue',
      trace: { id: 'tr-1' },
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [runRow('SUCCEEDED', 'msg-1')] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ response_json: response, created_at: timestamp }] });
    const service = new GovernedRunService({ lakebase: { query } }, vi.fn());

    const complete = await service.get('run-1', identity.email);

    expect(complete).toMatchObject({
      state: 'complete',
      answer: {
        takeaway: 'Revenue improved.',
        sql: response.sql,
        traceLink: '/api/runs/run-1/trace',
      },
      blocked: null,
      error: null,
    });
  });

  it('preserves content and figures on a partial answer', async () => {
    const response = {
      takeaway: 'Three regions completed.',
      narrative: 'One region was unavailable.',
      content: 'Three of four regions returned governed results.',
      figures: [{ label: 'Completed regions', value: 3, display: '3', comparison: 'of 4' }],
      charts: [],
      sources: [{ name: 'main.analytics.regions', freshness: '2026-09-20' }],
      caveats: ['One region is unavailable.'],
      derivation: [{ source: 'regions', metric: 'count(*)', window: 'current', filter: 'complete=true' }],
      sql: 'SELECT COUNT(*) FROM main.analytics.regions WHERE complete',
      trace: { id: 'tr-partial' },
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            ...runRow('PERSISTENCE_FAILED', 'msg-partial'),
            terminal_code: 'PERSISTENCE_UNAVAILABLE',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ response_json: response, created_at: timestamp }] });
    const service = new GovernedRunService({ lakebase: { query } }, vi.fn());

    const partial = await service.get('run-1', identity.email);

    expect(partial).toMatchObject({
      state: 'partial',
      answer: {
        content: response.content,
        figures: response.figures,
      },
      error: { code: 'PERSISTENCE_UNAVAILABLE' },
    });
  });
});
