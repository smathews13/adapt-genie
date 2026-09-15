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
export type WatchlistSettingsSource = 'default' | 'override';
export type ResolvedWatchlistSettings = VersionedSettings<WatchlistSettings> & {
  source: WatchlistSettingsSource;
  canReset: boolean;
};

function userKey(email: string): string {
  return `user:${email.trim().toLowerCase()}`;
}
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

function storeFor(key: string, defaults: WatchlistSettings): VersionedSettingsStore<WatchlistSettings> {
  return { ...STORE, key, defaults };
}

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

export async function readResolvedWatchlistSettings(
  client: LakebaseReader,
  email: string
): Promise<ResolvedWatchlistSettings> {
  const defaults = await readWatchlistSettings(client);
  const override = await readVersionedSettings(client, storeFor(userKey(email), defaults.settings));
  return override.revision > 0
    ? { ...override, source: 'override', canReset: true }
    : { ...defaults, source: 'default', canReset: false };
}

export async function writeUserWatchlistSettings(
  client: LakebaseReader,
  email: string,
  patch: unknown,
  revision: number
): Promise<ResolvedWatchlistSettings> {
  const defaults = await readWatchlistSettings(client);
  const document = await writeVersionedSettingsPatch(
    client,
    storeFor(userKey(email), defaults.settings),
    patch,
    revision,
    email
  );
  return { ...document, source: 'override', canReset: true };
}

export async function deleteUserWatchlistSettings(
  client: LakebaseReader,
  email: string
): Promise<ResolvedWatchlistSettings> {
  await client.lakebase.query(`DELETE FROM ${WATCHLIST_SETTINGS_TABLE} WHERE id = $1`, [userKey(email)]);
  const defaults = await readWatchlistSettings(client);
  return { ...defaults, source: 'default', canReset: false };
}

export async function deleteWatchlistSettingsDefaults(client: LakebaseReader): Promise<ResolvedWatchlistSettings> {
  await client.lakebase.query(`DELETE FROM ${WATCHLIST_SETTINGS_TABLE} WHERE id = $1`, [KEY]);
  return { settings: DEFAULT_WATCHLIST_SETTINGS, revision: 0, source: 'default', canReset: false };
}
