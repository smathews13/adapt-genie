import { z } from 'zod';

const SafeId = z.string().trim().min(1).max(256);
const SafeUrl = z.string().url().max(2048);
const IsoTimestamp = z.string().datetime({ offset: true });

/**
 * Reasons a channel request can be stopped before governed work begins.
 *
 * These values are safe to persist and return to a caller. They deliberately
 * describe the failed proof, not any credential or OAuth response.
 */
export const BLOCKED_IDENTITY_REASONS = [
  'registration_not_allowed',
  'slack_workspace_mismatch',
  'link_inactive',
  'link_expired',
  'link_revoked',
  'target_workspace_not_allowed',
  'target_workspace_mismatch',
  'audience_mismatch',
  'broker_unavailable',
  'token_missing',
  'token_expired',
  'token_revoked',
  'token_reference_mismatch',
  'subject_mismatch',
  'subject_unverified',
] as const;

export const BlockedIdentityReasonSchema = z.enum(BLOCKED_IDENTITY_REASONS);
export type BlockedIdentityReason = z.infer<typeof BlockedIdentityReasonSchema>;

/** An opaque handle to credential material held by a broker or secret store. */
export const TokenReferenceSchema = z.strictObject({
  id: SafeId,
  provider: SafeId,
  fingerprint: SafeId,
});
export type TokenReference = z.infer<typeof TokenReferenceSchema>;

export const TokenStatusSchema = z.strictObject({
  state: z.enum(['active', 'expired', 'revoked', 'unavailable']),
  expiresAt: IsoTimestamp.nullable(),
  revokedAt: IsoTimestamp.nullable(),
  checkedAt: IsoTimestamp,
});
export type TokenStatus = z.infer<typeof TokenStatusSchema>;

/**
 * Persistable Slack-to-Databricks link metadata.
 *
 * This is intentionally a strict object. OAuth codes, verifier values, bearer
 * tokens, and Slack app/bot tokens therefore fail parsing instead of being
 * silently stripped into a value that might later be persisted.
 */
export const SlackUserLinkMetadataSchema = z.strictObject({
  id: SafeId,
  slackTeamId: SafeId,
  slackUserId: SafeId,
  databricksWorkspace: SafeUrl,
  databricksAudience: SafeId,
  databricksSubjectFingerprint: SafeId,
  tokenReference: TokenReferenceSchema,
  status: z.enum(['active', 'revoked']),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
  expiresAt: IsoTimestamp.nullable(),
  revokedAt: IsoTimestamp.nullable(),
});
export type SlackUserLinkMetadata = z.infer<typeof SlackUserLinkMetadataSchema>;

/** Safe metadata returned alongside an in-memory brokered credential. */
export const BrokeredCredentialMetadataSchema = z.strictObject({
  tokenReference: TokenReferenceSchema,
  tokenStatus: TokenStatusSchema,
  workspace: SafeUrl,
  audience: SafeId,
  subjectFingerprint: SafeId,
  subjectKind: z.enum(['email', 'stable_id', 'opaque']),
  issuerBackedSubjectVerified: z.boolean(),
});
export type BrokeredCredentialMetadata = z.infer<typeof BrokeredCredentialMetadataSchema>;

/** One separately registered Slack environment and its exact Databricks targets. */
export const SlackEnvironmentRegistrationSchema = z.strictObject({
  id: SafeId,
  environment: z.enum(['test', 'production']),
  slackTeamId: SafeId,
  allowedDatabricksWorkspaces: z.array(SafeUrl).min(1).max(32),
});
export type SlackEnvironmentRegistration = z.infer<typeof SlackEnvironmentRegistrationSchema>;

/**
 * Persistable half of an OAuth link attempt. The verifier is represented only
 * by an opaque secret-store reference.
 */
export const SlackLinkIntentMetadataSchema = z.strictObject({
  id: SafeId,
  state: SafeId,
  nonce: SafeId,
  slackTeamId: SafeId,
  slackUserId: SafeId,
  databricksWorkspace: SafeUrl,
  databricksAudience: SafeId,
  redirectUri: SafeUrl,
  verifierReference: TokenReferenceSchema,
  createdAt: IsoTimestamp,
  expiresAt: IsoTimestamp,
});
export type SlackLinkIntentMetadata = z.infer<typeof SlackLinkIntentMetadataSchema>;
