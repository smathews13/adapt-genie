/**
 * Identity configuration a deployment stated once and must keep after its
 * artifact stops stating it.
 *
 * Customer people and access-group names do not belong in a public artifact,
 * so a Deploy from Git can ship these keys empty. Whatever a deployment last
 * stated is recorded in the app-owned store and restored while the artifact is
 * silent. A stated value always wins and replaces its part of the record.
 */
import { appTable } from '../../shared/app-schema';
import {
  DEPLOYMENT_DECISIONS_TABLE_NAME,
  decisionSource,
  readDeploymentDecision,
  recordDeploymentDecision,
  type DecisionStore,
} from './deployment-decisions';

export const IDENTITY_CARRYOVER_DECISION = 'identity_carryover_v1';

export const IDENTITY_CARRYOVER_KEYS = [
  'ADAPT_SUPER_ADMIN_EMAILS',
  'ADAPT_ADMIN_GROUP_LABEL',
  'ADAPT_USER_GROUP_LABEL',
  'PLAYER_INSIGHTS_PREFERENCE_DEFAULT_OWNER',
] as const;

export type IdentityCarryoverKey = (typeof IDENTITY_CARRYOVER_KEYS)[number];
type Env = Record<string, string | undefined>;
type IdentityRecord = Partial<Record<IdentityCarryoverKey, string>>;

/**
 * Role resolution matches members by these labels, so a label authorizes the
 * group it was stated with. The record keeps that group beside each label and
 * restores a label only while the deployment still names the same group.
 */
const LABEL_GROUP = {
  ADAPT_ADMIN_GROUP_LABEL: 'ADAPT_ADMIN_GROUP',
  ADAPT_USER_GROUP_LABEL: 'ADAPT_USER_GROUP',
} as const satisfies Partial<Record<IdentityCarryoverKey, string>>;
type LabelKey = keyof typeof LABEL_GROUP;
type StoredRecord = { values: IdentityRecord; labelGroups: Partial<Record<LabelKey, string>> };

function isLabelKey(key: IdentityCarryoverKey): key is LabelKey {
  return key in LABEL_GROUP;
}

function decisionTable(): string {
  return appTable(DEPLOYMENT_DECISIONS_TABLE_NAME);
}

function stated(env: Env): Partial<Record<IdentityCarryoverKey, string>> {
  return Object.fromEntries(
    IDENTITY_CARRYOVER_KEYS.flatMap((key) => {
      const value = (env[key] ?? '').trim();
      return value ? [[key, value] as const] : [];
    })
  );
}

function labelGroupsOf(env: Env): Partial<Record<LabelKey, string>> {
  return Object.fromEntries(
    (Object.keys(LABEL_GROUP) as LabelKey[]).flatMap((label) => {
      const group = (env[LABEL_GROUP[label]] ?? '').trim();
      return group ? [[label, group] as const] : [];
    })
  );
}

function parsedRecord(value: string | null): StoredRecord {
  if (!value) return { values: {}, labelGroups: {} };
  try {
    const candidate = JSON.parse(value) as unknown;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return { values: {}, labelGroups: {} };
    const record = candidate as Record<string, unknown>;
    const groups = record.labelGroups && typeof record.labelGroups === 'object' ? (record.labelGroups as Env) : {};
    return {
      values: stated(record as Env),
      labelGroups: Object.fromEntries(
        (Object.keys(LABEL_GROUP) as LabelKey[]).flatMap((label) => {
          const group = typeof groups[label] === 'string' ? groups[label].trim() : '';
          return group ? [[label, group] as const] : [];
        })
      ),
    };
  } catch {
    return { values: {}, labelGroups: {} };
  }
}

/** The record, or undefined when the store did not answer: an unreadable record must never be overwritten. */
async function readRecordStrict(store: DecisionStore): Promise<StoredRecord | undefined> {
  try {
    const result = await store.query(`SELECT value FROM ${decisionTable()} WHERE decision = $1`, [
      IDENTITY_CARRYOVER_DECISION,
    ]);
    const value = result.rows?.[0]?.value;
    return parsedRecord(typeof value === 'string' && value.trim() ? value.trim() : null);
  } catch {
    return undefined;
  }
}

function sameGroup(a: string | undefined, b: string | undefined): boolean {
  return Boolean(a?.trim()) && a?.trim().toLocaleLowerCase() === b?.trim().toLocaleLowerCase();
}

/** Keys still empty after the record is restored. Code defaults fill them later and must not replace a record. */
export function silentIdentityKeys(env: Env = process.env): IdentityCarryoverKey[] {
  return IDENTITY_CARRYOVER_KEYS.filter((key) => !(env[key] ?? '').trim());
}

/** Fill the keys this artifact leaves empty from the record. Returns how many were restored. */
export async function restoreIdentityCarryover(store: DecisionStore, env: Env = process.env): Promise<number> {
  if (decisionSource(env) === 'local') return 0;
  const silent = IDENTITY_CARRYOVER_KEYS.filter((key) => !(env[key] ?? '').trim());
  if (silent.length === 0) return 0;
  const record = parsedRecord(await readDeploymentDecision(store, decisionTable(), IDENTITY_CARRYOVER_DECISION));
  let restored = 0;
  for (const key of silent) {
    const value = record.values[key];
    if (!value) continue;
    if (isLabelKey(key) && !sameGroup(record.labelGroups[key], env[LABEL_GROUP[key]])) continue;
    env[key] = value;
    restored += 1;
  }
  return restored;
}

/**
 * Record what this boot states over the previous record, so a key the artifact is silent on keeps its value.
 *
 * `defaulted` names keys a code default filled rather than the deployment: they
 * seed an empty record but never replace a recorded value. Nothing is written
 * when the previous record cannot be read.
 */
export async function recordIdentityCarryover(
  store: DecisionStore,
  env: Env = process.env,
  defaulted: readonly IdentityCarryoverKey[] = []
): Promise<boolean> {
  if (decisionSource(env) === 'local') return false;
  const current = stated(env);
  if (Object.keys(current).length === 0) return false;
  const previous = await readRecordStrict(store);
  if (!previous) return false;
  const fromDefaults: IdentityRecord = {};
  const fromDeployment: IdentityRecord = {};
  for (const [key, value] of Object.entries(current) as [IdentityCarryoverKey, string][]) {
    (defaulted.includes(key) ? fromDefaults : fromDeployment)[key] = value;
  }
  const values = { ...fromDefaults, ...previous.values, ...fromDeployment };
  const currentGroups = labelGroupsOf(env);
  const labelGroups = Object.fromEntries(
    (Object.keys(LABEL_GROUP) as LabelKey[]).flatMap((label) => {
      const group = fromDeployment[label] ? currentGroups[label] : previous.labelGroups[label];
      return values[label] && group ? [[label, group] as const] : [];
    })
  );
  return recordDeploymentDecision(
    store,
    decisionTable(),
    IDENTITY_CARRYOVER_DECISION,
    JSON.stringify({ ...values, labelGroups }),
    'app boot'
  );
}
