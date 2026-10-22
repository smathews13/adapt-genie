import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  deploymentVariableSourceLabel,
  sortedDeploymentVariables,
  type DeploymentVariable,
} from './deployment-variables-view';

const row = (scope: DeploymentVariable['scope'], name: string): DeploymentVariable => ({
  scope,
  name,
  value: 'v',
  source: 'release',
  revision: 1,
  updatedBy: 'app boot',
  updatedAt: '2026-10-22T00:00:00.000Z',
});

describe('saved deployment values panel', () => {
  it('names each source in plain words', () => {
    expect(deploymentVariableSourceLabel('recovered')).toBe('Recovered from the app');
    expect(deploymentVariableSourceLabel('admin')).toBe('Saved in Settings');
  });

  it('lists release values before the Slack connection, alphabetically', () => {
    const sorted = sortedDeploymentVariables([
      row('slack_connection', 'SLACK_ADAPTER_ENABLED'),
      row('release', 'PLAYER_INSIGHTS_SCHEMA'),
      row('release', 'PLAYER_INSIGHTS_CATALOG'),
    ]);
    expect(sorted.map((entry) => entry.name)).toEqual([
      'PLAYER_INSIGHTS_CATALOG',
      'PLAYER_INSIGHTS_SCHEMA',
      'SLACK_ADAPTER_ENABLED',
    ]);
  });

  it('is shown to admins on the Environment tab and offers no editing', () => {
    const page = readFileSync(new URL('SettingsPage.tsx', import.meta.url), 'utf8');
    expect(page).toContain('<DeploymentVariablesPanel />');
    const panel = readFileSync(new URL('DeploymentVariablesPanel.tsx', import.meta.url), 'utf8');
    expect(panel).not.toMatch(/method: 'PUT'|<Input|<Button/);
  });
});
