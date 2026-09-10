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
SCOPES_JSON="$(mktemp "${TMPDIR:-/tmp}/adapt-genie-mcp-scopes.XXXXXX")"
SECRETS_JSON="$(mktemp "${TMPDIR:-/tmp}/adapt-genie-mcp-keys.XXXXXX")"
chmod 600 "$SECRET_JSON" "$PRIVATE_JSON" "$PUBLIC_FILE" "$ERROR_FILE" "$SCOPES_JSON" "$SECRETS_JSON"
cleanup_genie_mcp_key_files() {
  rm -f "$SECRET_JSON" "$PRIVATE_JSON" "$PUBLIC_FILE" "$ERROR_FILE" "$SCOPES_JSON" "$SECRETS_JSON"
}
on_exit cleanup_genie_mcp_key_files

if ! databricks secrets list-scopes --profile "$PROFILE" -o json >"$SCOPES_JSON" 2>"$ERROR_FILE"; then
  cat "$ERROR_FILE" >&2
  die "Could not list secret scopes. Refusing to infer whether $SCOPE exists."
fi

scope_exists() {
  SCOPE="$SCOPE" python3 -c '
import json, os, sys
body = json.load(sys.stdin)
scopes = body.get("scopes") if isinstance(body, dict) else body
raise SystemExit(0 if any((row.get("name") or row.get("scope")) == os.environ["SCOPE"] for row in (scopes or [])) else 1)
' <"$SCOPES_JSON"
}

key_exists() {
  KEY="$KEY" python3 -c '
import json, os, sys
body = json.load(sys.stdin)
secrets = body.get("secrets") if isinstance(body, dict) else body
raise SystemExit(0 if any(row.get("key") == os.environ["KEY"] for row in (secrets or [])) else 1)
' <"$SECRETS_JSON"
}

if scope_exists; then
  if ! databricks secrets list-secrets "$SCOPE" --profile "$PROFILE" -o json >"$SECRETS_JSON" 2>"$ERROR_FILE"; then
    cat "$ERROR_FILE" >&2
    die "Could not list keys in ADAPT Genie MCP signing scope $SCOPE."
  fi
  if key_exists; then
    if ! databricks secrets get-secret "$SCOPE" "$KEY" --profile "$PROFILE" -o json \
      >"$SECRET_JSON" 2>"$ERROR_FILE"; then
      cat "$ERROR_FILE" >&2
      die "Could not read existing ADAPT Genie MCP signing secret $SCOPE/$KEY. Refusing to replace it."
    fi
    node "$HELPER" derive --secret-json "$SECRET_JSON" --public-file "$PUBLIC_FILE"
    tr -d '\r\n' <"$PUBLIC_FILE"
    exit 0
  fi
  [[ "$MODE" == "--ensure" ]] || die "ADAPT Genie MCP signing secret $SCOPE/$KEY does not exist"
else
  [[ "$MODE" == "--ensure" ]] || die "ADAPT Genie MCP signing secret scope $SCOPE does not exist"
  databricks secrets create-scope "$SCOPE" --profile "$PROFILE"
fi

node "$HELPER" generate \
  --private-json "$PRIVATE_JSON" \
  --public-file "$PUBLIC_FILE" \
  --scope "$SCOPE" \
  --key "$KEY"
if ! databricks secrets put-secret --json "@$PRIVATE_JSON" --profile "$PROFILE" > /dev/null; then
  die "Failed to create ADAPT Genie MCP signing secret $SCOPE/$KEY"
fi
note "created ADAPT Genie MCP signing secret $SCOPE/$KEY (existing keys are never overwritten)" >&2
tr -d '\r\n' <"$PUBLIC_FILE"
