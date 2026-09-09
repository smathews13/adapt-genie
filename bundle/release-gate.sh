#!/usr/bin/env bash
# Fail-closed checks whose failure would break an ADAPT customer release.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

[[ $# -eq 0 ]] || die "release-gate.sh takes no arguments"
require_cmd databricks
require_target
resolve_profile
seed_bundle_cache

DRIFT="$BUNDLE_ROOT/bundle/drift-check.py"
CONTRACT="$BUNDLE_ROOT/bundle/scope-contract.py"
CONTRACT_JSON="$BUNDLE_ROOT/bundle/scope-contract.json"
for required in "$DRIFT" "$CONTRACT" "$CONTRACT_JSON"; do
  [[ -f "$required" ]] || die "$(basename "$required") is missing. A missing release check is not a pass."
done

APP_NAME="$(bundle_var app_name)"
CATALOG="$(bundle_var app_catalog)"
SCHEMA="$(bundle_var app_schema)"
EVIDENCE="$(mktemp -d "${TMPDIR:-/tmp}/adapt-release-gate.XXXXXX")"
on_exit "rm -rf '$EVIDENCE'"

step "ADAPT release gate (target: $TARGET)"
python3 "$CONTRACT" --check

databricks apps get "$APP_NAME" --profile "$PROFILE" -o json > "$EVIDENCE/app.json" \
  || die "app '$APP_NAME' could not be read; live scopes and bindings were not established"
databricks tables list "$CATALOG" "$SCHEMA" --profile "$PROFILE" -o json \
  > "$EVIDENCE/tables.json" \
  || die "$CATALOG.$SCHEMA could not be read; governed-schema drift was not established"

python3 "$DRIFT" --target "$TARGET" --evidence "$EVIDENCE" \
  --leg scope-counts --leg resource-observed
printf '\n  ok. Customer-visible release checks passed before upload.\n'
