import { describe, expect, it } from 'vitest';
import { EMPTY_DRAFT, fieldErrors } from './slack-connection-form';

const valid = {
  ...EMPTY_DRAFT,
  allowedTeamId: 'T02EPKPG3',
  databricksWorkspaceHost: 'https://workspace.cloud.databricks.com',
  publicBaseUrl: 'https://adapt.databricksapps.com',
  oauthClientId: 'client-id',
  secretScope: 'adapt-app',
};

describe('Slack connection form errors', () => {
  it('has none for a complete, correct draft', () => {
    expect(fieldErrors(valid)).toEqual({});
  });

  it('says "Required." for blank fields', () => {
    const errors = fieldErrors({ ...EMPTY_DRAFT, secretScope: '' });
    expect(errors.allowedTeamId).toBe('Required.');
    expect(errors.oauthClientId).toBe('Required.');
    expect(errors.secretScope).toBe('Required.');
  });

  it('names the field that is wrong, and only that field', () => {
    const errors = fieldErrors({ ...valid, publicBaseUrl: 'adapt.example.com', allowedTeamId: 'bad' });
    expect(Object.keys(errors).sort()).toEqual(['allowedTeamId', 'publicBaseUrl']);
    expect(errors.publicBaseUrl).toMatch(/https/);
  });
});
