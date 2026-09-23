# Slack security pilot review package

Status: **repository preparation only — no live pilot is approved or running**.

## Required owners and approvals

- Business owner: `REQUIRED: T2 owner`
- Slack app owner: `REQUIRED: T2 Slack administrator`
- Databricks owner: `REQUIRED: target workspace administrator`
- Security/privacy reviewers: `REQUIRED: T2 Security and Privacy`
- Incident and support owner: `REQUIRED`
- ESI/security review ticket: `REQUIRED: ESI-____`
- Change/release ticket: `REQUIRED: ____`

No placeholder above may be marked complete from repository evidence.

## Fixed permission boundary

- Transport: the documented Socket Mode protocol over native/injected
  `fetch` + `globalThis.WebSocket`. ADAPT's lifecycle is the sole reconnect
  owner; package auto-reconnect does not exist in the runtime.
- Message delivery: documented `chat.postMessage` protocol over native/injected
  `fetch`.
- App-level scope: `connections:write`.
- Bot scopes: `chat:write`, `im:history`.
- Event: `message.im`.
- Direct messages only. Public/private channels, files, search, users, admin APIs,
  commands, org deploy, incoming webhooks, and HTTP event delivery are excluded.
- Development and T2 production are separate registrations. Their registration
  IDs, tokens, team IDs, and Databricks targets must never be reused across
  environments.

Databricks custom OAuth is a separate permission boundary from Slack:

- User authorization scopes: `all-apis offline_access openid profile email`.
- Grant: authorization code with PKCE S256.
- Callback parameters: `state` and `code`; OAuth does not return nonce as a
  callback query parameter.
- The broker must verify the exchanged token/ID token issuer, subject, expected
  audience, configured client ID, workspace, and the intent's expected nonce
  before ADAPT writes a link.
- Refresh credentials remain broker-only. They are never stored by ADAPT.

## Data-classification questions requiring answers

- May customer prompts and generated answer prose leave Databricks for Slack?
- Which data classifications are prohibited from Slack?
- Are DM contents retained, exported, searched, or discoverable under T2 policy?
- What retention applies to ADAPT's hashed event/delivery metadata?
- Which users may link identities, and how is termination reflected in revocation?
- Are generated SQL, links, source names, and chart summaries allowed in Slack?
- What legal hold, eDiscovery, DLP, and data residency rules apply?

The `slack-message` egress control defaults denied. Approval of this review does
not change that runtime control.

## Network and secrets

- Required outbound destinations: `REQUIRED: Slack Socket Mode/Web API allowlist`
  and the exact Databricks OAuth/token-broker endpoints.
- IP allowlist decision: `REQUIRED`; document whether stable egress IPs exist.
- Default/main and the public Git artifact contain no Slack secret resources or
  `valueFrom` entries. App, bot, client, and signing secrets become Databricks
  secret-resource bindings only after `secret-bindings.overlay.json` is applied
  to a reviewed private deployment branch.
- Rotation owner, cadence, overlap procedure, and emergency rotation: `REQUIRED`.
- Token broker must retain OAuth credentials; ADAPT stores opaque references only.
- Logs, status APIs, migration records, and release snapshots must never contain
  tokens, OAuth codes, PKCE verifiers, secret values, or secret-resource IDs.

## Compatibility tuple

Record before approval:

- ADAPT source commit: `REQUIRED`
- Migration: `v50` (`slack render delivery state`)
- Databricks target/workspace: `REQUIRED`
- Development Slack registration revision: `REQUIRED`
- T2 production Slack registration revision: `REQUIRED`
- Runtime dependency boundary: no Slack SDK package is imported, locked, or
  shipped. The approved Bolt/Socket Mode experiment was removed because its
  unused receiver and Undici WASM payloads fail mandatory secret scanning.
- Protocol implementation security review: `REQUIRED`.
- Durable verifier store implementation/version: `REQUIRED`
- Token broker and link-writer implementation/version: `REQUIRED`

Migration v50 has no automated down migration because valid pre-run link-out
deliveries have nullable run IDs. Roll back application source without deleting
v50 state; use a forward repair for schema changes.

## Go-live gates

- [ ] External owners and ESI/change tickets are approved.
- [ ] Both manifests were imported by the correct Slack administrators.
- [ ] T2 team ID and registrations were independently verified.
- [ ] Target override and all secret bindings were reviewed out of Git.
- [ ] The default/public manifests were confirmed unbound and the private
      overlay branch was reviewed with `apply-secret-overlay.mjs --check`.
- [ ] Broker, durable verifier store, and link writer passed revocation/replay tests.
- [ ] Native Socket Mode/Web API protocol implementation is security-reviewed;
      runtime source and the rebuilt deploy chunk contain no Slack packages,
      Undici, receivers, or scanner-matched blobs.
- [ ] Egress allowlist and `slack-message` policy were explicitly approved.
- [ ] Readiness reports `running`; every other state is a no-go.
- [ ] Uninstall/revoke and incident exercises passed.
- [ ] Rollback snapshot and operator are named.

Until every gate is complete, the precise decision is **NO-GO for a live pilot**.

## Current external dependency blockers

- No durable PKCE-verifier store, delegated token broker/link writer, Slack
  registrations, T2 values, secret values, external approvals, or workspace
  resources were created by this repository change.
