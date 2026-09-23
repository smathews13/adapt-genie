import crypto from 'node:crypto';
import type { BoundIdentity } from '../lib/identity-binding';
import { DEFAULT_DATABRICKS_TOKEN_BROKER, type DatabricksTokenBroker } from '../lib/databricks-token-broker';
import { resolveSlackDelegatedIdentity } from '../lib/slack-delegated-identity';
import type { GovernedRunService } from '../lib/governed-run-service';
import type { SlackRuntimeEnvironment } from './config';
import type { SlackRuntimeConfig } from './config';
import type { SafeSlackDirectMessage } from './socket-mode-adapter';
import type { SlackOperationalAudit } from './audit';
import { SlackAdmissionController } from './admission';
import type { SlackDeliveryService } from './delivery-service';
import {
  claimSlackEvent,
  createSlackDelivery,
  readSlackInstallation,
  readSlackUserLink,
  readSlackDeliveryForEvent,
  recordSlackDeliveryAttempt,
  resolveOrCreateSlackConversationBinding,
  updateSlackEventClaim,
  type SlackDelivery,
  type SlackStore,
} from './state-store';

export type SlackIdentityResolution =
  | { allowed: true; ownerHash: string; delegatedIdentityRef: string; identity?: BoundIdentity }
  | { allowed: false; safeErrorClass: string };

export type SlackProcessResult =
  | { outcome: 'deduped'; runId: string | null; deliveryId: string | null }
  | { outcome: 'identity_denied' | 'blocked' | 'admitted'; retryAfterSeconds?: number; runId?: string };

export interface SlackEventProcessorDependencies {
  store: SlackStore;
  environment: SlackRuntimeEnvironment;
  admission: SlackAdmissionController;
  audit: SlackOperationalAudit;
  resolveIdentity(event: SafeSlackDirectMessage): Promise<SlackIdentityResolution>;
  startRun(
    event: SafeSlackDirectMessage,
    identity: { ownerHash: string; delegatedIdentityRef: string; identity?: BoundIdentity }
  ): Promise<{ runId: string; owner?: string }>;
  deliverRun?: (input: { delivery: SlackDelivery; event: SafeSlackDirectMessage; owner: string }) => Promise<unknown>;
  deliverBlocked?: (input: {
    delivery: SlackDelivery;
    event: SafeSlackDirectMessage;
    safeErrorClass: string;
  }) => Promise<SlackDelivery>;
  resumeDelivery?: (input: { delivery: SlackDelivery; event: SafeSlackDirectMessage }) => Promise<unknown>;
}

export function createSlackEventProcessor(
  dependencies: SlackEventProcessorDependencies
): (event: SafeSlackDirectMessage) => Promise<SlackProcessResult> {
  return async (event) => {
    await dependencies.audit({
      event: 'received',
      workspaceHash: event.workspaceHash,
      eventHash: event.eventHash,
      userHash: event.userHash,
      channelHash: event.channelHash,
      threadHash: event.threadHash,
    });
    const claim = await claimSlackEvent(dependencies.store, {
      environment: dependencies.environment,
      workspaceHash: event.workspaceHash,
      eventHash: event.eventHash,
      eventKind: event.kind,
    });
    if (!claim.claimed) {
      if (claim.deliveryId && dependencies.resumeDelivery) {
        const delivery = await readSlackDeliveryForEvent(dependencies.store, {
          environment: dependencies.environment,
          workspaceHash: event.workspaceHash,
          eventHash: event.eventHash,
        });
        if (
          delivery &&
          (delivery.deliveryState === 'pending' ||
            delivery.deliveryState === 'progress_sent' ||
            delivery.deliveryState === 'transient_failed')
        ) {
          try {
            await dependencies.resumeDelivery({ delivery, event });
          } catch {
            await recordSlackDeliveryAttempt(dependencies.store, {
              deliveryId: delivery.deliveryId,
              runId: delivery.runId,
              revision: delivery.revision,
              status: 'failed',
              deliveryState: 'transient_failed',
              deliveryKind: delivery.deliveryKind,
              safeErrorClass: 'delivery_resume_unavailable',
            });
            await updateSlackEventClaim(dependencies.store, {
              environment: dependencies.environment,
              workspaceHash: event.workspaceHash,
              eventHash: event.eventHash,
              status: 'failed',
              runId: delivery.runId,
              deliveryId: delivery.deliveryId,
              safeErrorClass: 'delivery_resume_unavailable',
            });
            await dependencies.audit({
              event: 'delivery_failed',
              workspaceHash: event.workspaceHash,
              eventHash: event.eventHash,
              runId: delivery.runId ?? undefined,
              deliveryId: delivery.deliveryId,
              safeErrorClass: 'delivery_resume_unavailable',
            });
          }
        }
      }
      await dependencies.audit({
        event: 'deduped',
        workspaceHash: event.workspaceHash,
        eventHash: event.eventHash,
        runId: claim.runId ?? undefined,
        deliveryId: claim.deliveryId ?? undefined,
      });
      return { outcome: 'deduped', runId: claim.runId, deliveryId: claim.deliveryId };
    }
    const existingDelivery = await readSlackDeliveryForEvent(dependencies.store, {
      environment: dependencies.environment,
      workspaceHash: event.workspaceHash,
      eventHash: event.eventHash,
    });
    if (existingDelivery) {
      const status =
        existingDelivery.status === 'sent'
          ? 'completed'
          : existingDelivery.status === 'failed'
            ? 'failed'
            : existingDelivery.status === 'revoked'
              ? 'blocked'
              : 'admitted';
      await updateSlackEventClaim(dependencies.store, {
        environment: dependencies.environment,
        workspaceHash: event.workspaceHash,
        eventHash: event.eventHash,
        status,
        runId: existingDelivery.runId,
        deliveryId: existingDelivery.deliveryId,
      });
      await dependencies.audit({
        event: 'deduped',
        workspaceHash: event.workspaceHash,
        eventHash: event.eventHash,
        runId: existingDelivery.runId ?? undefined,
        deliveryId: existingDelivery.deliveryId,
      });
      return {
        outcome: 'deduped',
        runId: existingDelivery.runId,
        deliveryId: existingDelivery.deliveryId,
      };
    }

    const identity = await dependencies.resolveIdentity(event);
    if (!identity.allowed) {
      const blockedDelivery = dependencies.deliverBlocked
        ? await createSlackDelivery(dependencies.store, {
            deliveryId: crypto.randomUUID(),
            environment: dependencies.environment,
            workspaceHash: event.workspaceHash,
            eventHash: event.eventHash,
            channelHash: event.channelHash,
            threadHash: event.threadHash,
            userHash: event.userHash,
            runId: null,
            deliveryKind: 'link_out',
          })
        : null;
      if (blockedDelivery && dependencies.deliverBlocked) {
        try {
          const delivered = await dependencies.deliverBlocked({
            delivery: blockedDelivery.value,
            event,
            safeErrorClass: identity.safeErrorClass,
          });
          if (delivered.status === 'failed') {
            await updateSlackEventClaim(dependencies.store, {
              environment: dependencies.environment,
              workspaceHash: event.workspaceHash,
              eventHash: event.eventHash,
              status: 'failed',
              runId: null,
              deliveryId: delivered.deliveryId,
              safeErrorClass: delivered.safeErrorClass ?? 'link_out_delivery_failed',
            });
            return { outcome: 'identity_denied' };
          }
        } catch {
          await recordSlackDeliveryAttempt(dependencies.store, {
            deliveryId: blockedDelivery.value.deliveryId,
            runId: blockedDelivery.value.runId,
            revision: blockedDelivery.value.revision,
            status: 'failed',
            deliveryState: 'transient_failed',
            deliveryKind: 'link_out',
            safeErrorClass: 'link_out_unavailable',
          });
          await updateSlackEventClaim(dependencies.store, {
            environment: dependencies.environment,
            workspaceHash: event.workspaceHash,
            eventHash: event.eventHash,
            status: 'failed',
            runId: null,
            deliveryId: blockedDelivery.value.deliveryId,
            safeErrorClass: 'link_out_unavailable',
          });
          await dependencies.audit({
            event: 'delivery_failed',
            workspaceHash: event.workspaceHash,
            eventHash: event.eventHash,
            deliveryId: blockedDelivery.value.deliveryId,
            safeErrorClass: 'link_out_unavailable',
          });
          return { outcome: 'identity_denied' };
        }
      }
      await updateSlackEventClaim(dependencies.store, {
        environment: dependencies.environment,
        workspaceHash: event.workspaceHash,
        eventHash: event.eventHash,
        status: 'blocked',
        runId: null,
        deliveryId: blockedDelivery?.value.deliveryId ?? null,
        safeErrorClass: identity.safeErrorClass,
      });
      await dependencies.audit({
        event: 'identity_denied',
        workspaceHash: event.workspaceHash,
        eventHash: event.eventHash,
        userHash: event.userHash,
        safeErrorClass: identity.safeErrorClass,
      });
      return { outcome: 'identity_denied' };
    }

    const admission = dependencies.admission.admit({
      workspaceHash: event.workspaceHash,
      userHash: event.userHash,
      conversationHash: `${event.channelHash}:${event.threadHash}`,
    });
    if (!admission.admitted) {
      await updateSlackEventClaim(dependencies.store, {
        environment: dependencies.environment,
        workspaceHash: event.workspaceHash,
        eventHash: event.eventHash,
        status: 'blocked',
        runId: null,
        deliveryId: null,
        safeErrorClass: admission.reason,
      });
      await dependencies.audit({
        event: 'blocked',
        workspaceHash: event.workspaceHash,
        eventHash: event.eventHash,
        safeErrorClass: admission.reason,
      });
      return { outcome: 'blocked', retryAfterSeconds: admission.retryAfterSeconds };
    }

    try {
      const run = await dependencies.startRun(event, identity);
      const delivery = await createSlackDelivery(dependencies.store, {
        deliveryId: crypto.randomUUID(),
        environment: dependencies.environment,
        workspaceHash: event.workspaceHash,
        eventHash: event.eventHash,
        channelHash: event.channelHash,
        threadHash: event.threadHash,
        userHash: event.userHash,
        runId: run.runId,
      });
      await updateSlackEventClaim(dependencies.store, {
        environment: dependencies.environment,
        workspaceHash: event.workspaceHash,
        eventHash: event.eventHash,
        status: 'admitted',
        runId: delivery.value.runId,
        deliveryId: delivery.value.deliveryId,
      });
      await dependencies.audit({
        event: 'admitted',
        workspaceHash: event.workspaceHash,
        eventHash: event.eventHash,
        runId: delivery.value.runId ?? undefined,
        deliveryId: delivery.value.deliveryId,
      });
      try {
        await dependencies.deliverRun?.({
          delivery: delivery.value,
          event,
          owner: run.owner ?? identity.ownerHash,
        });
      } catch {
        // The run is already admitted and must remain reusable. Delivery owns
        // its own durable retry state; never relabel this as a run-start failure.
        await dependencies.audit({
          event: 'delivery_failed',
          workspaceHash: event.workspaceHash,
          eventHash: event.eventHash,
          runId: run.runId,
          deliveryId: delivery.value.deliveryId,
          safeErrorClass: 'delivery_service_failed',
        });
      }
      return { outcome: 'admitted', runId: run.runId };
    } catch (error) {
      await updateSlackEventClaim(dependencies.store, {
        environment: dependencies.environment,
        workspaceHash: event.workspaceHash,
        eventHash: event.eventHash,
        status: 'failed',
        runId: null,
        deliveryId: null,
        safeErrorClass: 'run_start_failed',
      });
      await dependencies.audit({
        event: 'delivery_failed',
        workspaceHash: event.workspaceHash,
        eventHash: event.eventHash,
        safeErrorClass: 'run_start_failed',
      });
      throw error;
    } finally {
      admission.lease.release();
    }
  };
}

function deterministicId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${crypto.createHash('sha256').update(parts.join('\n')).digest('hex')}`;
}

export interface DefaultSlackProcessorDependencies {
  store: SlackStore;
  config: SlackRuntimeConfig;
  governedRuns: Pick<GovernedRunService, 'submit' | 'get'>;
  delivery: Pick<SlackDeliveryService, 'deliverRun' | 'deliverLinkOut'>;
  audit: SlackOperationalAudit;
  expectedAudience: string;
  broker?: DatabricksTokenBroker;
  admission?: SlackAdmissionController;
  linkOutUrl(event: SafeSlackDirectMessage, safeErrorClass: string): Promise<string>;
}

/**
 * End-to-end adapter composition. It enters governed execution exactly once and
 * never calls HTTP or Model Serving directly.
 */
export function createDefaultSlackEventProcessor(
  dependencies: DefaultSlackProcessorDependencies
): (event: SafeSlackDirectMessage) => Promise<SlackProcessResult> {
  const broker = dependencies.broker ?? DEFAULT_DATABRICKS_TOKEN_BROKER;
  const admission =
    dependencies.admission ??
    new SlackAdmissionController({
      ...dependencies.config.caps,
    });

  const resolveEventIdentity = async (event: SafeSlackDirectMessage): Promise<SlackIdentityResolution> => {
    const [installation, link] = await Promise.all([
      readSlackInstallation(dependencies.store, {
        environment: dependencies.config.environment,
        workspaceHash: event.workspaceHash,
      }),
      readSlackUserLink(dependencies.store, {
        environment: dependencies.config.environment,
        workspaceHash: event.workspaceHash,
        slackUserHash: event.userHash,
      }),
    ]);
    if (!installation || !link) return { allowed: false, safeErrorClass: 'link_missing' };
    if (
      !link.tokenRefProvider ||
      !link.tokenRefFingerprint ||
      !link.databricksSubjectFingerprint ||
      !link.databricksWorkspace ||
      !link.databricksAudience
    ) {
      return { allowed: false, safeErrorClass: 'link_incomplete' };
    }
    const decision = await resolveSlackDelegatedIdentity({
      installationSlackTeamId: event.runtime().teamId,
      registration: {
        id: installation.registrationId,
        environment: installation.environment,
        slackTeamId: event.runtime().teamId,
        allowedDatabricksWorkspaces: [dependencies.config.databricksWorkspaceHost],
      },
      link: {
        id: link.linkId,
        slackTeamId: event.runtime().teamId,
        slackUserId: event.runtime().userId,
        databricksWorkspace: link.databricksWorkspace,
        databricksAudience: link.databricksAudience,
        databricksSubjectFingerprint: link.databricksSubjectFingerprint,
        tokenReference: {
          id: link.delegatedIdentityRef,
          provider: link.tokenRefProvider,
          fingerprint: link.tokenRefFingerprint,
        },
        status: link.status,
        createdAt: link.createdAt,
        updatedAt: link.updatedAt,
        expiresAt: link.expiresAt,
        revokedAt: link.revokedAt,
      },
      expectedDatabricksWorkspace: dependencies.config.databricksWorkspaceHost,
      expectedDatabricksAudience: dependencies.expectedAudience,
      broker,
      correlationId: event.eventHash,
    });
    return decision.ok
      ? {
          allowed: true,
          ownerHash: link.ownerHash,
          delegatedIdentityRef: link.delegatedIdentityRef,
          identity: decision,
        }
      : { allowed: false, safeErrorClass: decision.reason };
  };

  const updateClaimForDelivery = async (
    event: SafeSlackDirectMessage,
    delivery: SlackDelivery,
    blockedError?: string
  ): Promise<void> => {
    const sent = delivery.status === 'sent' && delivery.deliveryState === 'final_sent';
    await updateSlackEventClaim(dependencies.store, {
      environment: dependencies.config.environment,
      workspaceHash: event.workspaceHash,
      eventHash: event.eventHash,
      status: sent ? (blockedError ? 'blocked' : 'completed') : 'failed',
      runId: delivery.runId,
      deliveryId: delivery.deliveryId,
      safeErrorClass: sent ? (blockedError ?? delivery.safeErrorClass) : (delivery.safeErrorClass ?? blockedError),
    });
  };

  return createSlackEventProcessor({
    store: dependencies.store,
    environment: dependencies.config.environment,
    admission,
    audit: dependencies.audit,
    resolveIdentity: resolveEventIdentity,
    startRun: async (event, identity) => {
      if (!identity.identity) throw new Error('Delegated identity was not bound.');
      const binding = await resolveOrCreateSlackConversationBinding(dependencies.store, {
        environment: dependencies.config.environment,
        workspaceHash: event.workspaceHash,
        channelHash: event.channelHash,
        threadHash: event.threadHash,
        ownerHash: identity.ownerHash,
        appConversationId: deterministicId(
          'slack-conversation',
          dependencies.config.environment,
          event.workspaceHash,
          event.channelHash,
          event.threadHash,
          identity.ownerHash
        ),
      });
      if (binding.outcome !== 'created' && binding.outcome !== 'updated') {
        throw new Error('Slack conversation binding ownership conflict.');
      }
      const envelope = await dependencies.governedRuns.submit(
        {
          schemaVersion: 1,
          conversationId: binding.value.appConversationId,
          prompt: event.prompt,
          idempotencyKey: `slack:${event.eventHash}`,
          externalContext: {
            source: 'slack',
            slackWorkspaceIdHash: event.workspaceHash,
            slackUserIdHash: event.userHash,
            slackChannelIdHash: event.channelHash,
            slackThreadTsHash: event.threadHash,
            slackEventIdHash: event.eventHash,
          },
        },
        identity.identity
      );
      return { runId: envelope.runId, owner: identity.identity.email };
    },
    deliverRun: async (input) => {
      const delivered = await dependencies.delivery.deliverRun(input);
      await updateClaimForDelivery(input.event, delivered);
      return delivered;
    },
    deliverBlocked: async ({ delivery, event, safeErrorClass }) =>
      dependencies.delivery.deliverLinkOut({
        delivery,
        event,
        message:
          safeErrorClass === 'link_missing'
            ? 'Link your Databricks identity before asking ADAPT from Slack.'
            : 'Your Databricks identity could not be used. Sign in to relink it.',
        actionUrl: await dependencies.linkOutUrl(event, safeErrorClass),
      }),
    resumeDelivery: async ({ delivery, event }) => {
      const identity = await resolveEventIdentity(event);
      if (!identity.allowed || !identity.identity) {
        const safeErrorClass = identity.allowed ? 'identity_unavailable' : identity.safeErrorClass;
        let actionUrl: string;
        try {
          actionUrl = await dependencies.linkOutUrl(event, safeErrorClass);
        } catch {
          const failed = await recordSlackDeliveryAttempt(dependencies.store, {
            deliveryId: delivery.deliveryId,
            runId: delivery.runId,
            revision: delivery.revision,
            status: 'failed',
            deliveryState: 'transient_failed',
            deliveryKind: 'link_out',
            safeErrorClass: 'link_out_unavailable',
          });
          const settled = failed.outcome === 'updated' ? failed.value : delivery;
          await updateClaimForDelivery(event, settled);
          await dependencies.audit({
            event: 'delivery_failed',
            workspaceHash: event.workspaceHash,
            eventHash: event.eventHash,
            runId: delivery.runId ?? undefined,
            deliveryId: delivery.deliveryId,
            safeErrorClass: 'link_out_unavailable',
          });
          return;
        }
        const blocked = await dependencies.delivery.deliverLinkOut({
          delivery,
          event,
          message: 'Your Databricks identity could not be used. Sign in to relink it.',
          actionUrl,
        });
        await updateClaimForDelivery(event, blocked, safeErrorClass);
        return;
      }
      if (!delivery.runId) return;
      const delivered = await dependencies.delivery.deliverRun({
        delivery,
        event,
        owner: identity.identity.email,
      });
      await updateClaimForDelivery(event, delivered);
    },
  });
}
