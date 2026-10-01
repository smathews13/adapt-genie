# Slack security pilot rollout and rollback

This is an operator checklist, not evidence that external resources exist.
Replace every `REQUIRED` placeholder outside Git.

## Customer-supplied runtime values

The customer supplies only the technical values below. Named business,
security, incident, or release owners and ticket numbers are not required by
the rollout checker.

- **Slack workspace/team ID** — Find it in the Slack administration workspace
  details, or call Slack's `auth.test` API after installing the bot and use the
  returned `team_id`. Example: `T012ABC34DE`.
- **Production Slack app registration ID** — Open the production app at
  `api.slack.com/apps`, choose **Basic Information**, and copy **App ID**.
  Example: `A012ABC34DE`. The development and production IDs must differ.
- **Slack secrets** — In the same Slack app, create the app-level token under
  **Basic Information → App-Level Tokens** with `connections:write`; copy the
  bot token from **OAuth & Permissions** after installation; and copy the
  client and signing secrets from **Basic Information → App Credentials**.
  Store all four directly in a Databricks secret scope—never in Git or rollout
  evidence. Example scope/key names: `adapt-slack-prod/app-token`,
  `adapt-slack-prod/bot-token`, `adapt-slack-prod/client-secret`, and
  `adapt-slack-prod/signing-secret`.
- **Databricks workspace URL** — Copy the URL from the target workspace browser
  address. Example: `https://dbc-12345678-abcd.cloud.databricks.com`.
- **Databricks App URL** — Open **Compute → Apps → ADAPT** after the app exists
  and copy its URL. Example:
  `https://adapt-1234567890123456.aws.databricksapps.com`.
- **OAuth client ID and expected audience** — Copy these from the Databricks
  OAuth application/connection created for ADAPT. Example client ID:
  `12345678-abcd-1234-abcd-1234567890ab`; example audience: the target
  workspace URL above. Register the callback as
  `<ADAPT app URL>/api/slack/oauth/callback`.
- **Token-broker endpoint/reference** — This is not available in Slack or
  Databricks by default. The implementation team supplies it after deploying
  the approved delegated-token broker. Example:
  `https://token-broker.company.example/adapt`.

## Configure

1. Start from the approved internal source commit in a **private deployment
   branch/worktree**. Never apply the secret overlay to public/main:

   ```bash
   git worktree add -b security-pilot-deploy /secure/path/adapt-slack <reviewed-commit>
   cd /secure/path/adapt-slack
   node bundle/slack/apply-secret-overlay.mjs --root "$PWD" --check
   node bundle/slack/apply-secret-overlay.mjs --root "$PWD" --approved
   git diff -- databricks.yml resources/adapt_app.app.yml app/app.yaml
   ```

   Review and commit that generic overlay only on the private deployment branch.
   It adds no values: it declares four required bundle variables, four App secret
   resources, and four `valueFrom` bindings. Default/main remains deployable
   without any Slack scope or key.

2. Review `development.manifest.json` and `t2-production.manifest.json`, plus
   their `.app-token.json` declarations. App-level tokens are created separately
   from Slack manifest import; the only approved app-token scope is
   `connections:write`. Review `databricks-oauth.contract.json` separately:
   Databricks user scopes are `all-apis offline_access openid profile email`,
   and nonce is verified from the broker's exchanged-token proof rather than a
   callback query parameter.
3. Create separate Slack registrations through approved T2 administration.
4. Put customer values and the overlay's required secret **scope/key names** only in
   `.databricks/bundle/<target>/variable-overrides.json` (gitignored).
5. Put app/bot/client/signing secret values only in the target's Databricks
   secret scope. Never place values in variables, shell history, or this folder.
6. Copy `rollout-evidence.template.json` outside the repository, replace every
   placeholder with implementation and protocol-review evidence, then run:

   ```bash
   node bundle/slack/check-rollout.mjs \
     --root "$PWD" --target <target> --evidence /secure/path/slack-rollout-evidence.json
   databricks bundle validate --strict -t <target> --profile <operator-selected-profile>
   ```

   The checker refuses missing overlay bindings, protocol security review,
   scanner-blocked package imports, broker/verifier/link implementation, target
   values, or egress approval.

7. Keep `slack_adapter_enabled=false` and `slack_adapter_kill_switch=true` until
   the approved activation window; run the checker against the final activation
   override where enabled is `true` and the kill switch is `false`.
8. Deploy code and migration v50 from the private overlay branch using the normal
   bundle/app release process. Do not use public Deploy from Git for a
   Slack-enabled deployment: the public artifact intentionally has no secret
   resources and will return the adapter to disabled/unconfigured.
9. Confirm the web app starts and `/api/admin/slack/status` reports the expected
   fail-closed state.
10. Obtain security review for the native/injected fetch + WebSocket protocol
    implementation. Runtime and the next rebuilt deploy artifact must contain no
    imports/requires of `@slack/bolt`, `@slack/socket-mode`, `@slack/web-api`,
    Undici, or receiver packages. Their currently locked versions are temporary
    review evidence only until the parent removes them. Inject the approved
    durable verifier store, token broker, and link writer.
11. Validate OAuth audience, client ID, workspace, callback/base URL, team ID,
    registration separation, uninstall, and revocation.
12. Approve the `slack-message` egress control, then remove the kill switch only
    during the approved window.

Useful local commands (no workspace required):

```bash
cd app
npm test
npm run typecheck
npx eslint server/slack server/routes/slack-* shared/egress-contract.ts
npx prettier --check server/slack server/routes/slack-* shared/egress-contract.ts ../bundle/slack
cd ..
bash bundle/app-spec.test.sh
```

Workspace commands are placeholders and require an operator-selected profile:

```bash
databricks bundle validate --strict -t <target> --profile <profile>
databricks apps get <app-name> --profile <profile>
```

## Observe

- Safe states: `disabled`, `kill-switch`, `transport-unavailable`,
  `broker-unavailable`, `config-invalid`, `store-unavailable`, `running`.
- Only `running` permits pilot traffic.
- Status surfaces expose booleans/reasons, never IDs or secret references.
- Kill switch blocks new events and runs while status remains readable.
- Treat forged team/workspace, callback replay, cross-environment registration,
  public-channel events, egress refusal, and revoked/uninstalled state as blocked.

## Roll back

1. Set the operational kill switch first. Confirm status remains readable and no
   new run is admitted.
2. Revoke/uninstall both Slack registrations when the rollback procedure calls
   for external revocation.
3. Revoke brokered user links and token references; do not copy token values into
   ADAPT during cleanup.
4. Re-point the app to the named known-good source snapshot:

   ```bash
   TARGET=<target> PROFILE=<profile> \
     bash bundle/app-release.sh --apply --rollback-to <absolute-workspace-snapshot>
   ```

5. Do not roll migration v50 down. Its rollback is intentionally unsupported;
   leaving the additive tables/columns in place is compatible with the previous
   app source. Use a reviewed forward migration for schema repair.
6. Rotate affected Slack and broker secrets, capture safe audit metadata, and
   open the required incident/support records.

Rollback success means the web app is healthy, Slack is disabled or kill-switched,
and no new Slack event can start a run. It does not mean external revocation is
complete until Slack and broker state have both been verified.
