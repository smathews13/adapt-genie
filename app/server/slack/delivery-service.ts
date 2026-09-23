import type { RunEnvelope } from '../../shared/channel/run-contracts';
import { egressAllowed } from '../../shared/egress-contract';
import {
  renderSlackLinkOutMessage,
  renderSlackRunMessage,
  type SlackMessage,
} from '../../shared/channel/slack-message';
import type { GovernedRunService } from '../lib/governed-run-service';
import { readEgressControls } from '../lib/egress-store';
import type { SafeSlackDirectMessage } from './socket-mode-adapter';
import type { SlackOperationalAudit } from './audit';
import { SlackMessageTransportError, type SlackMessageClient } from './message-client';
import {
  recordSlackDeliveryAttempt,
  recordSlackDeliveryProgress,
  type SlackDelivery,
  type SlackStore,
} from './state-store';

export interface SlackDeliveryServiceOptions {
  maxPolls?: number;
  pollIntervalMs?: number;
  maxAttempts?: number;
  maxRetryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  egressPolicy?: () => Promise<boolean>;
}

const TERMINAL = new Set<RunEnvelope['state']>([
  'complete',
  'partial',
  'clarification_required',
  'blocked',
  'cancelled',
  'expired',
]);

export class SlackDeliveryService {
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly store: SlackStore,
    private readonly client: SlackMessageClient,
    private readonly runs: Pick<GovernedRunService, 'get'>,
    private readonly audit: SlackOperationalAudit,
    private readonly runUrl: (runId: string) => string,
    private readonly options: SlackDeliveryServiceOptions = {}
  ) {
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private async post(message: SlackMessage, event: SafeSlackDirectMessage): Promise<string> {
    const allowed = this.options.egressPolicy
      ? await this.options.egressPolicy().catch(() => false)
      : await readEgressControls({ lakebase: this.store }, { maxAgeMs: 0 })
          .then((reading) => egressAllowed(reading.controls, 'slack-message'))
          .catch(() => false);
    if (!allowed) throw new SlackMessageTransportError('egress_blocked', null, false);
    const attempts = Math.min(5, Math.max(1, this.options.maxAttempts ?? 3));
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return (
          await this.client.postMessage({
            ...message,
            channel: event.runtime().channelId,
            threadTs: event.runtime().threadId,
          })
        ).messageId;
      } catch (error) {
        const transport =
          error instanceof SlackMessageTransportError
            ? error
            : new SlackMessageTransportError('transport_error', null, true);
        if (!transport.transient || attempt === attempts) throw transport;
        const delay = Math.min(
          this.options.maxRetryDelayMs ?? 5_000,
          Math.max(50, (transport.retryAfterSeconds ?? 2 ** (attempt - 1)) * 1000)
        );
        await this.#sleep(delay);
      }
    }
    throw new SlackMessageTransportError('retry_exhausted', null, true);
  }

  async deliverRun(input: {
    delivery: SlackDelivery;
    event: SafeSlackDirectMessage;
    owner: string;
    initial?: RunEnvelope;
  }): Promise<SlackDelivery> {
    const runId = input.delivery.runId;
    if (!runId) throw new Error('Run delivery requires a run id.');
    let delivery = input.delivery;
    let envelope = input.initial ?? (await this.runs.get(runId, input.owner));
    if (!envelope) throw new Error('The admitted run could not be read.');

    if (delivery.deliveryState === 'pending') {
      try {
        await this.post(renderSlackRunMessage({ ...envelope, state: 'running' }, this.runUrl(runId)), input.event);
      } catch (error) {
        const transport =
          error instanceof SlackMessageTransportError
            ? error
            : new SlackMessageTransportError('render_or_transport_failed', null, false);
        const failed = await recordSlackDeliveryAttempt(this.store, {
          deliveryId: delivery.deliveryId,
          runId,
          revision: delivery.revision,
          status: 'failed',
          deliveryState: transport.transient ? 'transient_failed' : 'permanent_failed',
          safeErrorClass: transport.safeErrorClass,
        });
        await this.audit({
          event: 'delivery_failed',
          workspaceHash: input.event.workspaceHash,
          eventHash: input.event.eventHash,
          runId,
          deliveryId: delivery.deliveryId,
          safeErrorClass: transport.safeErrorClass,
        });
        return failed.outcome === 'updated' ? failed.value : delivery;
      }
      const progress = await recordSlackDeliveryProgress(this.store, {
        deliveryId: delivery.deliveryId,
        runId,
        revision: delivery.revision,
      });
      if (progress.outcome === 'updated') delivery = progress.value;
    }

    const maxPolls = Math.min(300, Math.max(0, this.options.maxPolls ?? 120));
    for (let poll = 0; !TERMINAL.has(envelope.state) && poll < maxPolls; poll += 1) {
      await this.#sleep(this.options.pollIntervalMs ?? 1_000);
      envelope = (await this.runs.get(runId, input.owner)) ?? envelope;
    }
    if (!TERMINAL.has(envelope.state)) return delivery;
    return this.deliverEnvelope({ delivery, event: input.event, envelope });
  }

  async deliverEnvelope(input: {
    delivery: SlackDelivery;
    event: SafeSlackDirectMessage;
    envelope: RunEnvelope;
  }): Promise<SlackDelivery> {
    try {
      const messageId = await this.post(
        renderSlackRunMessage(input.envelope, this.runUrl(input.envelope.runId)),
        input.event
      );
      const updated = await recordSlackDeliveryAttempt(this.store, {
        deliveryId: input.delivery.deliveryId,
        runId: input.delivery.runId,
        revision: input.delivery.revision,
        status: 'sent',
        deliveryState: 'final_sent',
        messageId,
      });
      const value = updated.outcome === 'updated' ? updated.value : input.delivery;
      await this.audit({
        event: 'delivery_sent',
        workspaceHash: input.event.workspaceHash,
        eventHash: input.event.eventHash,
        runId: input.delivery.runId ?? undefined,
        deliveryId: input.delivery.deliveryId,
      });
      return value;
    } catch (error) {
      const transport =
        error instanceof SlackMessageTransportError
          ? error
          : new SlackMessageTransportError('render_or_transport_failed', null, false);
      const updated = await recordSlackDeliveryAttempt(this.store, {
        deliveryId: input.delivery.deliveryId,
        runId: input.delivery.runId,
        revision: input.delivery.revision,
        status: 'failed',
        deliveryState: transport.transient ? 'transient_failed' : 'permanent_failed',
        safeErrorClass: transport.safeErrorClass,
      });
      await this.audit({
        event: 'delivery_failed',
        workspaceHash: input.event.workspaceHash,
        eventHash: input.event.eventHash,
        runId: input.delivery.runId ?? undefined,
        deliveryId: input.delivery.deliveryId,
        safeErrorClass: transport.safeErrorClass,
      });
      return updated.outcome === 'updated' ? updated.value : input.delivery;
    }
  }

  async deliverLinkOut(input: {
    delivery: SlackDelivery;
    event: SafeSlackDirectMessage;
    message: string;
    actionUrl: string;
  }): Promise<SlackDelivery> {
    const envelope = renderSlackLinkOutMessage({ message: input.message, actionUrl: input.actionUrl });
    try {
      const messageId = await this.post(envelope, input.event);
      const updated = await recordSlackDeliveryAttempt(this.store, {
        deliveryId: input.delivery.deliveryId,
        runId: input.delivery.runId,
        revision: input.delivery.revision,
        status: 'sent',
        deliveryState: 'final_sent',
        deliveryKind: 'link_out',
        messageId,
      });
      await this.audit({
        event: 'delivery_sent',
        workspaceHash: input.event.workspaceHash,
        eventHash: input.event.eventHash,
        deliveryId: input.delivery.deliveryId,
      });
      return updated.outcome === 'updated' ? updated.value : input.delivery;
    } catch (error) {
      const transport =
        error instanceof SlackMessageTransportError
          ? error
          : new SlackMessageTransportError('transport_error', null, true);
      const updated = await recordSlackDeliveryAttempt(this.store, {
        deliveryId: input.delivery.deliveryId,
        runId: input.delivery.runId,
        revision: input.delivery.revision,
        status: 'failed',
        deliveryState: transport.transient ? 'transient_failed' : 'permanent_failed',
        deliveryKind: 'link_out',
        safeErrorClass: transport.safeErrorClass,
      });
      await this.audit({
        event: 'delivery_failed',
        workspaceHash: input.event.workspaceHash,
        eventHash: input.event.eventHash,
        deliveryId: input.delivery.deliveryId,
        safeErrorClass: transport.safeErrorClass,
      });
      return updated.outcome === 'updated' ? updated.value : input.delivery;
    }
  }
}
