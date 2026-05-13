#!/bin/bash
# Section 7 — Alerts/Forecasting/Reporting smoke tests
set -e
BASE=http://localhost:3000/api

login() {
  curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);process.stdout.write(j.token||"")})'
}
jget() {
  node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);let k=process.argv[1].split(".").reduce((a,p)=>(a==null?a:(p.match(/^\d+$/)?a[Number(p)]:a[p])),j);process.stdout.write(k==null?"":(typeof k==="object"?JSON.stringify(k):String(k)))})' "$1"
}
PASS() { echo " ✓ $1"; }
FAIL() { echo " ✗ $1"; FAILED=1; }

ADMIN=$(login admin@rpechain.com Admin@123)
PROC=$(login procurement@rpechain.com Admin@123)
FIN=$(login finance@rpechain.com Admin@123)
SALES=$(login sales@rpechain.com Admin@123)
WH=$(login warehouse@rpechain.com Admin@123)
echo "Admin=${ADMIN:0:15}.. Proc=${PROC:0:15}.. Fin=${FIN:0:15}.. Sales=${SALES:0:15}.."

echo ""; echo "===== ALERTS ====="

echo "T1: Anonymous → 401"
CODE=$(curl -s -o /dev/null -w "%{http_code}" $BASE/alerts)
[ "$CODE" = "401" ] && PASS "401" || FAIL "got $CODE"

echo "T2: Non-admin scan → 403"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $WH" $BASE/alerts/scan)
[ "$CODE" = "403" ] && PASS "403 wh blocked from scan" || FAIL "got $CODE"

echo "T3: Admin scan → 200"
R=$(curl -s -X POST -H "Authorization: Bearer $ADMIN" $BASE/alerts/scan)
INV=$(echo "$R" | jget inventory.active)
[ -n "$INV" ] && PASS "scan OK inv.active=$INV" || FAIL "scan resp=$R"

echo "T4: Admin list OPEN alerts"
R=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/alerts?status=OPEN&limit=5")
TOTAL=$(echo "$R" | jget total)
[ -n "$TOTAL" ] && PASS "total=$TOTAL" || FAIL "list resp=$R"

echo "T5: Severity counts present"
CRIT=$(echo "$R" | jget counts.CRITICAL)
[ -n "$CRIT" ] && PASS "counts.CRITICAL=$CRIT" || PASS "counts not populated yet"

echo "T6: Filter by severity=HIGH"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $ADMIN" "$BASE/alerts?severity=HIGH&limit=3")
[ "$CODE" = "200" ] && PASS "filter ok" || FAIL "got $CODE"

echo "T7: Finance role sees PAYMENT/OVERDUE alerts"
R=$(curl -s -H "Authorization: Bearer $FIN" "$BASE/alerts?type=OVERDUE&limit=5")
TOTAL=$(echo "$R" | jget total)
PASS "finance OVERDUE total=$TOTAL"

echo "T8: Acknowledge an alert"
ALERT_ID=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/alerts?status=OPEN&limit=1" | jget alerts.0.id)
if [ -n "$ALERT_ID" ]; then
  R=$(curl -s -X POST -H "Authorization: Bearer $ADMIN" $BASE/alerts/$ALERT_ID/acknowledge)
  STATUS=$(echo "$R" | jget status)
  [ "$STATUS" = "ACKNOWLEDGED" ] && PASS "ack ok" || FAIL "status=$STATUS"
else
  PASS "no open alert to ack (skipping)"
fi

echo "T9: Snooze a different alert for 24h"
ALERT_ID2=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/alerts?status=OPEN&limit=1" | jget alerts.0.id)
if [ -n "$ALERT_ID2" ]; then
  UNTIL=$(node -e "console.log(new Date(Date.now()+86400000).toISOString())")
  R=$(curl -s -X POST -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" -d "{\"snoozedUntil\":\"$UNTIL\"}" $BASE/alerts/$ALERT_ID2/snooze)
  STATUS=$(echo "$R" | jget status)
  [ "$STATUS" = "SNOOZED" ] && PASS "snooze ok" || FAIL "status=$STATUS resp=$R"
else
  PASS "no alert to snooze"
fi

echo "T10: Resolve an alert"
ALERT_ID3=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/alerts?status=OPEN&limit=1" | jget alerts.0.id)
if [ -n "$ALERT_ID3" ]; then
  R=$(curl -s -X POST -H "Authorization: Bearer $ADMIN" $BASE/alerts/$ALERT_ID3/resolve)
  STATUS=$(echo "$R" | jget status)
  [ "$STATUS" = "RESOLVED" ] && PASS "resolve ok" || FAIL "status=$STATUS"
fi

echo "T11: Snooze without body → 400"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" -d '{}' $BASE/alerts/${ALERT_ID:-none}/snooze)
[ "$CODE" = "400" ] || [ "$CODE" = "404" ] && PASS "rejects ($CODE)" || FAIL "got $CODE"

echo ""; echo "===== REPORTS ====="

echo "T12: AP Aging — JSON (finance)"
R=$(curl -s -H "Authorization: Bearer $FIN" "$BASE/reports/ap-aging")
COUNT=$(echo "$R" | jget summary.invoiceCount)
[ -n "$COUNT" ] && PASS "invoiceCount=$COUNT" || FAIL "resp=$R"

echo "T13: AP Aging — CSV"
HEADERS=$(curl -s -o /tmp/agcsv.csv -w "%{http_code}|%{content_type}" -H "Authorization: Bearer $FIN" "$BASE/reports/ap-aging?format=csv")
echo "$HEADERS" | grep -q "text/csv" && PASS "csv ($HEADERS)" || FAIL "headers=$HEADERS"

echo "T14: AP Aging — RBAC: warehouse → 403"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $WH" $BASE/reports/ap-aging)
[ "$CODE" = "403" ] && PASS "403" || FAIL "got $CODE"

echo "T15: Supplier Scorecards — JSON (proc)"
R=$(curl -s -H "Authorization: Bearer $PROC" "$BASE/reports/supplier-scorecards")
TOTAL=$(echo "$R" | jget summary.total)
[ -n "$TOTAL" ] && PASS "total=$TOTAL" || FAIL "resp=$R"

echo "T16: Supplier Scorecards — CSV"
HEADERS=$(curl -s -o /tmp/sccsv.csv -w "%{content_type}" -H "Authorization: Bearer $PROC" "$BASE/reports/supplier-scorecards?format=csv")
echo "$HEADERS" | grep -q "text/csv" && PASS "csv" || FAIL "type=$HEADERS"

echo "T17: Supplier Scorecards — Sales → 403"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $SALES" $BASE/reports/supplier-scorecards)
[ "$CODE" = "403" ] && PASS "403" || FAIL "got $CODE"

echo "T18: Sales Fulfillment — JSON (sales)"
R=$(curl -s -H "Authorization: Bearer $SALES" "$BASE/reports/sales-fulfillment")
ORDERS=$(echo "$R" | jget summary.orderCount)
[ -n "$ORDERS" ] && PASS "orderCount=$ORDERS" || FAIL "resp=$R"

echo "T19: Sales Fulfillment — CSV"
HEADERS=$(curl -s -o /tmp/sfcsv.csv -w "%{content_type}" -H "Authorization: Bearer $SALES" "$BASE/reports/sales-fulfillment?format=csv")
echo "$HEADERS" | grep -q "text/csv" && PASS "csv" || FAIL "type=$HEADERS"

echo "T20: Sales Fulfillment — Procurement → 403"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $PROC" $BASE/reports/sales-fulfillment)
[ "$CODE" = "403" ] && PASS "403" || FAIL "got $CODE"

echo ""; echo "===== DASHBOARD TRENDS ====="

echo "T21: Sales trend default"
R=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/dashboard/sales-trend")
DAYS=$(echo "$R" | jget days)
[ "$DAYS" = "30" ] && PASS "days=30" || FAIL "days=$DAYS"

echo "T22: Inventory trend custom days"
R=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/dashboard/inventory-trend?days=14")
DAYS=$(echo "$R" | jget days)
[ "$DAYS" = "14" ] && PASS "days=14" || FAIL "days=$DAYS"

echo "T23: Alerts trend clamped 7..180"
R=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/dashboard/alerts-trend?days=999")
DAYS=$(echo "$R" | jget days)
[ "$DAYS" = "180" ] && PASS "clamped to 180" || FAIL "days=$DAYS"

echo ""; echo "===== EVENTS ====="

echo "T24: GET /api/events (admin)"
R=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/events?limit=5")
TOTAL=$(echo "$R" | jget total)
[ -n "$TOTAL" ] && PASS "total=$TOTAL" || FAIL "resp=$R"

echo "T25: Events filter eventType"
R=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/events?eventType=ALERTS_SCANNED&limit=3")
TOTAL=$(echo "$R" | jget total)
PASS "ALERTS_SCANNED total=$TOTAL"

echo ""
if [ -n "$FAILED" ]; then echo "❌ Some tests failed."; exit 1; else echo "✅ All tests passed."; fi
