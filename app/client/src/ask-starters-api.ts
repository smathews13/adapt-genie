import { ASK_STARTERS_MAX, type AskStarter, type AskStarterSettings } from '../../shared/ask-starters-browser';

export interface AskStarterSettingsDocument {
  settings: AskStarterSettings;
  revision: number;
}

const ASK_STARTERS_CHANGED = 'adapt:ask-starters-changed';

function detail(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const value = (body as { detail?: unknown }).detail;
  return typeof value === 'string' ? value : '';
}

function starter(value: unknown): AskStarter | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<Record<keyof AskStarter, unknown>>;
  if (
    typeof candidate.id !== 'string' ||
    !candidate.id.trim() ||
    candidate.id.length > 100 ||
    typeof candidate.kicker !== 'string' ||
    !candidate.kicker.trim() ||
    candidate.kicker.length > 40 ||
    typeof candidate.question !== 'string' ||
    !candidate.question.trim() ||
    candidate.question.length > 300
  ) {
    return null;
  }
  return {
    id: candidate.id.trim(),
    kicker: candidate.kicker.trim(),
    question: candidate.question.trim(),
  };
}

export async function askStarterSettingsFromResponse(response: Response): Promise<AskStarterSettingsDocument> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Starter questions answered ${response.status} without a readable response.`);
  }
  if (!response.ok) throw new Error(detail(body) || `Starter questions answered ${response.status}.`);
  const candidate = body as { settings?: { questions?: unknown }; revision?: unknown };
  const raw = candidate.settings?.questions;
  const questions = Array.isArray(raw) ? raw.map(starter) : null;
  if (
    !questions ||
    questions.length === 0 ||
    questions.length > ASK_STARTERS_MAX ||
    questions.some((question) => question === null) ||
    !Number.isInteger(candidate.revision) ||
    Number(candidate.revision) < 0
  ) {
    throw new Error('The server returned incomplete starter question settings.');
  }
  return {
    settings: { questions: questions as AskStarter[] },
    revision: Number(candidate.revision),
  };
}

export function notifyAskStartersChanged(settings: AskStarterSettings): void {
  window.dispatchEvent(new CustomEvent<AskStarterSettings>(ASK_STARTERS_CHANGED, { detail: settings }));
}

export function listenForAskStartersChanges(visit: (settings: AskStarterSettings) => void): () => void {
  const listener = (event: Event) => visit((event as CustomEvent<AskStarterSettings>).detail);
  window.addEventListener(ASK_STARTERS_CHANGED, listener);
  return () => window.removeEventListener(ASK_STARTERS_CHANGED, listener);
}
