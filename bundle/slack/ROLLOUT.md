# Slack security pilot rollout and rollback

This is an operator checklist, not evidence that external resources exist.
Replace every `REQUIRED` placeholder outside Git.

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
   placeholder with approved ticket/owner/implementation evidence, then run:

   ```bash
   node bundle/slack/check-rollout.mjs \
     --root "$PWD" --target <target> --evidence /secure/path/slack-rollout-evidence.json
   databricks bundle validate --strict -t <target> --profile <operator-selected-profile>
   ```

   The checker refuses missing overlay bindings, protocol security review,
   scanner-blocked package imports, broker/verifier/link implementation, target
   values, egress approval, owners, or tickets.

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
2. Revoke/uninstall both Slack registrations as required by the incident owner.
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
complete until the named owners verify it.
