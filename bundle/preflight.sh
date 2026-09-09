#!/usr/bin/env bash
# advisory-suite: ADAPT release checks that report without gating
#
# Static checks need no workspace. --live also verifies the running app and the
# one governed-data Genie space ADAPT's orchestrator calls.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

LIVE=false
[[ "${1:-}" == "--live" ]] && LIVE=true
[[ $# -le 1 ]] || die "usage: bundle/preflight.sh [--live]"
FAILED=0
fail() { printf '  FAIL  %s\n' "$*"; FAILED=1; }
pass() { printf '  ok    %s\n' "$*"; }

step "ADAPT app declaration"
APP_RESOURCE="$BUNDLE_ROOT/resources/adapt_app.app.yml"
if [[ ! -f "$APP_RESOURCE" ]]; then
  fail "resources/adapt_app.app.yml is missing"
elif grep -q '^    adapt_app:$' "$APP_RESOURCE"; then
  pass "resources/adapt_app.app.yml declares apps.adapt_app"
else
  fail "resources/adapt_app.app.yml does not declare apps.adapt_app"
fi

step "Genie ownership"
shopt -s nullglob
MANAGED_GENIE=("$BUNDLE_ROOT"/resources/*.genie_space.yml)
shopt -u nullglob
if (( ${#MANAGED_GENIE[@]} )); then
  fail "resources/ contains a bundle-managed Genie space; ADAPT attaches to one existing space"
else
  pass "the bundle does not overwrite an existing Genie space"
fi

step "Scope contract"
if [[ ! -f "$BUNDLE_ROOT/bundle/scope-contract.py" \
   || ! -f "$BUNDLE_ROOT/bundle/scope-contract.json" ]]; then
  fail "the generated scope contract is incomplete"
elif python3 "$BUNDLE_ROOT/bundle/scope-contract.py" --check; then
  pass "declared and documented scopes agree"
else
  fail "declared and documented scopes disagree or could not be checked"
fi

if [[ "$LIVE" == true ]]; then
  require_target
  resolve_profile
  seed_bundle_cache
  APP_NAME="$(bundle_var app_name)"
  APP_JSON="$(mktemp "${TMPDIR:-/tmp}/adapt-preflight-app.XXXXXX")"
  on_exit "rm -f '$APP_JSON'"

  step "Live app bindings and scopes"
  if ! databricks apps get "$APP_NAME" --profile "$PROFILE" -o json > "$APP_JSON"; then
    fail "app '$APP_NAME' could not be read"
  else
    LIVE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/adapt-preflight.XXXXXX")"
    on_exit "rm -rf '$LIVE_DIR'"
    cp "$APP_JSON" "$LIVE_DIR/app.json"
    CATALOG="$(bundle_var app_catalog)"
    SCHEMA="$(bundle_var app_schema)"
    if ! databricks tables list "$CATALOG" "$SCHEMA" --profile "$PROFILE" -o json \
      > "$LIVE_DIR/tables.json"; then
      fail "tables in $CATALOG.$SCHEMA could not be read"
    elif python3 "$BUNDLE_ROOT/bundle/drift-check.py" \
      --target "$TARGET" --evidence "$LIVE_DIR" \
      --leg scope-counts --leg resource-observed; then
      pass "live app bindings and effective scopes match the bundle"
    else
      fail "live app bindings or effective scopes drift from the bundle"
    fi
  fi

  step "Live governed-data Genie space"
  SPACE_ID="$(bundle_var genie_data_space_id)"
  WAREHOUSE_ID="$(bundle_var warehouse_id)"
  EXECUTION_IDENTITY="$(bundle_var execution_identity)"
  ALLOWLIST="$(bundle_var_csv data_catalogs)"
  if [[ "$EXECUTION_IDENTITY" == "user-authorization" ]]; then
    PRINCIPAL="runtime users"
    PRINCIPAL_SOURCE="one signed-in reader per request"
  else
    PRINCIPAL="$(databricks current-user me --profile "$PROFILE" -o json \
      | python3 -c 'import json,sys; print(json.load(sys.stdin).get("userName") or "")')"
    PRINCIPAL_SOURCE="the release identity before endpoint creation"
  fi
  if python3 "$BUNDLE_ROOT/bundle/genie-live-check.py" \
    --profile "$PROFILE" \
    --principal "$PRINCIPAL" \
    --principal-source "$PRINCIPAL_SOURCE" \
    --execution-identity "$EXECUTION_IDENTITY" \
    --warehouse-id "$WAREHOUSE_ID" \
    --allowlist "$ALLOWLIST" \
    --space-id "$SPACE_ID"; then
    pass "the configured Genie space is readable and in scope"
  else
    fail "the configured Genie space is not release-ready"
  fi
fi

printf '\n'
if (( FAILED )); then
  echo "preflight FAILED, with advisory findings above. Exiting 0."
else
  echo "preflight OK"
fi
exit 0
