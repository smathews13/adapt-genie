export const MAX_CONVERSATION_FILTER_VALUES = 25;
export const MAX_OWNER_FILTER_LENGTH = 254;

export interface ConversationFilterSelection {
  owners: string[];
}

export interface ConversationFilterEvidence {
  id?: unknown;
  user_email?: unknown;
}

function queryValues(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) return value;
  return null;
}

function normalizedValues(
  raw: unknown,
  normalize: (value: string) => string,
  maxLength: number
): { ok: true; values: string[] } | { ok: false } {
  const values = queryValues(raw);
  if (!values) return { ok: false };
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of values) {
    const value = normalize(entry);
    if (!value || value.length > maxLength) return { ok: false };
    if (seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
    if (normalized.length === MAX_CONVERSATION_FILTER_VALUES) break;
  }
  return { ok: true, values: normalized };
}

/**
 * Validate the GET query without trusting it for authorization.
 *
 * Authorization decides the row set first. These values may only narrow that
 * already-authorized set.
 */
export function parseConversationFilterQuery(
  query: Record<string, unknown>
): { ok: true; value: ConversationFilterSelection } | { ok: false; message: string } {
  const owners = normalizedValues(query.owners, (value) => value.trim().toLowerCase(), MAX_OWNER_FILTER_LENGTH);
  if (!owners.ok) return { ok: false, message: 'Conversation filters contain an invalid owner.' };
  return {
    ok: true,
    value: {
      owners: owners.values,
    },
  };
}

export function conversationMatchesFilters(
  conversation: ConversationFilterEvidence,
  filters: ConversationFilterSelection
): boolean {
  const owner = typeof conversation.user_email === 'string' ? conversation.user_email.trim().toLowerCase() : '';
  if (filters.owners.length > 0 && !filters.owners.includes(owner)) return false;

  return true;
}

export function conversationFilterQueryString(filters: ConversationFilterSelection): string {
  const query = new URLSearchParams();
  for (const owner of filters.owners.slice(0, MAX_CONVERSATION_FILTER_VALUES)) query.append('owners', owner);
  return query.toString();
}
