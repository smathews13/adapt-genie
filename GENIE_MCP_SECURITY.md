# Genie MCP authorization boundary

Genie MCP is enabled only when the persisted `genieCodeMcp` setting, the
authoritative app role, and a short-lived Ed25519 capability all agree. Missing
or invalid signing configuration selects direct Genie.

## Why the setting and role are insufficient

The app invokes Model Serving with the asker's token for on-behalf-of access.
Any principal with `CAN_QUERY` can also call that endpoint directly. All request
content, including `custom_inputs`, is therefore caller-controlled at the
endpoint boundary. A transport name, role, admin boolean, email, or copy of the
saved setting cannot grant MCP access.

## Capability design

1. The app server receives an Ed25519 private key through the
   `genie-mcp-signing-key` App secret resource. Model logging receives and bakes
   only the corresponding DER public key.
2. After reading the durable toggle and authoritative app role, the app may mint
   a capability valid for at most 60 seconds. It must be sent server-to-server
   and never returned to the browser.
3. Sign claims that bind the grant to:
   - exact serving endpoint/model audience;
   - `genie:mcp` capability;
   - normalized user identity;
   - issued-at and expiry times;
   - key ID and exact request ID.
4. Model Serving must verify the signature, audience, capability, expiry,
   request ID, and key ID before exposing `genie_mcp`.
5. Model Serving must independently obtain the OBO caller identity from its
   `ModelServingUserCredentials` WorkspaceClient and require it to equal the
   signed subject. A custom-input identity is never evidence.
6. Invalid, absent, expired, replayed, or unverifiable capabilities select
   direct Genie and record only a redacted refusal reason in the trace.
7. Rotate through a coordinated app/model release. A mismatched key fails
   closed to direct Genie, and the previous version remains available for
   rollback.

The server and model canonicalize the versioned claims as sorted compact JSON.
The model derives the key ID from the public key and verifies the OBO identity
through `ModelServingUserCredentials`; no custom-input role or email grants
access.

The model removes the capability from `request.custom_inputs` immediately
after parsing the request, before runtime settings, identity checks, preflight,
planning, or trace updates. It holds the envelope only in a request-local
`ContextVar` until the independently observed OBO identity is available, then
clears it after verification and again in the turn's `finally` block. If the
request object cannot be sanitized, the turn stops before those paths run.

## Provisioning and rotation

`bundle/genie-mcp-signing-key.sh --ensure` creates
`adapt-genie-signing/genie-mcp-ed25519-private-v1` only when absent. Both
release scripts call it on applied releases. Existing values are read to derive
the public key and are never overwritten. Dry runs create nothing.

To rotate, declare a new versioned secret key name, provision it, log and deploy
a model carrying its public key, then release the app binding the matching
private key. During the transition, either side missing its matching half falls
back to direct Genie. Keep the old secret while an old app rollback is possible;
remove it only after the rollback window. Rolling the model back while the app
uses a newer key safely disables MCP rather than accepting an unverifiable
capability.
