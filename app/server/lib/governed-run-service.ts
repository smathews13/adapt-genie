import type { Request, Response } from 'express';
import { APP_SCHEMA } from '../../shared/app-schema';
import {
  AnswerEnvelopeSchema,
  ExternalContextSchema,
  RUN_SCHEMA_VERSION,
  RunEventSchema,
  type ApiError,
  type RunEvent,
  type RunEnvelope,
  type RunRequest,
} from '../../shared/channel/run-contracts';
import type { BoundIdentity } from './identity-binding';
import {
  cancelOwnedRun,
  expireAwaitingApproval,
  expireMarkedAwaitingApprovals,
  readRun,
  transition,
  type LedgerRun,
} from './run-ledger';
import { readStageEvents } from './run-stage-events';

export interface GovernedReply {
  readonly wantsStream: boolean;
  begin(): void;
  stage(stage: Record<string, unknown>): void;
  status(code: number): GovernedReply;
  json(body: unknown): void;
}

export interface GovernedExecutionOverrides {
  body?: unknown;
  identity?: BoundIdentity;
  idempotencyKey?: string;
  reply?: GovernedReply;
  onAdmitted?: (run: LedgerRun | null, fallbackRunId: string) => void | Promise<void>;
  runLedgerMode?: 'enforce';
  strictAdmission?: boolean;
  budgetContext?: GovernedBudgetContext;
}

export interface GovernedBudgetContext {
  source: 'browser' | 'channel';
  correlationId: string;
}

export interface GovernedChannelRequest {
  readonly source: 'channel';
  header(name: string): string | undefined;
  get(name: string): string | undefined;
}

export type GovernedExecutorRequest = Request | GovernedChannelRequest;

export type GovernedExecutor = (
  req: GovernedExecutorRequest,
  res: Response | undefined,
  overrides?: GovernedExecutionOverrides
) => Promise<void>;

interface Store {
  lakebase: {
    query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  };
}

interface PendingTerminal {
  status: number;
  body: unknown;
}

const V1_ADMISSION_EVENT = 'v1_admission';

export class GovernedRunError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function storedJson(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return record(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return record(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function answerFrom(value: unknown, runId: string): RunEnvelope['answer'] {
  const source = record(value);
  if (!source) return null;
  const candidate = {
    takeaway: typeof source.takeaway === 'string' ? source.takeaway : '',
    narrative: typeof source.narrative === 'string' ? source.narrative : '',
    content: typeof source.content === 'string' ? source.content : '',
    figures: Array.isArray(source.figures) ? source.figures : [],
    charts: Array.isArray(source.charts) ? source.charts : [],
    sources: Array.isArray(source.sources) ? source.sources : [],
    caveats: stringArray(source.caveats),
    derivation: Array.isArray(source.derivation) ? source.derivation : [],
    sql: typeof source.sql === 'string' ? source.sql : '',
    traceLink:
      typeof record(source.mlflow)?.url === 'string'
        ? String(record(source.mlflow)?.url)
        : typeof record(source.trace)?.url === 'string'
          ? String(record(source.trace)?.url)
          : `/api/runs/${encodeURIComponent(runId)}/trace`,
  };
  const parsed = AnswerEnvelopeSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function publicState(state: LedgerRun['state']): RunEnvelope['state'] {
  switch (state) {
    case 'SUCCEEDED':
      return 'complete';
    case 'CLARIFICATION_REQUIRED':
      return 'clarification_required';
    case 'AWAITING_APPROVAL':
    case 'REFUSED':
      return 'blocked';
    case 'CANCELLED':
      return 'cancelled';
    case 'DEADLINE_EXCEEDED':
      return 'expired';
    case 'FAILED':
    case 'PERSISTENCE_FAILED':
      return 'partial';
    default:
      return 'running';
  }
}

function apiError(code: string, message: string, requestId: string | null, retryable = false): ApiError['error'] {
  return { code, message, retryable, requestId };
}

function channelRequest(identity: BoundIdentity, idempotencyKey: string): GovernedChannelRequest {
  const headers = new Map<string, string>([
    ['x-forwarded-email', identity.email],
    ['x-request-id', identity.requestId],
    ['x-correlation-id', identity.correlationId],
    ['idempotency-key', idempotencyKey],
  ]);
  const header = (name: string) => headers.get(name.trim().toLowerCase());
  return Object.freeze({ source: 'channel' as const, header, get: header });
}

/**
 * Channel-neutral owner of governed run admission and durable run operations.
 *
 * The executor is injected once. Browser and v1 adapters both enter through
 * this object, so there is no second serving path and no channel-selected tool
 * or authorization policy.
 */
export class GovernedRunService {
  constructor(
    private readonly store: Store,
    private readonly executor: GovernedExecutor
  ) {}

  executeBrowser(req: Request, res: Response): Promise<void> {
    return this.executor(req, res);
  }

  startPlanExpirySweep(intervalMs = 60_000): () => void {
    const timer = setInterval(() => {
      void expireMarkedAwaitingApprovals(this.store, V1_ADMISSION_EVENT).then((result) => {
        if (!result.ok) {
          console.warn(`[governed-run] Plan expiry sweep was unavailable: ${result.detail}`);
        }
      });
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  private schedulePlanExpiry(run: LedgerRun, owner: string): void {
    const expire = () => {
      const remaining = Date.parse(run.deadlineAt) - Date.now();
      if (remaining > 0) {
        const timer = setTimeout(expire, Math.min(remaining, 2_147_483_647));
        timer.unref?.();
        return;
      }
      void expireAwaitingApproval(this.store, run.runId, owner).then((result) => {
        if (!result.ok) {
          console.warn(`[governed-run] Plan expiry could not settle ${run.runId}: ${result.detail}`);
        }
      });
    };
    expire();
  }

  async submit(input: RunRequest, identity: BoundIdentity): Promise<RunEnvelope> {
    if (!identity.token || !identity.verified || identity.mode !== 'signed_in_user') {
      throw new GovernedRunError(
        identity.token ? 403 : 401,
        identity.token ? 'subject_unverified' : 'bearer_required',
        'Governed execution requires a proven signed-in user bearer.'
      );
    }
    const externalContext =
      input.externalContext === undefined ? undefined : ExternalContextSchema.parse(input.externalContext);
    const idempotencyKey = input.idempotencyKey ?? '';
    const req = channelRequest(identity, idempotencyKey);
    const admitted = deferred<{ runId: string }>();
    let admissionSettled = false;
    let terminal: PendingTerminal | null = null;
    const reply: GovernedReply = {
      wantsStream: false,
      begin() {},
      stage() {},
      status(code) {
        terminal = { status: code, body: terminal?.body };
        return reply;
      },
      json(body) {
        terminal = { status: terminal?.status ?? 200, body };
        if (!admissionSettled) {
          admissionSettled = true;
          admitted.reject(terminal);
        }
      },
    };

    void this.executor(req, undefined, {
      body: {
        conversationId: input.conversationId,
        prompt: input.prompt,
      },
      identity,
      idempotencyKey,
      reply,
      runLedgerMode: 'enforce',
      strictAdmission: true,
      budgetContext: { source: 'channel', correlationId: identity.correlationId },
      onAdmitted: async (run, fallbackRunId) => {
        if (admissionSettled) return;
        const runId = run?.runId ?? fallbackRunId;
        try {
          await this.store.lakebase.query(
            `INSERT INTO ${APP_SCHEMA}.run_events (run_id, seq, event_id, event_type, stage, payload)
               SELECT $1,0,$2,$3,NULL,$4::jsonb
                WHERE EXISTS (
                  SELECT 1 FROM ${APP_SCHEMA}.runs WHERE run_id = $1 AND user_email = $5
                )
               ON CONFLICT (run_id, seq) DO NOTHING`,
            [runId, `${runId}-v1-admission`, V1_ADMISSION_EVENT, JSON.stringify(externalContext ?? {}), identity.email]
          );
        } catch (error) {
          if (run) {
            await transition(this.store, {
              runId: run.runId,
              from: run.state,
              to: 'PERSISTENCE_FAILED',
              fencingToken: run.fencingToken,
              code: 'PERSISTENCE_UNAVAILABLE',
            });
          }
          throw new GovernedRunError(
            503,
            'persistence_unavailable',
            `V1 admission metadata was not stored for ${runId}: ${(error as Error).message}`
          );
        }
        if (run) this.schedulePlanExpiry(run, identity.email);
        admissionSettled = true;
        admitted.resolve({ runId });
      },
    }).catch((error) => {
      if (!admissionSettled) {
        admissionSettled = true;
        admitted.reject(error);
      }
    });

    const { runId } = await admitted.promise;
    const envelope = await this.get(runId, identity.email, externalContext);
    if (!envelope) throw new Error('The admitted run could not be read from the durable ledger.');
    return envelope;
  }

  async get(
    runId: string,
    owner: string,
    externalContext?: RunRequest['externalContext']
  ): Promise<RunEnvelope | null> {
    const found = await readRun(this.store, runId, owner);
    if (!found.ok) throw new Error(found.detail);
    if (!found.value) return null;
    let run = found.value;
    if (run.state === 'AWAITING_APPROVAL' && Date.parse(run.deadlineAt) <= Date.now()) {
      const expired = await expireAwaitingApproval(this.store, runId, owner);
      if (!expired.ok) throw new Error(expired.detail);
      if (expired.value) {
        run = expired.value;
      } else {
        const refreshed = await readRun(this.store, runId, owner);
        if (!refreshed.ok) throw new Error(refreshed.detail);
        if (!refreshed.value) return null;
        run = refreshed.value;
      }
    }
    let durableExternalContext = externalContext;
    if (durableExternalContext === undefined) {
      try {
        const context = await this.store.lakebase.query(
          `SELECT e.payload
             FROM ${APP_SCHEMA}.run_events e
             JOIN ${APP_SCHEMA}.runs r ON r.run_id = e.run_id
            WHERE e.run_id = $1 AND r.user_email = $2 AND e.event_type = $3
            LIMIT 1`,
          [runId, owner, V1_ADMISSION_EVENT]
        );
        const held = ExternalContextSchema.safeParse(storedJson(context.rows[0]?.payload));
        if (held.success) durableExternalContext = held.data;
      } catch (error) {
        console.warn(`[governed-run] External context could not be read for ${runId}: ${(error as Error).message}`);
      }
    }
    let response: Record<string, unknown> | null = null;
    let updatedAt = run.updatedAt ?? run.createdAt ?? new Date().toISOString();
    if (run.terminalMessageId) {
      const message = await this.store.lakebase.query(
        `SELECT m.response_json, m.created_at
           FROM ${APP_SCHEMA}.messages m
           JOIN ${APP_SCHEMA}.conversations c ON c.id = m.conversation_id
          WHERE m.id = $1 AND c.user_email = $2`,
        [run.terminalMessageId, owner]
      );
      response = storedJson(message.rows[0]?.response_json);
      const timestamp = message.rows[0]?.created_at;
      if (timestamp instanceof Date) updatedAt = timestamp.toISOString();
      else if (typeof timestamp === 'string') updatedAt = new Date(timestamp).toISOString();
    }
    const state = publicState(run.state);
    const clarificationSource = record(response?.clarification);
    return {
      schemaVersion: RUN_SCHEMA_VERSION,
      runId: run.runId,
      conversationId: run.conversationId,
      state,
      createdAt: run.createdAt ?? updatedAt,
      updatedAt,
      correlationId: run.correlationId,
      answer: state === 'complete' || state === 'partial' ? answerFrom(response, run.runId) : null,
      clarification:
        state === 'clarification_required' && typeof clarificationSource?.question === 'string'
          ? {
              question: clarificationSource.question,
              ...(Array.isArray(clarificationSource.options)
                ? { choices: stringArray(clarificationSource.options) }
                : {}),
            }
          : null,
      blocked:
        state === 'blocked'
          ? {
              code: run.state === 'AWAITING_APPROVAL' ? 'PLAN_APPROVAL_REQUIRED' : (run.terminalCode ?? 'RUN_BLOCKED'),
              message:
                run.state === 'AWAITING_APPROVAL'
                  ? 'This run requires approval in the ADAPT app and was not auto-approved.'
                  : 'Governed execution was blocked.',
              link:
                run.state === 'AWAITING_APPROVAL' ? `/?conversation=${encodeURIComponent(run.conversationId)}` : null,
            }
          : null,
      error:
        state === 'partial' || state === 'expired'
          ? apiError(
              run.terminalCode ?? (state === 'expired' ? 'RUN_DEADLINE_EXCEEDED' : 'RUN_INCOMPLETE'),
              state === 'expired' ? 'The governed run exceeded its deadline.' : 'The governed run did not complete.',
              run.correlationId,
              state === 'partial'
            )
          : null,
      ...(durableExternalContext === undefined ? {} : { externalContext: durableExternalContext }),
    };
  }

  async events(runId: string, owner: string): Promise<RunEvent[] | null> {
    const found = await readRun(this.store, runId, owner);
    if (!found.ok) throw new Error(found.detail);
    if (!found.value) return null;
    const at = found.value.updatedAt ?? found.value.createdAt ?? new Date().toISOString();
    return (await readStageEvents(this.store, runId)).map((payload, sequence) =>
      RunEventSchema.parse({
        schemaVersion: RUN_SCHEMA_VERSION,
        runId,
        sequence,
        type: 'stage',
        at,
        payload,
      })
    );
  }

  async cancel(runId: string, owner: string): Promise<'cancelled' | 'not_active' | 'not_found'> {
    const result = await cancelOwnedRun(this.store, owner, runId);
    if (!result.ok) throw new Error(result.detail);
    if (result.value.kind === 'not-found') return 'not_found';
    if (result.value.kind === 'not-active') return 'not_active';
    return 'cancelled';
  }

  async feedback(
    runId: string,
    owner: string,
    input: { sentiment: 'up' | 'down'; comment?: string }
  ): Promise<'created' | 'not_found' | 'not_terminal'> {
    const found = await readRun(this.store, runId, owner);
    if (!found.ok) throw new Error(found.detail);
    if (!found.value) return 'not_found';
    if (!found.value.terminalMessageId) return 'not_terminal';
    await this.store.lakebase.query(
      `INSERT INTO ${APP_SCHEMA}.feedback (id, message_id, user_email, sentiment, usefulness, comment)
       VALUES ($1,$2,$3,$4,NULL,$5)`,
      [
        crypto.randomUUID(),
        found.value.terminalMessageId,
        owner,
        input.sentiment,
        input.sentiment === 'down' ? input.comment?.trim() || null : null,
      ]
    );
    return 'created';
  }
}
