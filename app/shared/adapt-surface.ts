/**
 * Product-surface cuts for ADAPT.
 *
 * Product-specific cuts for compatibility fields that are not shown by ADAPT.
 */
export const ADAPT_HIDDEN_CONNECTION_IDS = ['judge-endpoint', 'genie-dictionary'] as const;

const HIDDEN = new Set<string>(ADAPT_HIDDEN_CONNECTION_IDS);

export function isAdaptHiddenConnection(id: string): boolean {
  return HIDDEN.has(id);
}

export function isAdaptHiddenHealthRow(id: string, kind: string): boolean {
  void kind;
  return HIDDEN.has(id);
}
