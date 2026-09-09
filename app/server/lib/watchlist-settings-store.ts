import { appTable } from '../../shared/app-schema';
import { DEFAULT_WATCHLIST_SETTINGS, parseWatchlistSettings, type WatchlistSettings } from '../../shared/watchlist';
import type { LakebaseReader } from './lakebase-store';
import {
  readVersionedSettings,
  writeVersionedSettingsPatch,
  type VersionedSettings,
  type VersionedSettingsStore,
} from './versioned-settings-store';

const KEY = 'effective';
export const WATCHLIST_SETTINGS_TABLE = appTable('watchlist_settings');
export const WATCHLIST_SETTINGS_DDL = `CREATE TABLE IF NOT EXISTS ${WATCHLIST_SETTINGS_TABLE} (
  id TEXT PRIMARY KEY,
  settings JSONB NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NOT NULL
)`;

const STORE: VersionedSettingsStore<WatchlistSettings> = {
  table: WATCHLIST_SETTINGS_TABLE,
  key: KEY,
  defaults: DEFAULT_WATCHLIST_SETTINGS,
  prepare: parseWatchlistSettings,
  parse: parseWatchlistSettings,
};

export function readWatchlistSettings(client: LakebaseReader): Promise<VersionedSettings<WatchlistSettings>> {
  return readVersionedSettings(client, STORE);
}

export function writeWatchlistSettings(
  client: LakebaseReader,
  patch: unknown,
  revision: number,
  updatedBy: string
): Promise<VersionedSettings<WatchlistSettings>> {
  return writeVersionedSettingsPatch(client, STORE, patch, revision, updatedBy);
}
