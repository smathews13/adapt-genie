/**
 * The billing tag this app writes onto resources it manages, and the predicate
 * Ops uses when it reads `system.billing.usage`.
 *
 * `system_billing=adapt` is a clear billing dimension that a person can match
 * by eye in usage rows.
 */
export const BILLING_TAG = { key: 'system_billing', value: 'adapt' } as const;

/** Executable compatibility identifier stripped when current tags are written. */
export const RETIRED_BILLING_TAG_KEY = 'astrolabe';

export function billingTagPair(): string {
  return `${BILLING_TAG.key}=${BILLING_TAG.value}`;
}

/**
 * Whether this app's own record carries {@link BILLING_TAG}.
 *
 * Separate from billed usage. Databricks Apps tags are organizational and may
 * not appear on `system.billing.usage` rows, so a missing spend figure is not
 * evidence the tag is absent.
 */
export type AppBillingTagState = 'matched' | 'missing' | 'unverified';
