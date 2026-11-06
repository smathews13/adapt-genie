import { normalizeAdminEmail } from './admin-identity';

/**
 * ADAPT's immutable operator floor.
 *
 * Unlike deployment seed values, this remains authoritative after Lakebase has
 * a roster so the named operator cannot be locked out by a stale or incomplete
 * roster. It grants only ADAPT application administration; analytical queries
 * still run with the caller's own Databricks permissions.
 */
export const ADAPT_SUPER_ADMIN_EMAILS_ENV = 'ADAPT_SUPER_ADMIN_EMAILS';

/** The floor before deployments stated one; recorded once so later artifacts need not name anybody. */
const LEGACY_ADAPT_SUPER_ADMIN_EMAILS =
  'sam.mathews@databricks.com,emily.huang@take2games.com,rida.qureshi@take2games.com';

/** Name the legacy floor when neither the artifact nor the record does. */
export function applyLegacyAdaptSuperAdmins(env: Record<string, string | undefined> = process.env): void {
  if (!(env[ADAPT_SUPER_ADMIN_EMAILS_ENV] ?? '').trim())
    env[ADAPT_SUPER_ADMIN_EMAILS_ENV] = LEGACY_ADAPT_SUPER_ADMIN_EMAILS;
}

/** The deployment's super-admin floor, read per call so a restored value applies. */
export function adaptSuperAdminEmails(): readonly string[] {
  const configured = (process.env[ADAPT_SUPER_ADMIN_EMAILS_ENV] ?? '').trim() || LEGACY_ADAPT_SUPER_ADMIN_EMAILS;
  return [
    ...new Set(
      configured
        .split(',')
        .map((email) => normalizeAdminEmail(email))
        .filter(Boolean)
    ),
  ];
}
