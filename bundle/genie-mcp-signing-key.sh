#!/usr/bin/env bash
# Idempotently provision ADAPT's Ed25519 app-signing key and print only its
# public key. Private material exists only in chmod-600 temporary files and the
# Databricks secret; it is never written to stdout or inherited by child env.

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

MODE="${1:---read}"
[[ "$MODE" == "--ensure" || "$MODE" == "--read" ]] || die "usage: $0 [--ensure|--read]"
require_cmd databricks
require_cmd node
require_target
resolve_profile
seed_bundle_cache
acquire_run_lock "genie-mcp-signing-key-${TARGET}-${PROFILE}"

SCOPE="$(bundle_var genie_mcp_secret_scope)"
KEY="$(bundle_var genie_mcp_secret_key)"
HELPER="$BUNDLE_ROOT/bundle/genie-mcp-key.mjs"
[[ -f "$HELPER" ]] || die "bundle/genie-mcp-key.mjs is missing"

SECRET_JSON="$(mktemp "${TMPDIR:-/tmp}/adapt-genie-mcp-secret.XXXXXX")"
PRIVATE_JSON="$(mktemp "${TMPDIR:-/tmp}/adapt-genie-mcp-private.XXXXXX")"
PUBLIC_FILE="$(mktemp "${TMPDIR:-/tmp}/adapt-genie-mcp-public.XXXXXX")"
ERROR_FILE="$(mktemp "${TMPDIR:-/tmp}/adapt-genie-mcp-error.XXXXXX")"
chmod 600 "$SECRET_JSON" "$PRIVATE_JSON" "$PUBLIC_FILE" "$ERROR_FILE"
cleanup_genie_mcp_key_files() {
  rm -f "$SECRET_JSON" "$PRIVATE_JSON" "$PUBLIC_FILE" "$ERROR_FILE"
}
on_exit cleanup_genie_mcp_key_files

if databricks secrets get-secret "$SCOPE" "$KEY" --profile "$PROFILE" -o json \
  >"$SECRET_JSON" 2>"$ERROR_FILE"; then
  node "$HELPER" derive --secret-json "$SECRET_JSON" --public-file "$PUBLIC_FILE"
  tr -d '\r\n' <"$PUBLIC_FILE"
  exit 0
fi

if ! grep -qiE 'RESOURCE_DOES_NOT_EXIST|does not exist|not found' "$ERROR_FILE"; then
  cat "$ERROR_FILE" >&2
  die "Could not read ADAPT Genie MCP signing secret $SCOPE/$KEY. Refusing to replace it."
fi
[[ "$MODE" == "--ensure" ]] || die "ADAPT Genie MCP signing secret $SCOPE/$KEY does not exist"

if ! databricks secrets list-scopes --profile "$PROFILE" -o json \
  | SCOPE="$SCOPE" python3 -c '
import json, os, sys
body = json.load(sys.stdin)
scopes = body.get("scopes") if isinstance(body, dict) else body
raise SystemExit(0 if any((row.get("name") or row.get("scope")) == os.environ["SCOPE"] for row in (scopes or [])) else 1)
'; then
  databricks secrets create-scope "$SCOPE" --profile "$PROFILE"
fi

node "$HELPER" generate --private-json "$PRIVATE_JSON" --public-file "$PUBLIC_FILE"
if ! databricks secrets put-secret "$SCOPE" "$KEY" --json "@$PRIVATE_JSON" \
  --profile "$PROFILE" > /dev/null; then
  die "Failed to create ADAPT Genie MCP signing secret $SCOPE/$KEY"
fi
note "created ADAPT Genie MCP signing secret $SCOPE/$KEY (existing keys are never overwritten)" >&2
tr -d '\r\n' <"$PUBLIC_FILE"
