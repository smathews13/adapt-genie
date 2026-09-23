import { z } from 'zod';
import type { RunEnvelope } from './run-contracts';

export const SLACK_MAX_BLOCKS = 50;
export const SLACK_MAX_SECTION_TEXT = 3000;
export const SLACK_MAX_FALLBACK_TEXT = 4000;

const PlainText = z.strictObject({
  type: z.literal('plain_text'),
  text: z.string().min(1).max(150),
  emoji: z.boolean().optional(),
});
const MrkdwnText = z.strictObject({
  type: z.literal('mrkdwn'),
  text: z.string().min(1).max(SLACK_MAX_SECTION_TEXT),
  verbatim: z.boolean().optional(),
});
const SlackBlockSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('header'), text: PlainText }),
  z.strictObject({ type: z.literal('section'), text: MrkdwnText }),
  z.strictObject({ type: z.literal('context'), elements: z.array(MrkdwnText).min(1).max(10) }),
  z.strictObject({ type: z.literal('divider') }),
]);

export const SlackMessageSchema = z.strictObject({
  text: z.string().min(1).max(SLACK_MAX_FALLBACK_TEXT),
  blocks: z.array(SlackBlockSchema).min(1).max(SLACK_MAX_BLOCKS),
});
export type SlackMessage = z.infer<typeof SlackMessageSchema>;

function escapeMrkdwn(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function plain(value: string): string {
  return value
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function section(text: string): z.infer<typeof SlackBlockSchema> {
  return { type: 'section', text: { type: 'mrkdwn', text } };
}

function runLink(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    throw new Error('Slack run links must use HTTPS.');
  }
  return `<${url.replace(/>/g, '%3E')}|Open this run in ADAPT>`;
}

function safeSummary(envelope: RunEnvelope, url: string, reason: string): SlackMessage {
  const state = envelope.state.replace(/_/g, ' ');
  return SlackMessageSchema.parse({
    text: `ADAPT run ${state}. Full details are available in ADAPT.`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `ADAPT · ${plain(state)}`, emoji: true } },
      section(`${escapeMrkdwn(reason)} No figures, units, caveats, or citations were silently truncated.`),
      section(runLink(url)),
    ],
  });
}

function stateTitle(state: RunEnvelope['state']): string {
  switch (state) {
    case 'clarification_required':
      return 'Clarification needed';
    case 'complete':
      return 'Answer complete';
    case 'partial':
      return 'Partial answer';
    case 'blocked':
      return 'Action needed';
    case 'cancelled':
      return 'Run cancelled';
    case 'expired':
      return 'Run expired';
    default:
      return 'Working on your question';
  }
}

/**
 * Project a governed run into documented, channel-neutral Block Kit fields.
 * The renderer never reads a prompt, SQL text, derivation detail, or chart data.
 */
export function renderSlackRunMessage(envelope: RunEnvelope, authenticatedRunUrl: string): SlackMessage {
  const link = runLink(authenticatedRunUrl);
  const blocks: z.infer<typeof SlackBlockSchema>[] = [
    { type: 'header', text: { type: 'plain_text', text: `ADAPT · ${stateTitle(envelope.state)}`, emoji: true } },
  ];

  if (envelope.state === 'running') {
    blocks.push(section('Your governed ADAPT run is in progress.'), section(link));
  } else if (envelope.state === 'clarification_required') {
    const clarification = envelope.clarification;
    blocks.push(section(`*Question*\n${escapeMrkdwn(clarification?.question ?? 'More information is required.')}`));
    if (clarification?.choices?.length) {
      blocks.push(
        section(`*Options*\n${clarification.choices.map((choice) => `• ${escapeMrkdwn(choice)}`).join('\n')}`)
      );
    }
    blocks.push(section(link));
  } else if (envelope.state === 'blocked') {
    blocks.push(section(escapeMrkdwn(envelope.blocked?.message ?? 'This run needs action in ADAPT.')));
    const action = envelope.blocked?.link;
    blocks.push(section(action ? `<${action.replace(/>/g, '%3E')}|Continue in ADAPT>` : link));
  } else if (envelope.state === 'cancelled' || envelope.state === 'expired') {
    blocks.push(
      section(
        envelope.state === 'cancelled'
          ? 'The governed run was cancelled before it produced a final answer.'
          : 'The governed run expired before it produced a final answer.'
      ),
      section(link)
    );
  } else {
    const answer = envelope.answer;
    if (!answer)
      return safeSummary(envelope, authenticatedRunUrl, 'The complete governed answer could not be projected.');
    if (answer.figures.length > 4) {
      return safeSummary(envelope, authenticatedRunUrl, 'The answer contains more than four figures.');
    }
    blocks.push(section(`*Takeaway*\n${escapeMrkdwn(answer.takeaway)}`));
    if (answer.narrative.trim()) blocks.push(section(escapeMrkdwn(answer.narrative)));
    if (answer.figures.length) {
      blocks.push(
        section(
          `*Key figures*\n${answer.figures
            .map(
              (figure) =>
                `• *${escapeMrkdwn(figure.label)}:* ${escapeMrkdwn(figure.display)} (${escapeMrkdwn(figure.comparison)})`
            )
            .join('\n')}`
        )
      );
    }
    if (answer.caveats.length) {
      blocks.push(section(`*Caveats*\n${answer.caveats.map((item) => `• ${escapeMrkdwn(item)}`).join('\n')}`));
    }
    if (answer.sources.length) {
      blocks.push(section(`*Sources*\n${answer.sources.map((source) => `• ${escapeMrkdwn(source.name)}`).join('\n')}`));
    }
    if (answer.charts.length) blocks.push(section(`Charts (${answer.charts.length}) are available in ADAPT.`));
    blocks.push(section(link));
  }

  const text = `ADAPT: ${stateTitle(envelope.state)}. ${plain(
    envelope.answer?.takeaway ?? envelope.clarification?.question ?? envelope.blocked?.message ?? ''
  )}`.trim();
  const candidate = { text, blocks };
  const parsed = SlackMessageSchema.safeParse(candidate);
  return parsed.success
    ? parsed.data
    : safeSummary(envelope, authenticatedRunUrl, 'This answer exceeds Slack message limits.');
}

/** Deterministic local validator; an optional integration can call Slack's blocks.validate separately. */
export function validateSlackMessage(
  value: unknown
): { ok: true; message: SlackMessage } | { ok: false; issues: string[] } {
  const parsed = SlackMessageSchema.safeParse(value);
  return parsed.success
    ? { ok: true, message: parsed.data }
    : { ok: false, issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) };
}

export function renderSlackLinkOutMessage(input: {
  message: string;
  actionUrl: string;
  actionLabel?: string;
}): SlackMessage {
  const link = runLink(input.actionUrl).replace(
    'Open this run in ADAPT',
    escapeMrkdwn(input.actionLabel ?? 'Sign in to ADAPT')
  );
  return SlackMessageSchema.parse({
    text: `ADAPT sign-in required. ${plain(input.message)}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'ADAPT · Sign-in required', emoji: true } },
      section(escapeMrkdwn(input.message)),
      section(link),
    ],
  });
}
