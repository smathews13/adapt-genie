import { randomUUID } from 'node:crypto';

import {
  SlackEnvironmentRegistrationSchema,
  SlackUserLinkMetadataSchema,
  type BlockedIdentityReason,
  type SlackEnvironmentRegistration,
  type SlackUserLinkMetadata,
} from '../../shared/channel/delegated-identity';
import { SIGNED_IN_USER, type BoundIdentity } from './identity-binding';
import type { DatabricksTokenBroker } from './databricks-token-broker';

export interface ResolveSlackDelegatedIdentityInput {
  installationSlackTeamId: string;
  link: SlackUserLinkMetadata;
  registration: SlackEnvironmentRegistration;
  expectedDatabricksWorkspace: string;
  expectedDatabricksAudience: string;
  broker: DatabricksTokenBroker;
  requestId?: string;
  correlationId?: string;
  now?: Date;
}

export interface SlackIdentityBlocked {
  ok: false;
  reason: BlockedIdentityReason;
  message: string;
}

export type SlackIdentityDecision = BoundIdentity | SlackIdentityBlocked;

function blocked(reason: BlockedIdentityReason, message: string): SlackIdentityBlocked {
  return { ok: false, reason, message };
}

function canonicalWorkspace(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host}`;
}

function expiredAt(value: string | null, now: Date): boolean {
  return value !== null && Date.parse(value) <= now.getTime();
}

/**
 * Prove that a Slack actor has an active delegated Databricks credential.
 *
 * Every failure is terminal. This function has no branch that constructs an app
 * service-principal identity.
 */
export async function resolveSlackDelegatedIdentity(
  input: ResolveSlackDelegatedIdentityInput
): Promise<SlackIdentityDecision> {
  const registration = SlackEnvironmentRegistrationSchema.parse(input.registration);
  const link = SlackUserLinkMetadataSchema.parse(input.link);
  const now = input.now ?? new Date();
  const targetWorkspace = canonicalWorkspace(input.expectedDatabricksWorkspace);

  if (registration.slackTeamId !== input.installationSlackTeamId) {
    return blocked('registration_not_allowed', 'This Slack installation is not registered for this environment.');
  }
  if (link.slackTeamId !== input.installationSlackTeamId) {
    return blocked('slack_workspace_mismatch', 'The user link belongs to a different Slack workspace.');
  }
  if (link.revokedAt !== null) {
    return blocked('link_revoked', 'The delegated identity link has been revoked.');
  }
  if (link.status !== 'active') {
    return blocked('link_inactive', 'The delegated identity link is not active.');
  }
  if (expiredAt(link.expiresAt, now)) {
    return blocked('link_expired', 'The delegated identity link has expired.');
  }

  const allowedWorkspaces = registration.allowedDatabricksWorkspaces.map(canonicalWorkspace);
  if (!allowedWorkspaces.includes(targetWorkspace)) {
    return blocked(
      'target_workspace_not_allowed',
      'The target Databricks workspace is not allowed for this registration.'
    );
  }
  if (canonicalWorkspace(link.databricksWorkspace) !== targetWorkspace) {
    return blocked('target_workspace_mismatch', 'The user link belongs to a different Databricks workspace.');
  }
  if (link.databricksAudience !== input.expectedDatabricksAudience) {
    return blocked('audience_mismatch', 'The user link was issued for a different Databricks audience.');
  }

  let result;
  try {
    result = await input.broker.broker({
      tokenReference: link.tokenReference,
      workspace: targetWorkspace,
      audience: input.expectedDatabricksAudience,
    });
  } catch {
    return blocked('broker_unavailable', 'Delegated Databricks credentials are unavailable.');
  }
  if (!result.ok) {
    return blocked(
      result.reason,
      result.reason === 'broker_unavailable'
        ? 'Delegated Databricks credentials are unavailable.'
        : 'The delegated Databricks credential could not be used.'
    );
  }

  const { credential } = result;
  const { metadata } = credential;
  if (
    metadata.tokenReference.id !== link.tokenReference.id ||
    metadata.tokenReference.provider !== link.tokenReference.provider ||
    metadata.tokenReference.fingerprint !== link.tokenReference.fingerprint
  ) {
    return blocked('token_reference_mismatch', 'The broker returned a different credential reference.');
  }
  if (metadata.tokenStatus.state === 'revoked' || metadata.tokenStatus.revokedAt !== null) {
    return blocked('token_revoked', 'The delegated Databricks credential has been revoked.');
  }
  if (metadata.tokenStatus.state === 'expired' || expiredAt(metadata.tokenStatus.expiresAt, now)) {
    return blocked('token_expired', 'The delegated Databricks credential has expired.');
  }
  if (metadata.tokenStatus.state !== 'active') {
    return blocked('token_missing', 'No active delegated Databricks credential is available.');
  }
  if (canonicalWorkspace(metadata.workspace) !== targetWorkspace) {
    return blocked('target_workspace_mismatch', 'The brokered credential targets a different Databricks workspace.');
  }
  if (metadata.audience !== input.expectedDatabricksAudience) {
    return blocked('audience_mismatch', 'The brokered credential has a different Databricks audience.');
  }
  if (metadata.subjectFingerprint !== link.databricksSubjectFingerprint) {
    return blocked('subject_mismatch', 'The brokered credential subject does not match the linked Databricks user.');
  }
  if (!metadata.issuerBackedSubjectVerified) {
    return blocked(
      'subject_unverified',
      metadata.subjectKind === 'opaque'
        ? 'The opaque credential subject was not verified by its issuer.'
        : 'The credential subject was not verified by its issuer.'
    );
  }

  const requestId = input.requestId ?? `req-${randomUUID()}`;
  return {
    ok: true,
    email: credential.verifiedSubjectEmail(),
    token: credential.accessToken(),
    verified: true,
    mode: SIGNED_IN_USER,
    requestId,
    correlationId: input.correlationId ?? requestId,
  };
}
