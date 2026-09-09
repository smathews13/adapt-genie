/** The signed-in user's Databricks credential, selected once for every caller. */
import type { Request } from 'express';
import type { BoundIdentity } from './identity-binding';
import { forwardedUserToken } from '../routes/access-verification';

/**
 * The bearer token Databricks APIs should use for this request.
 *
 * Deployed requests always use the Apps proxy's forwarded user OAuth token.
 * Local development may have no forwarded token; callers that support local
 * app-service-principal behavior already handle the resulting null explicitly.
 */
export function executionToken(req: Request): string | null {
  return forwardedUserToken(req);
}

export function servingIdentityFields(identity: BoundIdentity): {
  expectedUser: string;
  identityMode: string;
} {
  return {
    expectedUser: identity.token ? identity.email : '',
    identityMode: identity.mode,
  };
}
