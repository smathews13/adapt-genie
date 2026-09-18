#!/usr/bin/env bash
# Grant the app's configured user groups permission to invoke the model endpoint.
#
# The app forwards each signed-in user's token to Model Serving. The app resource
# binding grants only the app service principal, so the human's group must also
# hold CAN_QUERY or every correctly forwarded request is refused with HTTP 403.

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

[[ "${1:-}" == "--apply" ]] || die "This command changes endpoint permissions. Re-run with --apply."

require_target
resolve_profile
seed_bundle_cache

ENDPOINT="$(bundle_var serving_endpoint_name)"
ADMIN_GROUP="$(bundle_var app_admin_group)"
USER_GROUP="$(bundle_var app_user_group)"

ENDPOINT_JSON="$(databricks serving-endpoints get "$ENDPOINT" --profile "$PROFILE" -o json)" \
  || die "Could not read serving endpoint '$ENDPOINT'."
ENDPOINT_ID="$(printf '%s' "$ENDPOINT_JSON" | python3 -c '
import json, sys
value = str(json.load(sys.stdin).get("id") or "").strip()
if not value:
    raise SystemExit("the endpoint response carried no id")
print(value)
')"

ACL_JSON="$(python3 - "$ADMIN_GROUP" "$USER_GROUP" <<'PY'
import json
import sys

groups = list(dict.fromkeys(name.strip() for name in sys.argv[1:] if name.strip()))
print(json.dumps({
    "access_control_list": [
        {"group_name": name, "permission_level": "CAN_QUERY"}
        for name in groups
    ]
}))
PY
)"

step "Granting signed-in app groups CAN_QUERY on $ENDPOINT"
databricks permissions update serving-endpoints "$ENDPOINT_ID" \
  --profile "$PROFILE" \
  --json "$ACL_JSON" >/dev/null

PERMISSIONS_JSON="$(databricks permissions get serving-endpoints "$ENDPOINT_ID" \
  --profile "$PROFILE" -o json)"
PERMISSIONS_JSON="$PERMISSIONS_JSON" python3 - "$ADMIN_GROUP" "$USER_GROUP" <<'PY'
import json
import os
import sys

required = {name.strip() for name in sys.argv[1:] if name.strip()}
payload = json.loads(os.environ["PERMISSIONS_JSON"])
granted = set()
for entry in payload.get("access_control_list") or []:
    name = str(entry.get("group_name") or "").strip()
    levels = {
        str(permission.get("permission_level") or "")
        for permission in entry.get("all_permissions") or []
        if permission.get("inherited") is not True
    }
    if "CAN_QUERY" in levels or "CAN_MANAGE" in levels:
        granted.add(name)
missing = sorted(required - granted)
if missing:
    raise SystemExit("endpoint CAN_QUERY verification failed for: " + ", ".join(missing))
PY

note "verified CAN_QUERY for $ADMIN_GROUP and $USER_GROUP"
