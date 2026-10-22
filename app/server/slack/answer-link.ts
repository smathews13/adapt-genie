/**
 * The "open in ADAPT" link on a Slack answer.
 *
 * It opens the conversation in ADAPT Ask, which is a page. The run trace
 * endpoint is JSON keyed by message id, so a Slack run id there answers 404.
 * `c` must match `CONVERSATION_PARAM` in client/src/conversation-links.ts.
 */
export function slackAnswerLink(appUrl: string | undefined, conversationId: string): string {
  const base = appUrl?.trim();
  if (!base) throw new Error('Authenticated ADAPT app URL is unavailable.');
  const url = new URL('/', base);
  url.searchParams.set('c', conversationId);
  return url.toString();
}
