import { normalizeReaderText } from '../../shared/answer-content-policy';
import type { ConversationMessage } from './app-types';
import { normalizeAnswer, type WireAnswer } from './answer-shape';
import type { ReaderExportTurn } from './export-serializers';
import { stripToolCallDumps } from './reader-facing-answer';

const PLAN_APPROVAL_LABEL = 'Approved the proposed analysis plan.';

function storedResponse(message: ConversationMessage): Record<string, unknown> | null {
  if (!message.response_json) return null;
  const parsed =
    typeof message.response_json === 'string'
      ? (() => {
          try {
            return JSON.parse(message.response_json) as unknown;
          } catch {
            return null;
          }
        })()
      : message.response_json;
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function visiblePlan(response: Record<string, unknown>): string {
  const plan = response.plan && typeof response.plan === 'object' ? (response.plan as Record<string, unknown>) : {};
  const summary = text(plan.summary);
  const steps = Array.isArray(plan.steps)
    ? plan.steps
        .map((value, index) => {
          const step = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
          const title = text(step.title);
          const description = text(step.description);
          return [`${index + 1}. **${title || `Step ${index + 1}`}**`, description].filter(Boolean).join('\n   ');
        })
        .filter(Boolean)
    : [];
  return ['### Proposed analysis plan', summary, steps.join('\n')].filter(Boolean).join('\n\n');
}

function visibleClarification(response: Record<string, unknown>): string {
  const clarification =
    response.clarification && typeof response.clarification === 'object'
      ? (response.clarification as Record<string, unknown>)
      : {};
  const options = Array.isArray(clarification.options)
    ? clarification.options
        .map(text)
        .filter(Boolean)
        .map((option) => `- ${option}`)
    : [];
  return [
    '### Needs one detail',
    text(clarification.question),
    text(clarification.reason),
    options.length > 0 ? `Options\n${options.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function visibleRawAssistant(content: string): string {
  return stripToolCallDumps(normalizeReaderText(content, {}, 'raw')).trim();
}

function isStoredAnswer(response: Record<string, unknown>): boolean {
  if (response.type === 'answer') return true;
  if (response.type === 'plan' || response.type === 'clarification') return false;
  return ['takeaway', 'narrative', 'content', 'sources', 'caveats'].some((field) => field in response);
}

/** Convert stored rows to exactly the chronological content the transcript lets a reader see. */
export function readerConversationTurns(messages: readonly ConversationMessage[]): ReaderExportTurn[] {
  const turns: ReaderExportTurn[] = [];
  let previousAssistant: Record<string, unknown> | null = null;
  for (const message of messages) {
    if (message.role === 'user') {
      const previousPlan =
        previousAssistant?.type === 'plan' && previousAssistant.plan && typeof previousAssistant.plan === 'object'
          ? (previousAssistant.plan as Record<string, unknown>)
          : null;
      const content =
        message.content === PLAN_APPROVAL_LABEL && previousPlan
          ? [text(previousPlan.question), PLAN_APPROVAL_LABEL].filter(Boolean).join('\n\n')
          : message.content;
      turns.push({ role: 'user', content });
      continue;
    }

    const response = storedResponse(message);
    previousAssistant = response;
    if (response?.type === 'plan') {
      turns.push({ role: 'assistant', content: visiblePlan(response) });
    } else if (response?.type === 'clarification') {
      turns.push({ role: 'assistant', content: visibleClarification(response) });
    } else if (response && isStoredAnswer(response)) {
      turns.push({ role: 'assistant', answer: normalizeAnswer(response as WireAnswer) });
    } else {
      turns.push({ role: 'assistant', content: visibleRawAssistant(message.content) });
    }
  }
  return turns;
}
