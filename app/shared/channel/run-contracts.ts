import { z } from 'zod';

const Id = z.string().trim().min(1).max(256);
const Timestamp = z.string().datetime({ offset: true });
const JsonScalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
type JsonValue = z.infer<typeof JsonScalar> | JsonValue[] | { [key: string]: JsonValue };
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([JsonScalar, z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema)])
);
const CorrelationHash = z
  .string()
  .regex(
    /^(?:[a-f0-9]{64}|[A-Za-z0-9_-]{43})$/,
    'Correlation hashes must be SHA-256 encoded as 64 lowercase hex or 43 base64url characters.'
  );
const SafeReference = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._:/-]+$/);

/**
 * Opaque channel correlation, never execution input.
 *
 * Raw Slack identifiers, prompts, auth metadata, headers, and arbitrary nested
 * objects are intentionally impossible to represent. Channels may correlate a
 * durable run only through irreversible hashes and safe application references.
 */
export const ExternalContextSchema = z.strictObject({
  source: z.literal('slack'),
  slackWorkspaceIdHash: CorrelationHash.optional(),
  slackUserIdHash: CorrelationHash.optional(),
  slackChannelIdHash: CorrelationHash.optional(),
  slackThreadTsHash: CorrelationHash.optional(),
  slackEventIdHash: CorrelationHash.optional(),
  projectId: SafeReference.optional(),
  reference: SafeReference.optional(),
});
export type ExternalContext = z.infer<typeof ExternalContextSchema>;

export const RUN_SCHEMA_VERSION = 1 as const;

/**
 * The public request deliberately contains no execution-policy controls.
 * Identity, authorization, catalog scope, tools, and Genie spaces are all
 * selected by the governed service after the caller has been bound.
 */
export const RunRequestSchema = z.strictObject({
  schemaVersion: z.literal(RUN_SCHEMA_VERSION),
  conversationId: Id,
  prompt: z.string().trim().min(2).max(5000),
  idempotencyKey: z.string().trim().min(8).max(256).optional(),
  externalContext: ExternalContextSchema.optional(),
});
export type RunRequest = z.infer<typeof RunRequestSchema>;

export const RunStateSchema = z.enum([
  'clarification_required',
  'running',
  'complete',
  'partial',
  'blocked',
  'cancelled',
  'expired',
]);
export type RunState = z.infer<typeof RunStateSchema>;

export const AnswerFigureSchema = z.strictObject({
  label: z.string(),
  value: z.number(),
  display: z.string(),
  comparison: z.string(),
});

// Chart payloads are declarative visualization specifications. Their internals
// remain product-defined, while the answer envelope around them stays stable.
export const AnswerChartSchema = z.record(z.string(), JsonValueSchema);

export const AnswerSourceSchema = z.strictObject({
  name: z.string(),
  freshness: z.string(),
  role: z.string().optional(),
});

export const AnswerDerivationSchema = z.strictObject({
  source: z.string(),
  metric: z.string(),
  window: z.string(),
  filter: z.string(),
});

export const AnswerEnvelopeSchema = z.strictObject({
  takeaway: z.string(),
  narrative: z.string(),
  content: z.string(),
  figures: z.array(AnswerFigureSchema),
  charts: z.array(AnswerChartSchema),
  sources: z.array(AnswerSourceSchema),
  caveats: z.array(z.string()),
  derivation: z.array(AnswerDerivationSchema),
  sql: z.string(),
  traceLink: z.string().min(1).nullable(),
});
export type AnswerEnvelope = z.infer<typeof AnswerEnvelopeSchema>;

export const ClarificationEnvelopeSchema = z.strictObject({
  question: z.string().min(1),
  choices: z.array(z.string()).optional(),
});

export const BlockedEnvelopeSchema = z.strictObject({
  code: Id,
  message: z.string().min(1),
  link: z.string().min(1).nullable(),
});

export const ApiErrorSchema = z.strictObject({
  schemaVersion: z.literal(RUN_SCHEMA_VERSION),
  error: z.strictObject({
    code: Id,
    message: z.string().min(1),
    retryable: z.boolean(),
    requestId: Id.nullable(),
    details: JsonValueSchema.optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const RunEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(RUN_SCHEMA_VERSION),
  runId: Id,
  conversationId: Id,
  state: RunStateSchema,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  correlationId: Id.nullable(),
  answer: AnswerEnvelopeSchema.nullable(),
  clarification: ClarificationEnvelopeSchema.nullable(),
  blocked: BlockedEnvelopeSchema.nullable(),
  error: ApiErrorSchema.shape.error.nullable(),
  externalContext: ExternalContextSchema.optional(),
});
export type RunEnvelope = z.infer<typeof RunEnvelopeSchema>;

export const RunEventSchema = z.strictObject({
  schemaVersion: z.literal(RUN_SCHEMA_VERSION),
  runId: Id,
  sequence: z.number().int().nonnegative(),
  type: z.enum(['stage', 'state']),
  at: Timestamp,
  payload: z.record(z.string(), JsonValueSchema),
});
export type RunEvent = z.infer<typeof RunEventSchema>;

export const RunFeedbackSchema = z.strictObject({
  schemaVersion: z.literal(RUN_SCHEMA_VERSION),
  sentiment: z.enum(['up', 'down']),
  comment: z.string().trim().min(1).max(4000).optional(),
});

export const CapabilitiesSchema = z.strictObject({
  schemaVersion: z.literal(RUN_SCHEMA_VERSION),
  asynchronousRuns: z.literal(true),
  cancellation: z.literal(true),
  feedback: z.literal(true),
  events: z.literal(true),
  planExecution: z.literal(false),
  externalContext: z.literal(true),
});

export const ReadinessSchema = z.strictObject({
  schemaVersion: z.literal(RUN_SCHEMA_VERSION),
  status: z.enum(['ready', 'not_ready']),
  checks: z.strictObject({
    store: z.enum(['ready', 'unavailable']),
    identityVerifier: z.enum(['ready', 'unavailable']),
    strictAdmission: z.enum(['ready', 'unavailable']),
    serving: z.enum(['ready', 'unavailable']),
  }),
});

export const RUN_CAPABILITIES = CapabilitiesSchema.parse({
  schemaVersion: RUN_SCHEMA_VERSION,
  asynchronousRuns: true,
  cancellation: true,
  feedback: true,
  events: true,
  planExecution: false,
  externalContext: true,
});
