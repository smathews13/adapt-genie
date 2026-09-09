#!/usr/bin/env bash
# Focused integration tests for the served-entity ceiling in agent-release.sh.
# The real release and prune scripts run against local CLI stubs; no workspace
# resources are read or changed.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/agent-release.sh"
STUBS="$(mktemp -d "${TMPDIR:-/tmp}/adapt-served-ceiling-stubs.XXXXXX")"
OUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/adapt-served-ceiling-out.XXXXXX")"
trap 'rm -rf "$STUBS" "$OUT_DIR"' EXIT

PASS=0
FAIL=0
LAST_OUT=""

ok() { PASS=$((PASS + 1)); printf '  ok    %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$1"; }
expect_status() {
  if [[ "$1" == "$2" ]]; then ok "$3 (exit $2)"; else bad "$3: expected $1, got $2"; fi
}
expect_text() {
  if rg -qF -- "$2" "$LAST_OUT"; then ok "$1"; else bad "$1: not in output"; fi
}
expect_absent() {
  if rg -qF -- "$2" "$LAST_OUT"; then bad "$1: present and should not be"; else ok "$1"; fi
}

cat >"$STUBS/databricks" <<'STUB'
#!/usr/bin/env bash
case "$1 $2" in
  "bundle validate")
    cat <<'JSON'
{
  "workspace": {"host": "https://fake-workspace.cloud.databricks.com"},
  "variables": {
    "app_catalog": {"value": "test_catalog"},
    "app_schema": {"value": "test_schema"},
    "warehouse_id": {"value": "warehouse-id"},
    "model_name": {"value": "test_catalog.test_schema.adapt_orchestrator"},
    "serving_endpoint_name": {"value": "adapt-orchestrator"},
    "serving_rollbacks_kept": {"value": "0"},
    "experiment_path": {"value": "/Shared/adapt-genie"},
    "llm_endpoint": {"value": "databricks-meta-llama-3-3-70b-instruct"},
    "llm_gateway": {"value": ""},
    "data_catalogs": {"value": ["test_catalog"]},
    "catalog_denylist": {"value": ""},
    "max_output_tokens": {"value": "4096"},
    "genie_data_space_id": {"value": "genie-space-id"},
    "manifest_source": {"value": ""},
    "app_name": {"value": "adapt-genie"},
    "allow_unattributed_figures": {"value": ""},
    "execution_identity": {"value": "user-authorization"}
  },
  "resources": {"apps": {"adapt_app": {"name": "adapt-genie"}}}
}
JSON
    ;;
  "apps get")
    echo '{"url": ""}'
    ;;
  "serving-endpoints get")
    "$REAL_PYTHON" - "$SCENARIO" "$STATE_FILE" <<'PY'
import json
import os
import sys

scenario, state_file = sys.argv[1:]
deployed = os.path.exists(state_file + ".deployed")
count = int(open(state_file).read()) if os.path.exists(state_file) else {
    "under": 2, "idle": 3, "busy": 3, "list": 3
}[scenario]

if deployed:
    versions = ["8"]
    traffic = [100]
elif scenario == "busy":
    versions = [str(i + 1) for i in range(count)]
    traffic = [34, 33, 33][:count]
else:
    versions = [str(i + 1) for i in range(count)]
    traffic = [100] + [0] * (count - 1)

entities = [
    {
        "name": f"adapt_orchestrator_{version}",
        "entity_name": "test_catalog.test_schema.adapt_orchestrator",
        "entity_version": version,
        "workload_size": "Small",
        "scale_to_zero_enabled": False,
    }
    for version in versions
]
routes = [
    {
        "served_entity_name": entity["name"],
        "served_model_name": entity["name"],
        "traffic_percentage": pct,
    }
    for entity, pct in zip(entities, traffic)
]
print(json.dumps({
    "name": "adapt-orchestrator",
    "state": {"config_update": "NOT_UPDATING", "ready": "READY"},
    "config": {"served_entities": entities, "traffic_config": {"routes": routes}},
}))
PY
    ;;
  "serving-endpoints update-config")
    echo 1 >"$STATE_FILE"
    echo '{}'
    ;;
  *)
    echo "stub databricks: unexpected: $*" >&2
    exit 1
    ;;
esac
STUB

cat >"$STUBS/uv" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$CALL_LOG"
case "$*" in
  *"deploy_agent.py"*) touch "$STATE_FILE.deployed" ;;
esac
STUB

cat >"$STUBS/python3" <<'STUB'
#!/usr/bin/env bash
case "${1:-}" in
  */model-scope-check.py) exit 0 ;;
  *) exec "$REAL_PYTHON" "$@" ;;
esac
STUB

chmod +x "$STUBS/databricks" "$STUBS/uv" "$STUBS/python3"
export REAL_PYTHON="$(command -v python3)"

run_release() {
  local name="$1" scenario="$2"
  shift 2
  LAST_OUT="$OUT_DIR/$name.out"
  local state="$OUT_DIR/$name.state" calls="$OUT_DIR/$name.calls"
  PATH="$STUBS:$PATH" \
    TARGET=testtarget PROFILE=test-profile \
    SCENARIO="$scenario" STATE_FILE="$state" CALL_LOG="$calls" \
    bash "$SCRIPT" "$@" >"$LAST_OUT" 2>&1
  return $?
}

echo "served entity listing"
run_release list list --served; status=$?
expect_status 0 "$status" "--served succeeds"
expect_text "reports the platform ceiling" "served_entities: 3 (ceiling 3)"
expect_text "lists entity versions and traffic" "version=1  traffic=100%"
expect_absent "does not enter model logging" "Logging model"
expect_absent "does not deploy" "Deploying version"

echo "below the ceiling"
run_release under under --apply --skip-log --model-version 8; status=$?
expect_status 0 "$status" "two existing entities allow deployment"
expect_text "deploys the requested version" "Deploying version 8 to adapt-orchestrator"
expect_absent "does not pre-prune below the ceiling" "pruning idle ones so version 8 can be added"
expect_text "keeps ADAPT's endpoint tag step" "Applying the ADAPT resource tag"

echo "at the ceiling with idle capacity"
run_release idle idle --apply --skip-log --model-version 8; status=$?
expect_status 0 "$status" "idle entities are pruned before deployment"
expect_text "announces the ceiling prune" "Endpoint is at 3 served entities (ceiling 3)"
expect_text "deploys after making room" "Deploying version 8 to adapt-orchestrator"

echo "at the ceiling with pruning disabled"
run_release no-prune idle --apply --skip-log --model-version 8 --no-prune; status=$?
expect_status 1 "$status" "--no-prune refuses a fourth entity"
expect_text "explains why deployment is refused" "cannot add version 8"
expect_text "points to the served-entity listing" "bundle/agent-release.sh --served"
expect_absent "does not call deployment after refusal" "Deploying version"

echo "at the ceiling with every entity serving traffic"
run_release busy busy --apply --skip-log --model-version 8; status=$?
expect_status 1 "$status" "three traffic-bearing entities still refuse deployment"
expect_text "reports that pruning could not make room" "still at the ceiling"
expect_absent "does not deploy when no slot exists" "Deploying version"

echo "scope invariants"
retired_resource_pattern='DICT''IONARY_GENIE|dict''ionary genie|SEMANTIC_''INDEX_ENDPOINT|semantic_''index_endpoint'
if rg -q "$retired_resource_pattern" "$SCRIPT"; then
  bad "release script acquired unsupported resource configuration"
else
  ok "release script excludes unsupported resource configuration"
fi
if rg -q -- '--registered-model' "$SCRIPT"; then
  bad "release tagging remained endpoint-only"
else
  ok "release tagging remained endpoint-only"
fi
if rg -qF 'Applying the ADAPT resource tag' "$SCRIPT" \
  && rg -qF -- '--serving-endpoint "$ENDPOINT"' "$SCRIPT"; then
  ok "tag step still names ADAPT and targets the endpoint"
else
  bad "tag step still names ADAPT and targets the endpoint"
fi

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
(( FAIL == 0 )) || exit 1
readonly MIN_ASSERTIONS=20
(( PASS >= MIN_ASSERTIONS )) || {
  printf 'FAIL  only %d assertions ran; at least %d are expected.\n' "$PASS" "$MIN_ASSERTIONS" >&2
  exit 1
}
