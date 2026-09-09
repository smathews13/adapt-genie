#!/usr/bin/env bash
# Focused proof that ADAPT's configured, documented and logged model scopes agree.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$HERE/model-scope-check.py"
CONTRACT="$HERE/scope-contract.json"
TARGET="${MODEL_SCOPE_TEST_TARGET:-customer}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/adapt-model-scope.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
PASS=0
FAIL=0

check_says() {
  local label="$1" expected="$2" needle="$3"; shift 3
  local out status
  out="$("$@" 2>&1)"; status=$?
  if [[ "$status" != "$expected" ]] || ! grep -qF -- "$needle" <<<"$out"; then
    printf '  FAIL  %s (exit %s)\n%s\n' "$label" "$status" "$out"
    FAIL=$((FAIL + 1))
  else
    printf '  ok    %s\n' "$label"
    PASS=$((PASS + 1))
  fi
}

summary() {
  python3 - "$WORK/$1" "${@:2}" <<'PY'
import json, sys
json.dump({"api_scopes": sys.argv[2:]}, open(sys.argv[1], "w"))
PY
  printf '%s' "$WORK/$1"
}

GENIE="$(python3 -c 'import json,sys; print(next(s for s in json.load(open(sys.argv[1]))["model_scopes"] if "genie" in s))' "$CONTRACT")"
SQL="$(python3 -c 'import json,sys; print(next(s for s in json.load(open(sys.argv[1]))["model_scopes"] if s.startswith("sql")))' "$CONTRACT")"

check_says "static model contract agrees" 0 "scopes agree" \
  python3 "$GATE" --target "$TARGET"
check_says "logged Genie and SQL agree" 0 "and logged scopes agree" \
  python3 "$GATE" --target "$TARGET" --logged "$(summary good.json "$GENIE" "$SQL")"
check_says "a missing required scope fails" 1 "will not carry the scope" \
  env PLAYER_INSIGHTS_DATA_GENIE_ID=space-id PLAYER_INSIGHTS_WAREHOUSE_ID=warehouse-id \
  python3 "$GATE" --target "$TARGET" --logged "$(summary short.json "$GENIE")"
check_says "an unrelated extra scope fails" 1 "one more API" \
  python3 "$GATE" --target "$TARGET" --logged "$(summary wide.json "$GENIE" "$SQL" "files.files")"
check_says "an unsupported API scope is refused as extra" 1 "one more API" \
  python3 "$GATE" --target "$TARGET" --logged \
  "$(summary unsupported.json "$GENIE" "$SQL" "vector""search.vector-""search-indexes")"
check_says "an empty policy fails" 1 "EMPTY api_scopes" \
  python3 "$GATE" --target "$TARGET" --logged "$(summary empty.json)"
printf 'not json' > "$WORK/bad.json"
check_says "bad summary is exit 2" 2 "COULD NOT RUN the logged leg" \
  python3 "$GATE" --target "$TARGET" --logged "$WORK/bad.json"
printf '{"model_version":"1"}' > "$WORK/wrong.json"
check_says "wrong summary shape is exit 2" 2 "no api_scopes key" \
  python3 "$GATE" --target "$TARGET" --logged "$WORK/wrong.json"
check_says "missing summary is exit 2" 2 "COULD NOT RUN the logged leg" \
  python3 "$GATE" --target "$TARGET" --logged "$WORK/missing.json"
check_says "unknown target is exit 2" 2 "COULD NOT RUN" \
  python3 "$GATE" --target no-such-target
check_says "the gate is cwd-independent" 0 "scopes agree" \
  bash -c 'cd / && exec python3 "$1" --target "$2"' _ "$GATE" "$TARGET"

if (( FAIL )); then
  printf 'FAIL  %d of %d assertions failed.\n' "$FAIL" "$((PASS + FAIL))"
  exit 1
fi
printf 'PASS  %d assertions.\n' "$PASS"
