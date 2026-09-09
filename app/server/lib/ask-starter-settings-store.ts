import {
  DEFAULT_ASK_STARTER_SETTINGS,
  parseAskStarterSettings,
  type AskStarterSettings,
} from '../../shared/ask-starters';
import { appTable } from '../../shared/app-schema';
import type { LakebaseReader } from './lakebase-store';
import {
  readVersionedSettings,
  writeVersionedSettingsPatch,
  type VersionedSettings,
  type VersionedSettingsStore,
} from './versioned-settings-store';

const KEY = 'effective';
export const ASK_STARTER_SETTINGS_TABLE = appTable('ask_starter_settings');
export const ASK_STARTER_SETTINGS_DDL = `CREATE TABLE IF NOT EXISTS ${ASK_STARTER_SETTINGS_TABLE} (
  id TEXT PRIMARY KEY,
  settings JSONB NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NOT NULL
)`;

const STORE: VersionedSettingsStore<AskStarterSettings> = {
  table: ASK_STARTER_SETTINGS_TABLE,
  key: KEY,
  defaults: DEFAULT_ASK_STARTER_SETTINGS,
  prepare: parseAskStarterSettings,
  parse: parseAskStarterSettings,
};

export function readAskStarterSettings(client: LakebaseReader): Promise<VersionedSettings<AskStarterSettings>> {
  return readVersionedSettings(client, STORE);
}

export function writeAskStarterSettings(
  client: LakebaseReader,
  patch: unknown,
  revision: number,
  updatedBy: string
): Promise<VersionedSettings<AskStarterSettings>> {
  return writeVersionedSettingsPatch(client, STORE, patch, revision, updatedBy);
}
