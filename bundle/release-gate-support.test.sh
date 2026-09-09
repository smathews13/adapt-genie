#!/usr/bin/env bash
# Focused, workspace-free checks for ADAPT's restored release-gate support.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/adapt-release-support.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

python3 "$HERE/scope-contract.py" --check
python3 - "$HERE/scope-contract.json" <<'PY'
import json, sys
contract = json.load(open(sys.argv[1]))
assert contract["app_resource"] == {
    "file": "resources/adapt_app.app.yml",
    "bundle_key": "apps.adapt_app",
}
assert set(contract["model_scopes"]) == {"dashboards.genie", "sql"}
forbidden = tuple(
    "".join(parts)
    for parts in (
        ("vector", "search"),
        ("semantic", "-index"),
        ("dict", "ionary"),
        ("jud", "ge"),
        ("astro", "labe"),
        ("data source", " finder"),
        ("player", " insights"),
    )
)
text = json.dumps(contract).lower()
assert not any(term in text for term in forbidden)
PY

cat > "$WORK/log.txt" <<'EOF'
starting
{"model_version":"41","api_scopes":["dashboards.genie","sql"]}
warning printed after registration
EOF
[[ "$(python3 "$HERE/read-log-summary.py" "$WORK/log.txt" --write "$WORK/summary.json")" == 41 ]]
python3 - "$WORK/summary.json" <<'PY'
import json, sys
assert json.load(open(sys.argv[1]))["api_scopes"] == ["dashboards.genie", "sql"]
PY

mkdir "$WORK/evidence"
python3 - "$REPO" "$WORK/evidence" <<'PY'
import importlib.util, json, pathlib, sys
repo, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
spec = importlib.util.spec_from_file_location("drift", repo / "bundle" / "drift-check.py")
drift = importlib.util.module_from_spec(spec); spec.loader.exec_module(drift)
scopes = drift.declared_app_scopes("customer")
(out / "app.json").write_text(json.dumps({
    "user_api_scopes": scopes,
    "effective_user_api_scopes": scopes + ["iam.current-user:read"],
    "resources": [
        {"name": name, kind: {}} for name, kind in drift.declared_app_resources()
    ],
}))
(out / "tables.json").write_text('[{"name":"release_fixture"}]')
PY
python3 "$HERE/drift-check.py" --target customer --evidence "$WORK/evidence" \
  --leg scope-counts --leg resource-observed

grep -q 'A missing customer release gate is not a pass' "$HERE/app-release.sh"
grep -q 'The generated scope contract is incomplete' "$HERE/app-release.sh"
grep -q 'A missing release check is not a pass' "$HERE/agent-release.sh"
grep -q 'read-log-summary.py' "$HERE/agent-release.sh"
echo "release-gate-support.test.sh: ok"
