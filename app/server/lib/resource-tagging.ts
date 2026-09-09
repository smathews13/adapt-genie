/**
 * Billing-attribution tags for the resources connected to this app.
 *
 * Only tags documented to reach system.billing.usage are actionable here.
 * Organizational tags (Apps, Genie, MLflow and model metadata) remain visible
 * in the inventory, but are never attempted or counted in the denominator.
 */
import type { PreflightReport } from '../routes/insights-routes';
import {
  BILLING_TAG,
  RETIRED_BILLING_TAG_KEY,
  billingTagPair,
  type AppBillingTagState,
} from '../../shared/billing-tag';
import { normalizeWorkspaceHost } from '../../shared/databricks-links';
import { scopesFromToken } from '../routes/access-verification';

export const ADAPT_TAG = BILLING_TAG;

export type ResourceTagKind =
  | 'app'
  | 'registered-model'
  | 'model-version'
  | 'mlflow-experiment'
  | 'serving-endpoint'
  | 'foundation-model-endpoint'
  | 'genie-space'
  | 'sql-warehouse'
  | 'lakebase-project'
  | 'lakebase-branch'
  | 'lakebase-endpoint';

export type ResourceTagSupport = 'supported' | 'unsupported' | 'not-applicable';
export type ResourceTagStatus =
  | 'tagged'
  | 'already-correct'
  | 'permission-required'
  | 'failed'
  | 'unsupported'
  | 'not-applicable';

export interface ResourceTagTarget {
  kind: ResourceTagKind;
  name: string;
  label: string;
  support: ResourceTagSupport;
  billingAttribution: boolean;
  detail: string;
  nextAction: string;
  requiredScope?: string;
  identity?: 'obo' | 'app-service-principal';
}

export interface ResourceTagResult extends ResourceTagTarget {
  status: ResourceTagStatus;
  technicalDetail?: string;
}

export interface ResourceTagSummary {
  headline: string;
  supportedTotal: number;
  supportedCovered: number;
  tagged: number;
  alreadyCorrect: number;
  supportedFailed: number;
  permissionRequired: number;
  unsupported: number;
  notApplicable: number;
  results: ResourceTagResult[];
  updatedAt: string;
}

export interface ResourceTagRetryPolicy {
  maxAttempts?: number;
  baseDelayMs?: number;
  timeBudgetMs?: number;
  concurrency?: number;
  sleep?: (delayMs: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

interface KeyValueTag {
  key?: string;
  value?: string;
}

export interface ResourceTagPlatform {
  getServingTags(name: string, signal?: AbortSignal): Promise<KeyValueTag[]>;
  patchServingTags(name: string, add: KeyValueTag[], remove: string[], signal?: AbortSignal): Promise<void>;
  getWarehouseTags(warehouseId: string, signal?: AbortSignal): Promise<KeyValueTag[]>;
  setWarehouseTags(warehouseId: string, tags: KeyValueTag[], signal?: AbortSignal): Promise<void>;
  getLakebaseTags(projectName: string, signal?: AbortSignal): Promise<KeyValueTag[]>;
  setLakebaseTags(projectName: string, tags: KeyValueTag[], signal?: AbortSignal): Promise<void>;
}

function configurationValue(report: PreflightReport | null, key: string): string {
  const value = report?.configuration.find((entry) => entry.key === key)?.value;
  return typeof value === 'string' ? value.trim() : '';
}

function text(value: string | undefined): string {
  return (value ?? '').trim();
}

function target(input: Omit<ResourceTagTarget, 'billingAttribution'>): ResourceTagTarget {
  return { ...input, billingAttribution: input.support === 'supported' };
}

function metadataOnly(kind: ResourceTagKind, name: string, label: string, detail: string, nextAction: string) {
  return target({ kind, name, label, support: 'not-applicable', detail, nextAction });
}

/**
 * Connected-resource inventory. No workspace discovery and no mutation.
 */
export function resourceTagInventory(
  input: { environment?: NodeJS.ProcessEnv; report?: PreflightReport | null } = {}
): ResourceTagTarget[] {
  const environment = input.environment ?? process.env;
  const report = input.report ?? null;
  const targets: ResourceTagTarget[] = [];
  const appName = text(environment.DATABRICKS_APP_NAME);
  if (appName) {
    targets.push(
      metadataOnly(
        'app',
        appName,
        `Databricks App · ${appName}`,
        'App entity tags are organizational metadata and do not carry billing attribution.',
        'Assign a serverless usage policy containing this tag to the app.'
      )
    );
  }

  const serving = text(environment.DATABRICKS_SERVING_ENDPOINT_NAME);
  if (serving) {
    targets.push(
      target({
        kind: 'serving-endpoint',
        name: serving,
        label: 'adapt-orchestrator',
        support: 'supported',
        detail: 'Serving endpoint custom tags propagate to billing usage.',
        nextAction: '',
        requiredScope: 'model-serving',
        identity: 'obo',
      })
    );
  }

  const foundation = configurationValue(report, 'llm_endpoint') || text(environment.PLAYER_INSIGHTS_LLM_ENDPOINT);
  if (foundation) {
    const shared = foundation.startsWith('databricks-') || foundation.startsWith('system.ai.');
    targets.push(
      shared
        ? metadataOnly(
            'foundation-model-endpoint',
            foundation,
            `Foundation model endpoint · ${foundation}`,
            'This is a shared system pay-per-token endpoint, not an app-owned tag target.',
            'Use a serverless usage policy or endpoint metadata in billing reports.'
          )
        : target({
            kind: 'serving-endpoint',
            name: foundation,
            label: `Foundation model serving endpoint · ${foundation}`,
            support: 'supported',
            detail: 'A custom serving endpoint can carry billing tags.',
            nextAction: '',
            requiredScope: 'model-serving',
            identity: 'obo',
          })
    );
  }

  const spaceId = configurationValue(report, 'data_genie_space_id') || text(environment.PLAYER_INSIGHTS_DATA_GENIE_ID);
  if (spaceId) {
    targets.push(
      metadataOnly(
        'genie-space',
        spaceId,
        `Data Genie space · ${spaceId}`,
        'Genie space tags organize the space but do not propagate as custom billing tags.',
        'Use Genie billing origin, surface, channel, and run-as metadata for attribution.'
      )
    );
  }

  const experimentId = text(environment.PLAYER_INSIGHTS_EXPERIMENT_ID);
  if (experimentId) {
    targets.push(
      metadataOnly(
        'mlflow-experiment',
        experimentId,
        `MLflow experiment · ${experimentId}`,
        'MLflow experiment tags do not propagate to billing usage.',
        'Use the experiment workload-creation usage policy for serverless MLflow workloads.'
      )
    );
  }

  const warehouseId = text(environment.DATABRICKS_SQL_WAREHOUSE_ID);
  if (warehouseId) {
    targets.push(
      target({
        kind: 'sql-warehouse',
        name: warehouseId,
        label: `SQL warehouse · ${warehouseId}`,
        support: 'supported',
        detail: 'SQL warehouse custom tags propagate to billing usage.',
        nextAction: '',
        requiredScope: 'sql',
        identity: 'obo',
      })
    );
  }

  const lakebase = text(environment.LAKEBASE_ENDPOINT);
  const project = /^(projects\/[^/]+)/.exec(lakebase)?.[1] ?? '';
  const branch = /^(projects\/[^/]+\/branches\/[^/]+)/.exec(lakebase)?.[1] ?? '';
  const endpoint = /^(projects\/[^/]+\/branches\/[^/]+\/endpoints\/[^/]+)/.exec(lakebase)?.[1] ?? '';
  if (project) {
    targets.push(
      target({
        kind: 'lakebase-project',
        name: project,
        label: `Lakebase project · ${project.replace(/^projects\//, '')}`,
        support: 'supported',
        detail: 'Lakebase project custom tags are forwarded for billing and cost tracking.',
        nextAction: '',
        requiredScope: 'postgres',
        identity: 'obo',
      })
    );
  }
  if (branch) {
    targets.push(
      metadataOnly(
        'lakebase-branch',
        branch,
        `Lakebase branch · ${branch.split('/').slice(-1)[0]}`,
        'Lakebase billing tags are defined at project level, not branch level.',
        'Use the project tag shown above.'
      )
    );
  }
  if (endpoint) {
    targets.push(
      metadataOnly(
        'lakebase-endpoint',
        endpoint,
        `Lakebase endpoint · ${endpoint.split('/').slice(-1)[0]}`,
        'Lakebase billing tags are defined at project level, not compute-endpoint level.',
        'Use the project tag shown above.'
      )
    );
  }

  const seen = new Set<string>();
  return targets.filter((item) => {
    const apiKey = item.kind === 'serving-endpoint' ? `serving:${item.name}` : `${item.kind}:${item.name}`;
    if (seen.has(apiKey)) return false;
    seen.add(apiKey);
    return true;
  });
}

function hasTag(tags: readonly KeyValueTag[]): boolean {
  return tags.some((tag) => tag.key === ADAPT_TAG.key && tag.value === ADAPT_TAG.value);
}

function hasRetiredTag(tags: readonly KeyValueTag[]): boolean {
  return tags.some((tag) => tag.key === RETIRED_BILLING_TAG_KEY);
}

function mergeTag(tags: readonly KeyValueTag[]): KeyValueTag[] {
  return [...tags.filter((tag) => tag.key !== ADAPT_TAG.key && tag.key !== RETIRED_BILLING_TAG_KEY), { ...ADAPT_TAG }];
}

function tagStateDetail(state: 'already-correct' | 'tagged', retired = false): string {
  const lead = state === 'already-correct' ? `Already correct: ${billingTagPair()}.` : `Applied ${billingTagPair()}.`;
  return retired ? `${lead} Removed the retired ${RETIRED_BILLING_TAG_KEY} key.` : lead;
}

function errorStatus(error: unknown): number {
  const shape = error as { statusCode?: unknown; status?: unknown };
  return Number(shape?.statusCode ?? shape?.status ?? 0);
}

function errorCode(error: unknown): string {
  const shape = error as { error_code?: unknown; code?: unknown };
  const code = shape?.error_code ?? shape?.code;
  return typeof code === 'string' || typeof code === 'number' ? String(code).toUpperCase() : '';
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function technicalDetail(error: unknown): string {
  return errorText(error)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[principal redacted]')
    .replace(/(client[_ -]?secret|access[_ -]?token|authorization)\s*[:=]\s*[^\s,}]+/gi, '$1=[redacted]')
    .slice(0, 2_000);
}

function isPermissionError(error: unknown): boolean {
  return (
    errorStatus(error) === 401 ||
    errorStatus(error) === 403 ||
    /PERMISSION_DENIED|FORBIDDEN|UNAUTHORI[ZS]ED|INSUFFICIENT_SCOPE/i.test(`${errorCode(error)} ${errorText(error)}`)
  );
}

function retryAfterMs(error: unknown): number {
  const value = Number((error as { retryAfterMs?: unknown }).retryAfterMs ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function isRetryable(error: unknown): boolean {
  const status = errorStatus(error);
  if (status === 429 || (status >= 500 && status <= 599)) return true;
  return /DEADLINE_EXCEEDED|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|EAI_AGAIN|TimeoutError/i.test(
    `${errorCode(error)} ${errorText(error)}`
  );
}

function abortError(): Error {
  return Object.assign(new Error('Resource tagging was cancelled.'), { name: 'AbortError' });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

interface ResolvedRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  timeBudgetMs: number;
  sleep: (delayMs: number) => Promise<void>;
  now: () => number;
  random: () => number;
}

async function insideDeadline<T>(
  operation: () => Promise<T>,
  deadline: number,
  now: () => number,
  signal?: AbortSignal
): Promise<T> {
  throwIfAborted(signal);
  const remaining = deadline - now();
  if (remaining <= 0) throw Object.assign(new Error('Databricks tag operation timed out.'), { code: 'ETIMEDOUT' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(Object.assign(new Error('Databricks tag operation timed out.'), { code: 'ETIMEDOUT' })),
          remaining
        );
        if (signal) {
          abortListener = () => reject(abortError());
          signal.addEventListener('abort', abortListener, { once: true });
        }
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && abortListener) signal.removeEventListener('abort', abortListener);
  }
}

async function retryTransient<T>(
  operation: () => Promise<T>,
  policy: ResolvedRetryPolicy,
  signal?: AbortSignal
): Promise<T> {
  const deadline = policy.now() + policy.timeBudgetMs;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await insideDeadline(operation, deadline, policy.now, signal);
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      if (!isRetryable(error) || attempt >= policy.maxAttempts) throw error;
      const jitter = Math.floor(policy.baseDelayMs * policy.random());
      const delay = Math.max(retryAfterMs(error), policy.baseDelayMs * 2 ** (attempt - 1) + jitter);
      if (policy.now() + delay >= deadline) throw error;
      await policy.sleep(delay);
      throwIfAborted(signal);
    }
  }
}

function permissionResult(target0: ResourceTagTarget, error?: unknown): ResourceTagResult {
  const appIdentity = target0.identity === 'app-service-principal';
  const subject =
    target0.kind === 'serving-endpoint'
      ? `CAN_MANAGE on serving endpoint “${target0.name}”`
      : target0.kind === 'sql-warehouse'
        ? `CAN_MANAGE or IS_OWNER on SQL warehouse “${target0.name}”`
        : target0.kind === 'lakebase-project'
          ? `owner or management permission on Lakebase project “${target0.name.replace(/^projects\//, '')}”`
          : `management permission on “${target0.name}”`;
  const scope =
    !appIdentity && target0.requiredScope
      ? ` Ensure the app requests \`${target0.requiredScope}\`, then restart it.`
      : '';
  return {
    ...target0,
    status: 'permission-required',
    detail: appIdentity
      ? `A workspace administrator must grant ${subject}.`
      : `The signed-in administrator needs ${subject}.${scope}`,
    nextAction: `Grant ${subject}.${scope}`,
    technicalDetail: error ? technicalDetail(error) : undefined,
  };
}

function failedResult(target0: ResourceTagTarget, error: unknown): ResourceTagResult {
  if (isPermissionError(error)) return permissionResult(target0, error);
  return {
    ...target0,
    status: 'failed',
    detail: isRetryable(error)
      ? 'Databricks did not complete this retryable operation within the bounded retry policy.'
      : 'Databricks rejected this tag operation.',
    nextAction: isRetryable(error)
      ? 'Retry this unresolved resource.'
      : 'Open technical details and correct the request.',
    technicalDetail: technicalDetail(error),
  };
}

function staticResult(target0: ResourceTagTarget): ResourceTagResult {
  return {
    ...target0,
    status: target0.support === 'unsupported' ? 'unsupported' : 'not-applicable',
  };
}

function requiredScopePresent(token: string, required: string | undefined): boolean {
  if (!required) return true;
  const scopes = scopesFromToken(token);
  if (!scopes) return true;
  return scopes.includes('all-apis') || scopes.includes(required);
}

async function tagSupported(
  target0: ResourceTagTarget,
  platform: ResourceTagPlatform,
  signal?: AbortSignal
): Promise<ResourceTagResult> {
  if (target0.kind === 'serving-endpoint') {
    const tags = await platform.getServingTags(target0.name, signal);
    const current = hasTag(tags);
    const retired = hasRetiredTag(tags);
    if (current && !retired)
      return { ...target0, status: 'already-correct', detail: tagStateDetail('already-correct') };
    await platform.patchServingTags(
      target0.name,
      current ? [] : [{ ...ADAPT_TAG }],
      retired ? [RETIRED_BILLING_TAG_KEY] : [],
      signal
    );
    return { ...target0, status: 'tagged', detail: tagStateDetail('tagged', retired) };
  }
  if (target0.kind === 'sql-warehouse') {
    const tags = await platform.getWarehouseTags(target0.name, signal);
    if (hasTag(tags) && !hasRetiredTag(tags)) {
      return { ...target0, status: 'already-correct', detail: tagStateDetail('already-correct') };
    }
    await platform.setWarehouseTags(target0.name, mergeTag(tags), signal);
    return { ...target0, status: 'tagged', detail: tagStateDetail('tagged', hasRetiredTag(tags)) };
  }
  if (target0.kind === 'lakebase-project') {
    const tags = await platform.getLakebaseTags(target0.name, signal);
    if (hasTag(tags) && !hasRetiredTag(tags)) {
      return { ...target0, status: 'already-correct', detail: tagStateDetail('already-correct') };
    }
    await platform.setLakebaseTags(target0.name, mergeTag(tags), signal);
    return { ...target0, status: 'tagged', detail: tagStateDetail('tagged', hasRetiredTag(tags)) };
  }
  return staticResult(target0);
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  signal: AbortSignal | undefined,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const worker = async () => {
    while (next < values.length) {
      throwIfAborted(signal);
      const index = next++;
      results[index] = await mapper(values[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

function resultKey(value: Pick<ResourceTagResult | ResourceTagTarget, 'kind' | 'name'>): string {
  return `${value.kind}\u0000${value.name}`;
}

function summarize(results: ResourceTagResult[], updatedAt = new Date().toISOString()): ResourceTagSummary {
  const supported = results.filter((result) => result.support === 'supported');
  const tagged = supported.filter((result) => result.status === 'tagged').length;
  const alreadyCorrect = supported.filter((result) => result.status === 'already-correct').length;
  const supportedCovered = tagged + alreadyCorrect;
  const permissionRequired = supported.filter((result) => result.status === 'permission-required').length;
  const supportedFailed = supported.filter((result) => result.status === 'failed').length;
  const unsupported = results.filter((result) => result.status === 'unsupported').length;
  const notApplicable = results.filter((result) => result.status === 'not-applicable').length;
  return {
    headline: `${supportedCovered} of ${supported.length} supported resources tagged`,
    supportedTotal: supported.length,
    supportedCovered,
    tagged,
    alreadyCorrect,
    supportedFailed,
    permissionRequired,
    unsupported,
    notApplicable,
    results,
    updatedAt,
  };
}

export async function applyAdaptTags(input: {
  report: PreflightReport | null;
  environment?: NodeJS.ProcessEnv;
  platform?: ResourceTagPlatform;
  token?: string | null;
  host?: string;
  previous?: ResourceTagSummary | null;
  mode?: 'unresolved' | 'full';
  retry?: ResourceTagRetryPolicy;
  signal?: AbortSignal;
}): Promise<ResourceTagSummary> {
  const environment = input.environment ?? process.env;
  const token = input.token?.trim() ?? '';
  const platform =
    input.platform ??
    (token
      ? createWorkspaceTagPlatform({
          host: input.host ?? environment.DATABRICKS_HOST ?? '',
          token,
        })
      : null);
  const mode = input.mode ?? 'unresolved';
  const policy: ResolvedRetryPolicy = {
    maxAttempts: Math.max(1, Math.min(4, input.retry?.maxAttempts ?? 3)),
    baseDelayMs: Math.max(0, Math.min(2_000, input.retry?.baseDelayMs ?? 250)),
    timeBudgetMs: Math.max(1_000, Math.min(15_000, input.retry?.timeBudgetMs ?? 12_000)),
    sleep: input.retry?.sleep ?? ((delay) => new Promise((resolve) => setTimeout(resolve, delay))),
    now: input.retry?.now ?? Date.now,
    random: input.retry?.random ?? Math.random,
  };
  const previous = new Map((input.previous?.results ?? []).map((result) => [resultKey(result), result]));
  const inventory = resourceTagInventory({ environment, report: input.report });

  const fixed: ResourceTagResult[] = [];
  const pending: Array<{ target: ResourceTagTarget; platform: ResourceTagPlatform }> = [];
  for (const item of inventory) {
    if ('status' in item) {
      fixed.push(item as ResourceTagResult);
      continue;
    }
    if (item.support !== 'supported') {
      fixed.push(staticResult(item));
      continue;
    }
    const prior = previous.get(resultKey(item));
    if (mode === 'unresolved' && prior && (prior.status === 'tagged' || prior.status === 'already-correct')) {
      fixed.push(prior);
      continue;
    }
    const selectedPlatform = platform;
    const missingObo =
      item.identity !== 'app-service-principal' && (!token || !requiredScopePresent(token, item.requiredScope));
    if (!selectedPlatform || missingObo) {
      fixed.push(permissionResult(item));
      continue;
    }
    pending.push({ target: item, platform: selectedPlatform });
  }

  const attempted = await mapConcurrent(
    pending,
    Math.max(1, Math.min(4, input.retry?.concurrency ?? 3)),
    input.signal,
    async ({ target: item, platform: selectedPlatform }) => {
      try {
        return await retryTransient(() => tagSupported(item, selectedPlatform, input.signal), policy, input.signal);
      } catch (error) {
        if ((error as Error).name === 'AbortError') throw error;
        return failedResult(item, error);
      }
    }
  );
  const byKey = new Map([...fixed, ...attempted].map((result) => [resultKey(result), result]));
  const ordered = inventory.map((item) => byKey.get(resultKey(item))!).filter(Boolean);
  return summarize(ordered);
}

class DatabricksTagError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfterMs: number
  ) {
    super(message);
  }
}

function retryHeaderMs(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
}

export function createWorkspaceTagPlatform(input: {
  host: string;
  token: string;
  fetchImpl?: typeof fetch;
}): ResourceTagPlatform {
  const host = normalizeWorkspaceHost(input.host);
  if (!host) throw new Error('The Databricks workspace host is not configured.');
  const fetchImpl = input.fetchImpl ?? fetch;
  const request = async <T>(
    path: string,
    options: { method?: string; body?: unknown; signal?: AbortSignal } = {}
  ): Promise<T> => {
    const response = await fetchImpl(`${host}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        authorization: `Bearer ${input.token}`,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const message =
        typeof body.message === 'string'
          ? body.message
          : typeof body.error === 'string'
            ? body.error
            : `Databricks answered HTTP ${response.status}.`;
      const code = typeof body.error_code === 'string' ? body.error_code : `HTTP_${response.status}`;
      throw new DatabricksTagError(message, response.status, code, retryHeaderMs(response.headers.get('retry-after')));
    }
    return body as T;
  };
  const encode = encodeURIComponent;
  return {
    async getServingTags(name, signal) {
      const body = await request<{ tags?: KeyValueTag[] }>(`/api/2.0/serving-endpoints/${encode(name)}`, { signal });
      return body.tags ?? [];
    },
    async patchServingTags(name, add, remove, signal) {
      await request(`/api/2.0/serving-endpoints/${encode(name)}/tags`, {
        method: 'PATCH',
        body: { add_tags: add, delete_tags: remove },
        signal,
      });
    },
    async getWarehouseTags(id, signal) {
      const body = await request<{ tags?: { custom_tags?: KeyValueTag[] } }>(`/api/2.0/sql/warehouses/${encode(id)}`, {
        signal,
      });
      return body.tags?.custom_tags ?? [];
    },
    async setWarehouseTags(id, tags, signal) {
      await request(`/api/2.0/sql/warehouses/${encode(id)}/edit`, {
        method: 'POST',
        body: { tags: { custom_tags: tags } },
        signal,
      });
    },
    async getLakebaseTags(name, signal) {
      const body = await request<{
        spec?: { custom_tags?: KeyValueTag[] };
        status?: { custom_tags?: KeyValueTag[] };
      }>(`/api/2.0/postgres/${name}`, { signal });
      return body.spec?.custom_tags ?? body.status?.custom_tags ?? [];
    },
    async setLakebaseTags(name, tags, signal) {
      await request(`/api/2.0/postgres/${name}?update_mask=spec.custom_tags`, {
        method: 'PATCH',
        body: { name, spec: { custom_tags: tags } },
        signal,
      });
    },
  };
}

/**
 * Organizational app-tag state retained for Ops diagnostics only. It is not
 * billing coverage and the Resource Tags action never writes it.
 */
export async function readAppBillingTag(
  appName: string,
  platform?: { getAppTag(appName: string): Promise<string | null> }
): Promise<AppBillingTagState> {
  const name = appName.trim();
  if (!name || !platform) return 'unverified';
  try {
    return (await platform.getAppTag(name)) === ADAPT_TAG.value ? 'matched' : 'missing';
  } catch {
    return 'unverified';
  }
}
