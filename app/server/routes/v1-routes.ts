import type { Application, NextFunction, Request, Response } from 'express';
import {
  RUN_CAPABILITIES,
  RUN_SCHEMA_VERSION,
  RunFeedbackSchema,
  RunRequestSchema,
} from '../../shared/channel/run-contracts';
import { mintCorrelationId, usableCorrelationId, CORRELATION_HEADER } from '../../shared/correlation';
import { lakebaseHealth } from '../lib/lakebase-store';
import type { BoundIdentity } from '../lib/identity-binding';
import { decideIdentity, SIGNED_IN_USER } from '../lib/identity-binding';
import type { GovernedRunService } from '../lib/governed-run-service';
import { isUsableIdempotencyKey } from '../lib/run-request-hash';
import { forwardedUserToken } from './access-verification';

export const V1_EXPECTED_AUDIENCE_ENV = 'PIA_V1_EXPECTED_AUDIENCE';

export interface BearerVerification {
  email: string;
  workspace: string;
  audience: string;
}

export type BearerIdentityVerifier = (
  token: string,
  expected: { workspace: string; audience: string }
) => Promise<BearerVerification>;

export interface SubjectWorkspaceVerification {
  email: string;
  workspace: string;
}

export interface V1RouteOptions {
  service: GovernedRunService;
  bearerVerifier?: BearerIdentityVerifier;
  expectedWorkspace?: string;
  expectedAudience?: string;
  servingReady?: () => Promise<boolean>;
  strictAdmissionReady?: () => Promise<boolean>;
}

class V1RouteError extends Error {
  constructor(
    readonly status: 401 | 403 | 404 | 409 | 422 | 429 | 503 | 504,
    readonly code: string,
    message: string,
    readonly retryable = false
  ) {
    super(message);
  }
}

function apiError(res: Response, error: V1RouteError, requestId: string | null): void {
  res.status(error.status).json({
    schemaVersion: RUN_SCHEMA_VERSION,
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      requestId,
    },
  });
}

function bearer(req: Request): string | null {
  const raw = req.header('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match?.[1]?.trim() || null;
}

function expectedWorkspace(options: V1RouteOptions): string {
  return (options.expectedWorkspace ?? process.env.DATABRICKS_HOST ?? '').trim().replace(/\/+$/, '');
}

function expectedAudience(options: V1RouteOptions): string {
  return (options.expectedAudience ?? process.env[V1_EXPECTED_AUDIENCE_ENV] ?? '').trim();
}

/**
 * Subject/workspace proof only.
 *
 * SCIM `/Me` proves that Databricks accepted this bearer at one workspace and
 * identifies the user there. It does NOT prove the OAuth audience and therefore
 * is deliberately not a `BearerIdentityVerifier` and is never the v1 default.
 */
export async function verifyDatabricksSubjectAndWorkspace(
  token: string,
  workspace: string
): Promise<SubjectWorkspaceVerification> {
  if (!workspace) {
    throw new V1RouteError(
      503,
      'identity_verifier_unavailable',
      'Databricks subject/workspace verification is unavailable for this deployment.',
      true
    );
  }
  const response = await fetch(`${workspace}/api/2.0/preview/scim/v2/Me`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401) throw new V1RouteError(401, 'invalid_bearer', 'The bearer token was not accepted.');
  if (response.status === 403) {
    throw new V1RouteError(403, 'bearer_not_authorized', 'The bearer token cannot verify a user in this workspace.');
  }
  if (!response.ok) {
    throw new V1RouteError(
      503,
      'identity_verifier_unavailable',
      'Bearer verification is temporarily unavailable.',
      true
    );
  }
  const profile = (await response.json()) as Record<string, unknown>;
  const email =
    (typeof profile.userName === 'string' && profile.userName.trim()) ||
    (typeof profile.displayName === 'string' && profile.displayName.trim()) ||
    '';
  if (!email) {
    throw new V1RouteError(403, 'subject_unverified', 'The bearer token did not resolve to a verified user.');
  }
  return { email, workspace };
}

async function identityFor(req: Request, options: V1RouteOptions): Promise<BoundIdentity> {
  const requestId = mintCorrelationId();
  const correlationId = usableCorrelationId(req.headers?.[CORRELATION_HEADER]) ?? requestId;
  const proxyEmail = (req.header('x-forwarded-email') ?? '').trim().toLowerCase();
  const proxyToken = forwardedUserToken(req);
  if (proxyEmail && proxyToken) {
    const decision = decideIdentity(req, { signedInAs: proxyEmail, required: true });
    if (!decision.ok) {
      throw new V1RouteError(
        decision.code === 'IDENTITY_MISMATCH' ? 403 : 401,
        decision.code.toLowerCase(),
        'The Databricks Apps proxy identity could not be verified.'
      );
    }
    if (!decision.verified) {
      throw new V1RouteError(
        403,
        'subject_unverified',
        'The Databricks Apps proxy bearer did not prove the signed-in user.'
      );
    }
    return decision;
  }

  const token = bearer(req);
  if (!token) throw new V1RouteError(401, 'bearer_required', 'A verified user bearer token is required.');
  const workspace = expectedWorkspace(options);
  const audience = expectedAudience(options);
  const verifier = options.bearerVerifier;
  if (!verifier || !workspace || !audience) {
    throw new V1RouteError(
      503,
      'identity_verifier_unavailable',
      'A workspace, audience, and injected bearer verifier are required for v1.',
      true
    );
  }
  const verified = await verifier(token, { workspace, audience });
  if (!verified.email.trim()) {
    throw new V1RouteError(403, 'subject_unverified', 'The bearer verifier did not prove a user subject.');
  }
  if (verified.workspace.replace(/\/+$/, '') !== workspace || verified.audience !== audience) {
    throw new V1RouteError(
      403,
      'bearer_audience_mismatch',
      'The bearer token is for a different workspace or audience.'
    );
  }
  return {
    ok: true,
    email: verified.email.trim().toLowerCase(),
    token,
    verified: true,
    mode: SIGNED_IN_USER,
    requestId,
    correlationId,
  };
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, _next: NextFunction) =>
    void handler(req, res).catch((error) => {
      const held = res.locals.v1Identity as BoundIdentity | undefined;
      apiError(res, statusFromUnknown(error), held?.correlationId ?? null);
    });
}

function routeId(req: Request): string {
  const value = req.params.id;
  return Array.isArray(value) ? (value[0] ?? '') : value;
}

function statusFromUnknown(error: unknown): V1RouteError {
  if (error instanceof V1RouteError) return error;
  const held = error as { status?: unknown; code?: unknown; message?: unknown; body?: unknown };
  const status = typeof held?.status === 'number' ? held.status : 503;
  const body = held?.body as Record<string, unknown> | undefined;
  const code =
    typeof held?.code === 'string'
      ? held.code
      : typeof body?.code === 'string'
        ? body.code
        : typeof body?.error === 'string'
          ? body.error
          : 'run_unavailable';
  const allowed = [401, 403, 404, 409, 422, 429, 503, 504].includes(status) ? status : 503;
  return new V1RouteError(
    allowed as V1RouteError['status'],
    code.toLowerCase(),
    typeof body?.message === 'string'
      ? body.message
      : typeof held?.message === 'string'
        ? held.message
        : 'The governed run service is unavailable.',
    allowed === 429 || allowed === 503 || allowed === 504
  );
}

/** Register before browser-session middleware; data-bearing routes authenticate here. */
export function setupV1Routes(app: Application, options: V1RouteOptions): void {
  // Operational probes are intentionally public so a platform health checker
  // does not need a user bearer. They expose no user/run data. Every run,
  // status, event, cancellation, feedback, and capability route is registered
  // after the v1 identity gate below.
  app.get('/api/v1/health', (_req, res) => res.json({ schemaVersion: RUN_SCHEMA_VERSION, status: 'ok' }));
  const readiness = asyncRoute(async (_req, res) => {
    const storage = lakebaseHealth().state === 'unavailable' ? 'unavailable' : 'ready';
    const verifier =
      options.bearerVerifier && expectedWorkspace(options) && expectedAudience(options) ? 'ready' : 'unavailable';
    const serving =
      (await options.servingReady?.().catch(() => false)) ?? Boolean(process.env.DATABRICKS_SERVING_ENDPOINT_NAME);
    const strictAdmission = (await options.strictAdmissionReady?.().catch(() => false)) === true;
    const ready = storage === 'ready' && verifier === 'ready' && strictAdmission && serving;
    res.status(ready ? 200 : 503).json({
      schemaVersion: RUN_SCHEMA_VERSION,
      status: ready ? 'ready' : 'not_ready',
      checks: {
        store: storage,
        identityVerifier: verifier,
        strictAdmission: strictAdmission ? 'ready' : 'unavailable',
        serving: serving ? 'ready' : 'unavailable',
      },
    });
  });
  app.get('/api/v1/readiness', readiness);
  app.get('/api/v1/health/readiness', readiness);

  app.use(
    '/api/v1',
    (req, res, next) =>
      void identityFor(req, options).then(
        (identity) => {
          res.locals.v1Identity = identity;
          next();
        },
        (error) => apiError(res, statusFromUnknown(error), null)
      )
  );

  const identity = (res: Response) => res.locals.v1Identity as BoundIdentity;

  app.post(
    '/api/v1/runs',
    asyncRoute(async (req, res) => {
      const parsed = RunRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(
          res,
          new V1RouteError(422, 'invalid_run_request', 'The run request does not match schema version 1.'),
          null
        );
        return;
      }
      const idempotencyKey = (req.header('idempotency-key') ?? '').trim();
      if (!isUsableIdempotencyKey(idempotencyKey)) {
        apiError(
          res,
          new V1RouteError(
            422,
            idempotencyKey ? 'idempotency_key_malformed' : 'idempotency_key_required',
            'Idempotency-Key must be 8 to 200 characters of letters, digits, dot, colon, underscore, or hyphen.'
          ),
          identity(res).correlationId
        );
        return;
      }
      if (parsed.data.idempotencyKey !== undefined && parsed.data.idempotencyKey !== idempotencyKey) {
        apiError(
          res,
          new V1RouteError(
            409,
            'idempotency_key_mismatch',
            'The body idempotencyKey must exactly match the Idempotency-Key header.'
          ),
          identity(res).correlationId
        );
        return;
      }
      try {
        const envelope = await options.service.submit({ ...parsed.data, idempotencyKey }, identity(res));
        res.status(202).json(envelope);
      } catch (error) {
        apiError(res, statusFromUnknown(error), identity(res).correlationId);
      }
    })
  );

  app.get(
    '/api/v1/runs/:id',
    asyncRoute(async (_req, res) => {
      const found = await options.service.get(routeId(_req), identity(res).email);
      if (!found) {
        apiError(
          res,
          new V1RouteError(404, 'run_not_found', 'No run with this id belongs to you.'),
          identity(res).correlationId
        );
        return;
      }
      res.json(found);
    })
  );

  app.get(
    '/api/v1/runs/:id/events',
    asyncRoute(async (req, res) => {
      const runId = routeId(req);
      const events = await options.service.events(runId, identity(res).email);
      if (!events) {
        apiError(
          res,
          new V1RouteError(404, 'run_not_found', 'No run with this id belongs to you.'),
          identity(res).correlationId
        );
        return;
      }
      res.json({ schemaVersion: RUN_SCHEMA_VERSION, runId, events });
    })
  );

  app.post(
    '/api/v1/runs/:id/cancel',
    asyncRoute(async (req, res) => {
      const runId = routeId(req);
      const outcome = await options.service.cancel(runId, identity(res).email);
      if (outcome === 'not_found') {
        apiError(
          res,
          new V1RouteError(404, 'run_not_found', 'No run with this id belongs to you.'),
          identity(res).correlationId
        );
        return;
      }
      if (outcome === 'not_active') {
        apiError(
          res,
          new V1RouteError(409, 'run_not_active', 'This run is no longer active.'),
          identity(res).correlationId
        );
        return;
      }
      const envelope = await options.service.get(runId, identity(res).email);
      res.json(envelope);
    })
  );

  app.post(
    '/api/v1/runs/:id/feedback',
    asyncRoute(async (req, res) => {
      const parsed = RunFeedbackSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(
          res,
          new V1RouteError(422, 'invalid_feedback', 'Feedback does not match schema version 1.'),
          identity(res).correlationId
        );
        return;
      }
      const runId = routeId(req);
      const outcome = await options.service.feedback(runId, identity(res).email, parsed.data);
      if (outcome === 'not_found') {
        apiError(
          res,
          new V1RouteError(404, 'run_not_found', 'No run with this id belongs to you.'),
          identity(res).correlationId
        );
        return;
      }
      if (outcome === 'not_terminal') {
        apiError(
          res,
          new V1RouteError(409, 'run_not_terminal', 'Feedback requires a terminal run.'),
          identity(res).correlationId
        );
        return;
      }
      res.status(201).json({ schemaVersion: RUN_SCHEMA_VERSION, runId, recorded: true });
    })
  );

  app.get('/api/v1/capabilities', (_req, res) => res.json(RUN_CAPABILITIES));
}
