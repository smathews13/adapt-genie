#!/usr/bin/env bash
# CI smoke: validate the bundle without deploying.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
databricks bundle validate --strict -t "${TARGET:-customer}"
bash bundle/model-user-auth-check.test.sh
bash bundle/compare-runs.test.sh
printf 'ok - ADAPT CI smoke (validate + auth-check + experiment gate)\n'
