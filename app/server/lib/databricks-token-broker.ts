import { inspect } from 'node:util';

import {
  BrokeredCredentialMetadataSchema,
  type BlockedIdentityReason,
  type BrokeredCredentialMetadata,
  type TokenReference,
} from '../../shared/channel/delegated-identity';

export interface BrokerCredentialRequest {
  tokenReference: TokenReference;
  workspace: string;
  audience: string;
}

/**
 * Server-only credential material.
 *
 * The bearer token and verified Databricks subject are held in private fields
 * and can only be deliberately unwrapped for identity binding and the
 * downstream Databricks call. JSON and diagnostic inspection expose safe
 * metadata only.
 */
export class RuntimeBrokeredCredential {
  readonly metadata: BrokeredCredentialMetadata;
  readonly #accessToken: string;
  readonly #verifiedSubjectEmail: string;

  constructor(accessToken: string, verifiedSubjectEmail: string, metadata: BrokeredCredentialMetadata) {
    if (!accessToken.trim()) throw new Error('Broker returned empty credential material.');
    if (!verifiedSubjectEmail.trim().includes('@')) throw new Error('Broker returned no verified credential subject.');
    this.#accessToken = accessToken;
    this.#verifiedSubjectEmail = verifiedSubjectEmail.trim();
    this.metadata = BrokeredCredentialMetadataSchema.parse(metadata);
  }

  accessToken(): string {
    return this.#accessToken;
  }

  verifiedSubjectEmail(): string {
    return this.#verifiedSubjectEmail;
  }

  toJSON(): BrokeredCredentialMetadata {
    return this.metadata;
  }

  [inspect.custom](): string {
    return `RuntimeBrokeredCredential ${inspect(this.metadata)}`;
  }
}

export type BrokeredCredentialResult =
  | { ok: true; credential: RuntimeBrokeredCredential }
  | { ok: false; reason: BlockedIdentityReason; message: string };

/** Product-portable boundary for exchanging an opaque reference for a user credential. */
export interface DatabricksTokenBroker {
  broker(request: BrokerCredentialRequest): Promise<BrokeredCredentialResult>;
}

/**
 * Production default until a real broker is selected.
 *
 * There is intentionally no app-service-principal fallback here.
 */
export class UnavailableDatabricksTokenBroker implements DatabricksTokenBroker {
  broker(_request: BrokerCredentialRequest): Promise<BrokeredCredentialResult> {
    return Promise.resolve({
      ok: false,
      reason: 'broker_unavailable',
      message: 'Delegated Databricks credentials are unavailable.',
    });
  }
}

export const DEFAULT_DATABRICKS_TOKEN_BROKER: DatabricksTokenBroker = new UnavailableDatabricksTokenBroker();
