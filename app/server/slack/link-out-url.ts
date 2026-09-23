export class SlackLinkOutUrlUnavailableError extends Error {
  constructor() {
    super('The authenticated ADAPT app URL is unavailable.');
    this.name = 'SlackLinkOutUrlUnavailableError';
  }
}

/** Generic private app entry point. It carries no Slack identifiers or auth state. */
export function authenticatedAdaptLinkOutUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.DATABRICKS_APP_URL?.trim();
  if (!configured) throw new SlackLinkOutUrlUnavailableError();
  const url = new URL(configured);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new SlackLinkOutUrlUnavailableError();
  }
  url.search = '';
  url.hash = '';
  return url.toString();
}
