#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$ROOT/app/app.yaml"
PUBLIC_APP="$ROOT/app/build/deploy/app.yaml"
RESOURCE="$ROOT/resources/adapt_app.app.yml"
OVERLAY="$ROOT/bundle/slack/secret-bindings.overlay.json"
REVIEW="$ROOT/bundle/slack/SECURITY-REVIEW.md"
ROLLBACK="$ROOT/bundle/slack/ROLLOUT.md"

for manifest in development.manifest.json t2-production.manifest.json; do
  app_token="${manifest/.manifest.json/.app-token.json}"
  node - "$ROOT/bundle/slack/$manifest" "$ROOT/bundle/slack/$app_token" <<'NODE'
const fs = require('node:fs');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const appToken = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const exact = (actual, expected, name) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${name} broadened`);
};
exact(appToken.scopes, ['connections:write'], 'app scopes');
if (appToken.token_type !== 'app-level' || !appToken.value.startsWith('REQUIRED:')) {
  throw new Error('app token declaration contains a value or wrong type');
}
exact(manifest.oauth_config.scopes.bot, ['chat:write', 'im:history'], 'bot scopes');
exact(manifest.settings.event_subscriptions.bot_events, ['message.im'], 'events');
if (!manifest.settings.socket_mode_enabled || manifest.settings.org_deploy_enabled) {
  throw new Error('Socket Mode/org deploy contract changed');
}
if (/(?:channels|files|admin|search|users|groups|mpim):|https?:|xox[baprs]-|xapp-/i.test(JSON.stringify(manifest))) {
  throw new Error('manifest contains forbidden scope or live value');
}
NODE
done

node - "$ROOT/bundle/slack/databricks-oauth.contract.json" <<'NODE'
const fs = require('node:fs');
const contract = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (JSON.stringify(contract.authorization_scopes) !== JSON.stringify([
  'all-apis', 'offline_access', 'openid', 'profile', 'email'
])) throw new Error('Databricks OAuth scopes drifted');
if (JSON.stringify(contract.callback_parameters) !== JSON.stringify(['state', 'code'])) {
  throw new Error('OAuth callback contract must be state+code only');
}
if (contract.nonce_verification !== 'required-in-broker-exchanged-token-proof') {
  throw new Error('nonce proof contract drifted');
}
NODE

grep -A1 'name: SLACK_ADAPTER_ENABLED' "$APP" | grep -q "value: 'false'"
grep -A1 'name: SLACK_ADAPTER_KILL_SWITCH' "$APP" | grep -q "value: 'true'"
grep -A1 'name: SLACK_ADAPTER_OAUTH_SCOPES' "$APP" \
  | grep -q "value: 'all-apis offline_access openid profile email'"
for resource in slack-app-token slack-bot-token slack-client-secret slack-signing-secret; do
  if grep -q -- "- name: $resource" "$RESOURCE" \
     || grep -q "valueFrom: $resource" "$APP" \
     || grep -q "valueFrom: $resource" "$PUBLIC_APP"; then
    echo "default/public app unexpectedly binds $resource" >&2
    exit 1
  fi
  grep -q "\"name\": \"$resource\"" "$OVERLAY"
done
if grep -Eq '^  slack_(secret_scope|(app|bot)_token_secret_key|(client|signing)_secret_key):' "$ROOT/databricks.yml"; then
  echo "default databricks.yml unexpectedly declares Slack secret variables" >&2
  exit 1
fi

node "$ROOT/bundle/slack/apply-secret-overlay.mjs" --root "$ROOT" --check
node --test "$ROOT/bundle/slack/check-rollout.test.mjs"

ROLLOUT_OUT="$(mktemp "${TMPDIR:-/tmp}/adapt-slack-rollout.XXXXXX")"
if node "$ROOT/bundle/slack/check-rollout.mjs" \
  --root "$ROOT" \
  --target customer \
  --evidence "$ROOT/bundle/slack/rollout-evidence.template.json" \
  >"$ROLLOUT_OUT" 2>&1; then
  echo "rollout checker accepted an unbound/unapproved default deployment" >&2
  rm -f "$ROLLOUT_OUT"
  exit 1
fi
for refusal in \
  "overlay binding missing" \
  "production token broker is not injected" \
  "durable verifier store and link writer are not injected" \
  "Slack message egress approval is required" \
  "review evidence missing: esiTicket" \
  "target override is missing: .databricks/bundle/customer/variable-overrides.json"; do
  grep -qF "$refusal" "$ROLLOUT_OUT"
done
rm -f "$ROLLOUT_OUT"

if grep -Eq 'xox[baprs]-|xapp-|dapi[A-Za-z0-9]{8,}' "$APP" "$RESOURCE"; then
  echo "Slack app artifact contains a token or customer identifier" >&2
  exit 1
fi

grep -q 'Migration: `v50`' "$REVIEW"
grep -q 'no automated down migration' "$REVIEW"
grep -q 'Do not roll migration v50 down' "$ROLLBACK"
grep -q 'NO-GO for a live pilot' "$REVIEW"

printf 'security-pilot.test.sh: ok\n'
