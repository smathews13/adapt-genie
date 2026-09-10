#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/adapt-genie-mcp-key-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/state"

cat >"$TMP/bin/databricks" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
case "$1 $2" in
  "secrets get-secret")
    if [[ ! -f "$STATE/secret" ]]; then
      echo "RESOURCE_DOES_NOT_EXIST" >&2
      exit 1
    fi
    VALUE="$(base64 <"$STATE/secret" | tr -d '\r\n')"
    printf '{"value":"%s"}\n' "$VALUE"
    ;;
  "secrets list-scopes")
    if [[ -f "$STATE/scope" ]]; then printf '{"scopes":[{"name":"adapt-genie-signing"}]}\n'
    else printf '{"scopes":[]}\n'; fi
    ;;
  "secrets create-scope")
    touch "$STATE/scope"
    printf 'create-scope\n' >>"$STATE/calls"
    ;;
  "secrets put-secret")
    JSON_ARG=""
    for arg in "$@"; do [[ "$arg" == @* ]] && JSON_ARG="${arg#@}"; done
    python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["string_value"])' "$JSON_ARG" >"$STATE/secret"
    printf 'put-secret\n' >>"$STATE/calls"
    ;;
  *) echo "unexpected databricks call: $*" >&2; exit 2 ;;
esac
FAKE
chmod +x "$TMP/bin/databricks"

cat >"$TMP/bundle.json" <<'JSON'
{
  "variables": {
    "genie_mcp_secret_scope": {"value": "adapt-genie-signing"},
    "genie_mcp_secret_key": {"value": "genie-mcp-ed25519-private-v1"}
  }
}
JSON
printf 'customer\ttest-profile' >"$TMP/bundle.json.key"

export STATE="$TMP/state"
export PATH="$TMP/bin:$PATH"
export TARGET=customer
export PROFILE=test-profile
export ADAPT_BUNDLE_JSON_CACHE="$TMP/bundle.json"

FIRST="$(bash "$ROOT/bundle/genie-mcp-signing-key.sh" --ensure)"
SECOND="$(bash "$ROOT/bundle/genie-mcp-signing-key.sh" --ensure)"

[[ -n "$FIRST" && "$FIRST" == "$SECOND" ]]
[[ "$FIRST" != "$(cat "$STATE/secret")" ]]
[[ "$(grep -c '^put-secret$' "$STATE/calls")" == "1" ]]
[[ "$(grep -c '^create-scope$' "$STATE/calls")" == "1" ]]
! grep -qF "$(cat "$STATE/secret")" "$STATE/calls"
printf 'ok - Genie MCP signing key is idempotent and non-overwriting\n'
