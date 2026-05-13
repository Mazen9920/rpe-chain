#!/usr/bin/env bash
# Run every section smoke-test script in order.
# Assumes:
#   - Backend reachable at $BASE (default http://localhost:3000/api)
#   - Database already migrated + seeded
set -euo pipefail

cd "$(dirname "$0")"

SCRIPTS=(
  test-suppliers.sh
  test-procurement.sh
  test-manufacturing.sh
  test-ap.sh
  test-fulfillment.sh
  test-alerts-reporting.sh
)

# Auth-hardening tests only exist after Phase F lands.
if [ -f test-auth-hardening.sh ]; then
  SCRIPTS+=(test-auth-hardening.sh)
fi

FAILED=()
for s in "${SCRIPTS[@]}"; do
  echo ""
  echo "════════════════════════════════════════════════════════════"
  echo "  Running $s"
  echo "════════════════════════════════════════════════════════════"
  if bash "$s"; then
    echo "✓ $s passed"
  else
    echo "✗ $s FAILED"
    FAILED+=("$s")
  fi
done

echo ""
echo "════════════════════════════════════════════════════════════"
if [ ${#FAILED[@]} -eq 0 ]; then
  echo "ALL ${#SCRIPTS[@]} SUITES PASSED"
  exit 0
else
  echo "FAILED: ${FAILED[*]}"
  exit 1
fi
