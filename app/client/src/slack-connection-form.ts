import { SlackConnectionError } from './slack-connection-api';
import {
  SlackConnectionSchema,
  type SlackConnection,
  type SlackConnectionResponse,
} from '../../shared/slack-connection';

/** How long the "Saved" confirmation stays on the button. */
export const SAVED_CONFIRMATION_MS = 3000;

export type Draft = Record<keyof SlackConnection, string>;
export type FieldKey = Exclude<keyof SlackConnection, 'environment'>;

export const EMPTY_DRAFT: Draft = {
  environment: 'test',
  allowedTeamId: '',
  databricksWorkspaceHost: '',
  publicBaseUrl: '',
  oauthClientId: '',
  secretScope: 'adapt-app',
};

export function draftFrom(response: SlackConnectionResponse): Draft {
  const saved = response.connection ?? {};
  return {
    environment: saved.environment ?? EMPTY_DRAFT.environment,
    allowedTeamId: saved.allowedTeamId ?? '',
    databricksWorkspaceHost: saved.databricksWorkspaceHost ?? response.suggested.databricksWorkspaceHost,
    publicBaseUrl: saved.publicBaseUrl ?? response.suggested.publicBaseUrl,
    oauthClientId: saved.oauthClientId ?? '',
    secretScope: saved.secretScope ?? EMPTY_DRAFT.secretScope,
  };
}

/** The message to show under each field, from the same schema the server enforces. */
export function fieldErrors(draft: Draft): Partial<Record<FieldKey, string>> {
  const result = SlackConnectionSchema.safeParse(draft);
  if (result.success) return {};
  const errors: Partial<Record<FieldKey, string>> = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (typeof key !== 'string' || key === 'environment' || errors[key as FieldKey]) continue;
    const empty = !draft[key as FieldKey].trim();
    errors[key as FieldKey] = empty ? 'Required.' : issue.message;
  }
  return errors;
}

/** The server's own message when it gave one; a plain fallback for a dropped connection. */
export function failureMessage(error: unknown, fallback: string): string {
  return error instanceof SlackConnectionError && error.message ? error.message : fallback;
}
