import type { SlackMessage } from '../../shared/channel/slack-message';

export interface SlackBlocksValidateResult {
  ok: boolean;
  errors: readonly string[];
}

/**
 * Optional network integration boundary for Slack's `blocks.validate` method.
 * Deterministic unit tests use the local schema validator; no implementation is
 * installed or called during app startup.
 */
export interface SlackBlocksValidator {
  validate(blocks: SlackMessage['blocks']): Promise<SlackBlocksValidateResult>;
}

export async function validateWithSlack(
  validator: SlackBlocksValidator,
  message: Pick<SlackMessage, 'blocks'>
): Promise<SlackBlocksValidateResult> {
  return validator.validate(message.blocks);
}
