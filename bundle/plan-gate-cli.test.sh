#!/usr/bin/env bash
# Prove that a direct-planner panic fails closed with a reproducible command.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/adapt-plan-gate-cli.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/databricks" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' \
  'panic: runtime error: invalid memory address or nil pointer dereference' \
  'databricks/cli/bundle/direct/dresources.(*ResourceApp).OverrideChangeDesc' >&2
exit 139
EOF
chmod +x "$TMP/databricks"

set +e
OUTPUT="$(
  PATH="$TMP:$PATH" TARGET=customer PROFILE=customer \
    "$HERE/plan-gate.sh" 2>&1
)"
STATUS=$?
set -e

[[ "$STATUS" -eq 2 ]] || {
  printf 'FAIL  expected exit 2, got %s\n%s\n' "$STATUS" "$OUTPUT"
  exit 1
}

for NEEDLE in \
  "COULD NOT RUN" \
  "This is NOT a clean plan" \
  "databricks bundle plan -t customer" \
  "do not read this as" \
  "permission to deploy"
do
  [[ "$OUTPUT" == *"$NEEDLE"* ]] || {
    printf 'FAIL  recovery output omitted: %s\n%s\n' "$NEEDLE" "$OUTPUT"
    exit 1
  }
done

printf 'PASS  direct-planner panic fails closed with a reproducible command.\n'
