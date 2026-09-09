#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE="$ROOT/databricks.yml"

required=(
  'name: adapt-genie'
  'default: adapt-orchestrator'
  'default: ${var.app_catalog}.${var.app_schema}.adapt_orchestrator'
  'default: /Shared/adapt-genie'
  'default: adapt'
  'app_admin_group:'
  'app_user_group:'
  'watchlist_table:'
)

for value in "${required[@]}"; do
  grep -Fq "$value" "$BUNDLE" || {
    printf 'FAIL  missing ADAPT bundle default: %s\n' "$value" >&2
    exit 1
  }
done

grep -Fq 'group_name: ${var.app_admin_group}' "$ROOT/resources/adapt_app.app.yml"
grep -Fq 'group_name: ${var.app_user_group}' "$ROOT/resources/adapt_app.app.yml"

for resource in \
  adapt_app.app.yml \
  adapt_experiment.experiment.yml \
  adapt_telemetry.schema.yml
do
  [[ -f "$ROOT/resources/$resource" ]] || {
    printf 'FAIL  missing ADAPT resource file: %s\n' "$resource" >&2
    exit 1
  }
done

if [[ -e "$ROOT/resources/adapt.schema.yml" || -e "$ROOT/resources/adapt_assets.volume.yml" ]]; then
  printf 'FAIL  customer bundle tries to manage the existing model schema or an unused volume\n' >&2
  exit 1
fi

retired_resource_prefix='player_'"insights"
if compgen -G "$ROOT/resources/${retired_resource_prefix}*" >/dev/null; then
  printf 'FAIL  customer bundle still contains an unsupported resource file\n' >&2
  exit 1
fi

retired_resource_pattern='vector_''search|semantic_''index_endpoint|jud''ge_endpoint|genie_dict''ionary_space_id'
if grep -Eq "$retired_resource_pattern" \
  "$BUNDLE" "$ROOT"/resources/*.yml
then
  printf 'FAIL  customer bundle reintroduced an unsupported resource\n' >&2
  exit 1
fi

printf 'adapt-naming.test.sh: ok\n'
