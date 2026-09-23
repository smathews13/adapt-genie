export type SlackOperationalEvent =
  | 'received'
  | 'deduped'
  | 'identity_denied'
  | 'admitted'
  | 'blocked'
  | 'delivery_sent'
  | 'delivery_failed'
  | 'revoked';

export interface SlackOperationalAuditEntry {
  event: SlackOperationalEvent;
  workspaceHash: string;
  eventHash?: string;
  userHash?: string;
  channelHash?: string;
  threadHash?: string;
  runId?: string;
  deliveryId?: string;
  safeErrorClass?: string;
}

export type SlackOperationalAudit = (entry: SlackOperationalAuditEntry) => void | Promise<void>;

/**
 * Structured operational evidence only. Callers cannot pass prompt, answer,
 * token, authorization, or governed payload fields because they are absent from
 * the contract.
 */
export const logSlackOperationalAudit: SlackOperationalAudit = (entry) => {
  console.info('[slack-audit]', JSON.stringify(entry));
};
