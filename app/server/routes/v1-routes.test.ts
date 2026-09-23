import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunEnvelope } from '../../shared/channel/run-contracts';
import type { GovernedRunService } from '../lib/governed-run-service';
import { setupV1Routes, type BearerIdentityVerifier } from './v1-routes';

const now = '2026-09-21T20:00:00.000Z';
const envelope: RunEnvelope = {
  schemaVersion: 1,
  runId: 'run-1',
  conversationId: 'conversation-1',
  state: 'running',
  createdAt: now,
  updatedAt: now,
  correlationId: 'correlation-1',
  answer: null,
  clarification: null,
  blocked: null,
  error: null,
};

function service(overrides: Partial<Record<keyof GovernedRunService, unknown>> = {}) {
  return {
    submit: vi.fn().mockResolvedValue(envelope),
    get: vi.fn().mockResolvedValue(envelope),
    events: vi.fn().mockResolvedValue([{ id: 'stage-1' }]),
    cancel: vi.fn().mockResolvedValue('cancelled'),
    feedback: vi.fn().mockResolvedValue('created'),
    ...overrides,
  } as unknown as GovernedRunService;
}

async function start(
  runService: GovernedRunService,
  options: {
    bearerVerifier?: BearerIdentityVerifier | null;
    strictAdmissionReady?: (() => Promise<boolean>) | null;
  } = {}
) {
  const app = express();
  app.use(express.json());
  setupV1Routes(app, {
    service: runService,
    expectedWorkspace: 'https://workspace.example.com',
    expectedAudience: 'adapt-agent',
    bearerVerifier:
      options.bearerVerifier === null
        ? undefined
        : (options.bearerVerifier ??
          (() =>
            Promise.resolve({
              email: 'reader@example.com',
              workspace: 'https://workspace.example.com',
              audience: 'adapt-agent',
            }))),
    servingReady: () => Promise.resolve(true),
    strictAdmissionReady:
      options.strictAdmissionReady === null
        ? undefined
        : (options.strictAdmissionReady ?? (() => Promise.resolve(true))),
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, url: (path: string) => `http://127.0.0.1:${port}${path}` };
}

const auth = {
  Authorization: 'Bearer runtime-only-token',
  'Content-Type': 'application/json',
  'Idempotency-Key': 'same-request-1',
};
let close: (() => Promise<void>) | undefined;

beforeEach(() => {
  delete process.env.DATABRICKS_SERVING_ENDPOINT_NAME;
});

afterEach(async () => {
  await close?.();
  close = undefined;
});

describe('/api/v1 governed run routes', () => {
  it('requires bearer proof and never falls back to an app principal', async () => {
    const app = await start(service());
    close = () => new Promise((resolve) => app.server.close(() => resolve()));
    const response = await fetch(app.url('/api/v1/capabilities'));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'bearer_required' } });
  });

  it('fails closed for an opaque Apps-proxy token', async () => {
    const submit = vi.fn();
    const app = await start(service({ submit }));
    close = () => new Promise((resolve) => app.server.close(() => resolve()));
    const response = await fetch(app.url('/api/v1/runs'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'same-request-1',
        'x-forwarded-email': 'reader@example.com',
        'x-forwarded-access-token': 'opaque-token',
      },
      body: JSON.stringify({
        schemaVersion: 1,
        conversationId: 'conversation-1',
        prompt: 'Show current performance.',
      }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'subject_unverified' } });
    expect(submit).not.toHaveBeenCalled();
  });

  it('does not use SCIM as an audience verifier fallback', async () => {
    const submit = vi.fn();
    const app = await start(service({ submit }), { bearerVerifier: null });
    close = () => new Promise((resolve) => app.server.close(() => resolve()));
    const response = await fetch(app.url('/api/v1/runs'), {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        schemaVersion: 1,
        conversationId: 'conversation-1',
        prompt: 'Show current performance.',
      }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'identity_verifier_unavailable' } });
    expect(submit).not.toHaveBeenCalled();
  });

  it('rejects verifier proof for a different workspace or audience', async () => {
    const submit = vi.fn();
    const app = await start(service({ submit }), {
      bearerVerifier: () =>
        Promise.resolve({
          email: 'reader@example.com',
          workspace: 'https://other-workspace.example.com',
          audience: 'other-audience',
        }),
    });
    close = () => new Promise((resolve) => app.server.close(() => resolve()));
    const response = await fetch(app.url('/api/v1/runs'), {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        schemaVersion: 1,
        conversationId: 'conversation-1',
        prompt: 'Show current performance.',
      }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'bearer_audience_mismatch' } });
    expect(submit).not.toHaveBeenCalled();
  });

  it('strictly rejects identity and tool-selection injection', async () => {
    const submit = vi.fn().mockResolvedValue(envelope);
    const runService = service({ submit });
    const app = await start(runService);
    close = () => new Promise((resolve) => app.server.close(() => resolve()));
    const response = await fetch(app.url('/api/v1/runs'), {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        schemaVersion: 1,
        conversationId: 'conversation-1',
        prompt: 'Show current performance.',
        run_as: 'admin@example.com',
        tools: ['sql'],
      }),
    });
    expect(response.status).toBe(422);
    expect(submit).not.toHaveBeenCalled();
  });

  it('admits asynchronously with a verified identity', async () => {
    const submit = vi.fn().mockResolvedValue(envelope);
    const runService = service({ submit });
    const app = await start(runService);
    close = () => new Promise((resolve) => app.server.close(() => resolve()));
    const response = await fetch(app.url('/api/v1/runs'), {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        schemaVersion: 1,
        conversationId: 'conversation-1',
        prompt: 'Show current performance.',
      }),
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(envelope);
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'same-request-1' }),
      expect.objectContaining({ email: 'reader@example.com', mode: 'signed_in_user', verified: true })
    );
  });

  it.each([
    [undefined, 422, 'idempotency_key_required'],
    ['short', 422, 'idempotency_key_malformed'],
    ['different-key-1', 409, 'idempotency_key_mismatch'],
  ])('rejects an invalid idempotency header/body combination', async (key, status, code) => {
    const submit = vi.fn();
    const app = await start(service({ submit }));
    close = () => new Promise((resolve) => app.server.close(() => resolve()));
    const headers: Record<string, string> = {
      Authorization: auth.Authorization,
      'Content-Type': 'application/json',
    };
    if (key !== undefined) headers['Idempotency-Key'] = key;
    const response = await fetch(app.url('/api/v1/runs'), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        schemaVersion: 1,
        conversationId: 'conversation-1',
        prompt: 'Show current performance.',
        ...(key === 'different-key-1' ? { idempotencyKey: 'same-request-1' } : {}),
      }),
    });
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } });
    expect(submit).not.toHaveBeenCalled();
  });

  it('keeps run and event reads owner-scoped with opaque 404s', async () => {
    const runService = service({ get: vi.fn().mockResolvedValue(null), events: vi.fn().mockResolvedValue(null) });
    const app = await start(runService);
    close = () => new Promise((resolve) => app.server.close(() => resolve()));
    for (const path of ['/api/v1/runs/foreign', '/api/v1/runs/foreign/events']) {
      const response = await fetch(app.url(path), { headers: auth });
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: 'run_not_found' } });
    }
  });

  it('supports cancellation, terminal feedback, capabilities, and readiness', async () => {
    const runService = service();
    const app = await start(runService);
    close = () => new Promise((resolve) => app.server.close(() => resolve()));
    const cancelled = await fetch(app.url('/api/v1/runs/run-1/cancel'), { method: 'POST', headers: auth });
    expect(cancelled.status).toBe(200);
    const feedback = await fetch(app.url('/api/v1/runs/run-1/feedback'), {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ schemaVersion: 1, sentiment: 'down', comment: 'Missing a source.' }),
    });
    expect(feedback.status).toBe(201);
    expect((await fetch(app.url('/api/v1/capabilities'), { headers: auth })).status).toBe(200);
    expect((await fetch(app.url('/api/v1/health/readiness'))).status).toBe(200);
  });

  it('exposes readiness without user data and reports a missing verifier', async () => {
    const app = await start(service(), { bearerVerifier: null, strictAdmissionReady: null });
    close = () => new Promise((resolve) => app.server.close(() => resolve()));
    const response = await fetch(app.url('/api/v1/readiness'));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: 'not_ready',
      checks: { identityVerifier: 'unavailable', strictAdmission: 'unavailable' },
    });
    expect((await fetch(app.url('/api/v1/runs/run-1'))).status).toBe(401);
  });

  it.each([
    [409, 'idempotency_conflict'],
    [429, 'run_rate_limited'],
    [504, 'run_deadline_exceeded'],
  ])('preserves typed admission status %s', async (status, code) => {
    const runService = service({
      submit: vi.fn().mockRejectedValue({ status, code, message: `Typed ${status}` }),
    });
    const app = await start(runService);
    close = () => new Promise((resolve) => app.server.close(() => resolve()));
    const response = await fetch(app.url('/api/v1/runs'), {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        schemaVersion: 1,
        conversationId: 'conversation-1',
        prompt: 'Show current performance.',
      }),
    });
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } });
  });

  it('returns conflict when cancellation or feedback targets nonterminal work incorrectly', async () => {
    const runService = service({
      cancel: vi.fn().mockResolvedValue('not_active'),
      feedback: vi.fn().mockResolvedValue('not_terminal'),
    });
    const app = await start(runService);
    close = () => new Promise((resolve) => app.server.close(() => resolve()));
    expect(
      (
        await fetch(app.url('/api/v1/runs/run-1/cancel'), {
          method: 'POST',
          headers: auth,
        })
      ).status
    ).toBe(409);
    expect(
      (
        await fetch(app.url('/api/v1/runs/run-1/feedback'), {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({ schemaVersion: 1, sentiment: 'up' }),
        })
      ).status
    ).toBe(409);
  });
});
