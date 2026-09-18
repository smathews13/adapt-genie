#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/adapt-endpoint-access-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin"
cat > "$TMP/bin/databricks" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%q ' "$@" >> "$CALL_LOG"
printf '\n' >> "$CALL_LOG"

if [[ "$1 $2" == "serving-endpoints get" ]]; then
  printf '{"id":"endpoint-id"}\n'
elif [[ "$1 $2" == "permissions update" ]]; then
  printf '{}\n'
elif [[ "$1 $2" == "permissions get" ]]; then
  if [[ "${OMIT_USER_GROUP:-}" == "1" ]]; then
    printf '{"access_control_list":[{"group_name":"S_TK2_Databricks_Adapt_Genie_Admins","all_permissions":[{"permission_level":"CAN_QUERY","inherited":false}]}]}\n'
  else
    printf '{"access_control_list":[{"group_name":"S_TK2_Databricks_Adapt_Genie_Admins","all_permissions":[{"permission_level":"CAN_QUERY","inherited":false}]},{"group_name":"S_TK2_Databricks_Adapt_Genie_Users","all_permissions":[{"permission_level":"CAN_QUERY","inherited":false}]}]}\n'
  fi
else
  printf 'unexpected databricks call: %s\n' "$*" >&2
  exit 2
fi
MOCK
chmod +x "$TMP/bin/databricks"

cat > "$TMP/bundle.json" <<'JSON'
{
  "variables": {
    "serving_endpoint_name": {"value": "adapt-orchestrator"},
    "app_admin_group": {"value": "S_TK2_Databricks_Adapt_Genie_Admins"},
    "app_user_group": {"value": "S_TK2_Databricks_Adapt_Genie_Users"}
  }
}
JSON
printf 'customer\ttest-profile' > "$TMP/bundle.json.key"

export PATH="$TMP/bin:$PATH"
export CALL_LOG="$TMP/calls.log"
export TARGET=customer
export PROFILE=test-profile
export ADAPT_BUNDLE_JSON_CACHE="$TMP/bundle.json"

bash "$ROOT/bundle/endpoint-user-access.sh" --apply > "$TMP/output"

rg -q "permissions update serving-endpoints endpoint-id" "$CALL_LOG"
rg -q "S_TK2_Databricks_Adapt_Genie_Admins" "$CALL_LOG"
rg -q "S_TK2_Databricks_Adapt_Genie_Users" "$CALL_LOG"
rg -q "verified CAN_QUERY" "$TMP/output"

if OMIT_USER_GROUP=1 bash "$ROOT/bundle/endpoint-user-access.sh" --apply \
  > "$TMP/failure-output" 2>&1; then
  printf 'expected missing user-group verification to fail\n' >&2
  exit 1
fi
rg -q "verification failed for: S_TK2_Databricks_Adapt_Genie_Users" "$TMP/failure-output"

rg -q 'endpoint-user-access.sh" --apply' "$ROOT/bundle/agent-release.sh"

printf 'endpoint-user-access.test.sh: ok\n'
