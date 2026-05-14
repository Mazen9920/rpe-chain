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

# Tier 3 — anomaly alerts (added in v1.3.0).
if [ -f test-anomaly-alerts.sh ]; then
  SCRIPTS+=(test-anomaly-alerts.sh)
fi
if [ -f test-classification.sh ]; then
  SCRIPTS+=(test-classification.sh)
fi
if [ -f test-match-tolerances.sh ]; then
  SCRIPTS+=(test-match-tolerances.sh)
fi
if [ -f test-fx.sh ]; then
  SCRIPTS+=(test-fx.sh)
fi

# Tier 4 — Accounts Receivable (added in v1.4.0).
if [ -f test-ar.sh ]; then
  SCRIPTS+=(test-ar.sh)
fi

# Tier 4 #15 — Custom reports + scheduled exports (added in v1.5.0).
if [ -f test-reports.sh ]; then
  SCRIPTS+=(test-reports.sh)
fi

# Tier 4 #16 — Mobile pick/pack + barcode (added in v1.6.0).
if [ -f test-mobile.sh ]; then
  SCRIPTS+=(test-mobile.sh)
fi

# Tier 4 #17 — GL Export (QuickBooks/Xero) (added in v1.7.0).
if [ -f test-gl.sh ]; then
  SCRIPTS+=(test-gl.sh)
fi

# v1.7.1 — OAuth2 integrations (real QBO+Xero push).
if [ -f test-oauth.sh ]; then
  SCRIPTS+=(test-oauth.sh)
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
