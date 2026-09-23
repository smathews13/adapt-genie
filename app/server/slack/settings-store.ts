import {
  DEFAULT_SLACK_OPERATIONAL_SETTINGS,
  parseSlackOperationalSettings,
  type SlackOperationalSettings,
} from '../../shared/slack-settings';
import type { LakebaseReader } from '../lib/lakebase-store';
import {
  readVersionedSettings,
  writeVersionedSettingsPatch,
  type VersionedSettings,
  type VersionedSettingsStore,
} from '../lib/versioned-settings-store';
import { SLACK_SETTINGS_TABLE } from './schema';

const STORE: VersionedSettingsStore<SlackOperationalSettings> = {
  table: SLACK_SETTINGS_TABLE,
  key: 'effective',
  defaults: DEFAULT_SLACK_OPERATIONAL_SETTINGS,
  prepare: parseSlackOperationalSettings,
  parse: parseSlackOperationalSettings,
};

export interface EffectiveSlackSettings extends VersionedSettings<SlackOperationalSettings> {
  storeReady: boolean;
}

export async function readSlackSettings(client: LakebaseReader): Promise<VersionedSettings<SlackOperationalSettings>> {
  return readVersionedSettings(client, STORE);
}

export async function readEffectiveSlackSettings(client: LakebaseReader): Promise<EffectiveSlackSettings> {
  try {
    return { ...(await readSlackSettings(client)), storeReady: true };
  } catch {
    return { settings: DEFAULT_SLACK_OPERATIONAL_SETTINGS, revision: 0, storeReady: false };
  }
}

export function writeSlackSettings(
  client: LakebaseReader,
  patch: unknown,
  expectedRevision: number,
  updatedBy: string
): Promise<VersionedSettings<SlackOperationalSettings>> {
  return writeVersionedSettingsPatch(client, STORE, patch, expectedRevision, updatedBy);
}
