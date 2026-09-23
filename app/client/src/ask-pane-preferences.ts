/**
 * Per-browser collapse preferences for Ask's conversation and insight rails.
 *
 * Both panes default to expanded. A reader who collapses one keeps that choice
 * in this browser. Storage is best effort: sandboxed contexts can reject access.
 */
export type AskPane = 'rail' | 'inspector';

const KEYS: Record<AskPane, string> = {
  rail: 'adapt.ask.rail-collapsed',
  inspector: 'adapt.ask.inspector-collapsed',
};

function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function paneStartsCollapsed(pane: AskPane): boolean {
  const storage = store();
  if (!storage) return false;
  try {
    return storage.getItem(KEYS[pane]) === 'true';
  } catch {
    return false;
  }
}

export function rememberPaneCollapsed(pane: AskPane, collapsed: boolean): void {
  const storage = store();
  if (!storage) return;
  try {
    storage.setItem(KEYS[pane], collapsed ? 'true' : 'false');
  } catch {
    // The in-memory state still works for this session.
  }
}
