import type { SlackConnection, SlackConnectionResponse } from '../../shared/slack-connection';

export class SlackConnectionError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'SlackConnectionError';
    this.status = status;
  }
}

async function failure(response: Response, fallback: string): Promise<SlackConnectionError> {
  let detail = '';
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === 'string') detail = body.detail.trim();
  } catch {
    detail = '';
  }
  return new SlackConnectionError(detail || fallback, response.status);
}

export async function loadSlackConnection(): Promise<SlackConnectionResponse> {
  const response = await fetch('/api/admin/slack/connection');
  if (!response.ok) throw await failure(response, 'Slack connection values could not be loaded.');
  return (await response.json()) as SlackConnectionResponse;
}

export async function saveSlackConnection(connection: SlackConnection): Promise<SlackConnectionResponse> {
  const response = await fetch('/api/admin/slack/connection', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(connection),
  });
  if (!response.ok) throw await failure(response, 'Slack connection values were not saved.');
  return (await response.json()) as SlackConnectionResponse;
}

export interface SlackSwitchDocument {
  revision: number;
  settings: { enabled: boolean; killSwitch: boolean; allowedRegistrationId: string };
}

export async function loadSlackSwitch(): Promise<SlackSwitchDocument> {
  const response = await fetch('/api/admin/slack/settings');
  if (!response.ok) throw await failure(response, 'The Slack on/off setting could not be loaded.');
  return (await response.json()) as SlackSwitchDocument;
}

export async function saveSlackSwitch(
  revision: number,
  on: boolean,
  registrationId: string
): Promise<SlackSwitchDocument> {
  const patch = on
    ? {
        enabled: true,
        killSwitch: false,
        allowedRegistrationId: registrationId,
        limits: {
          globalConcurrency: 8,
          workspaceConcurrency: 4,
          userConcurrency: 2,
          conversationConcurrency: 1,
          globalPerMinute: 100,
          workspacePerMinute: 50,
          userPerMinute: 10,
          conversationPerMinute: 5,
        },
      }
    : { enabled: false, killSwitch: true };
  const response = await fetch('/api/admin/slack/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision, patch }),
  });
  if (!response.ok) throw await failure(response, 'The Slack on/off setting was not saved.');
  return (await response.json()) as SlackSwitchDocument;
}
