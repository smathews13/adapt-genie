import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RELEASE_ENVIRONMENT_KEYS } from '../lib/release-environment';
import { renderSlackSecretOverlay } from '../../../bundle/slack/apply-secret-overlay.mjs';

const root = path.resolve(__dirname, '..', '..', '..');
const bundle = fs.readFileSync(path.join(root, 'databricks.yml'), 'utf8');
const appResource = fs.readFileSync(path.join(root, 'resources', 'adapt_app.app.yml'), 'utf8');
const appYaml = fs.readFileSync(path.join(root, 'app', 'app.yaml'), 'utf8');
const publicAppYaml = fs.readFileSync(path.join(root, 'app', 'build', 'deploy', 'app.yaml'), 'utf8');
const overlay = JSON.parse(
  fs.readFileSync(path.join(root, 'bundle', 'slack', 'secret-bindings.overlay.json'), 'utf8')
) as unknown;
const secretResources = ['slack-app-token', 'slack-bot-token', 'slack-client-secret', 'slack-signing-secret'];

describe('Slack deployment contract', () => {
  it('authors only disabled, kill-switched, customer-neutral defaults', () => {
    expect(appYaml).toMatch(/name: SLACK_ADAPTER_ENABLED\n\s+value: 'false'/);
    expect(appYaml).toMatch(/name: SLACK_ADAPTER_KILL_SWITCH\n\s+value: 'true'/);
    expect(appYaml).toMatch(
      /name: SLACK_ADAPTER_OAUTH_SCOPES\n\s+value: 'all-apis offline_access openid profile email'/
    );
    for (const name of [
      'SLACK_ADAPTER_ALLOWED_TEAM_ID',
      'SLACK_ADAPTER_TEST_REGISTRATION_ID',
      'SLACK_ADAPTER_PRODUCTION_REGISTRATION_ID',
      'SLACK_ADAPTER_DATABRICKS_WORKSPACE',
      'SLACK_ADAPTER_OAUTH_EXPECTED_AUDIENCE',
      'SLACK_ADAPTER_OAUTH_CLIENT_ID',
      'SLACK_ADAPTER_OAUTH_CALLBACK_URL',
      'SLACK_ADAPTER_PUBLIC_BASE_URL',
      'SLACK_ADAPTER_TOKEN_BROKER_REF',
    ]) {
      expect(appYaml).toMatch(new RegExp(`name: ${name}\\n\\s+value: ''`));
    }
    expect(`${bundle}\n${appYaml}`).not.toMatch(/xox[baprs]-|xapp-|dapi[A-Za-z0-9]{8,}/);
  });

  it('keeps default bundle resources, source app, and public artifact free of Slack secret bindings', () => {
    for (const resource of secretResources) {
      expect(appResource).not.toContain(`- name: ${resource}`);
      expect(appYaml).not.toContain(`valueFrom: ${resource}`);
      expect(publicAppYaml).not.toContain(`valueFrom: ${resource}`);
    }
    expect(bundle).not.toMatch(/^\s{2}slack_secret_scope:/m);
    expect(bundle).not.toMatch(/^\s{2}slack_(?:app|bot)_token_secret_key:/m);
    expect(bundle).not.toMatch(/^\s{2}slack_(?:client|signing)_secret_key:/m);
    for (const secret of [
      'SLACK_ADAPTER_APP_TOKEN',
      'SLACK_ADAPTER_BOT_TOKEN',
      'SLACK_ADAPTER_CLIENT_SECRET',
      'SLACK_ADAPTER_SIGNING_SECRET',
    ]) {
      expect(RELEASE_ENVIRONMENT_KEYS).not.toContain(secret);
    }
  });

  it('adds all four resource/valueFrom bindings only through the reviewed overlay', () => {
    const merged = renderSlackSecretOverlay({ databricks: bundle, appResource, appYaml, overlay });
    for (const resource of secretResources) {
      expect(merged.appResource).toContain(`- name: ${resource}`);
      expect(merged.appYaml).toContain(`valueFrom: ${resource}`);
    }
    expect(merged.databricks).toMatch(/^\s{2}slack_secret_scope:/m);
    expect(merged.appYaml).toContain("name: SLACK_ADAPTER_APP_TOKEN_SECRET_REF\n    value: 'SLACK_ADAPTER_APP_TOKEN'");
    expect(() =>
      renderSlackSecretOverlay({
        databricks: merged.databricks,
        appResource: merged.appResource,
        appYaml: merged.appYaml,
        overlay,
      })
    ).toThrow(/already contains Slack secret binding/);
  });

  it('snapshots only non-secret Slack target configuration for Deploy from Git recovery', () => {
    expect(RELEASE_ENVIRONMENT_KEYS).toEqual(
      expect.arrayContaining([
        'SLACK_ADAPTER_ENVIRONMENT',
        'SLACK_ADAPTER_ENABLED',
        'SLACK_ADAPTER_KILL_SWITCH',
        'SLACK_ADAPTER_ALLOWED_TEAM_ID',
        'SLACK_ADAPTER_TEST_REGISTRATION_ID',
        'SLACK_ADAPTER_PRODUCTION_REGISTRATION_ID',
        'SLACK_ADAPTER_DATABRICKS_WORKSPACE',
        'SLACK_ADAPTER_OAUTH_EXPECTED_AUDIENCE',
        'SLACK_ADAPTER_OAUTH_CLIENT_ID',
        'SLACK_ADAPTER_OAUTH_CALLBACK_URL',
        'SLACK_ADAPTER_PUBLIC_BASE_URL',
        'SLACK_ADAPTER_TOKEN_BROKER_REF',
      ])
    );
  });
});
