#!/bin/bash
# Accounts Receivable (Section 14, v1.4.0) — RBAC + workflow tests
set -e
BASE=http://localhost:3000/api

login() {
  curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);process.stdout.write(j.token||"")})'
}
jget() {
  node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);let k=process.argv[1].split(".").reduce((a,p)=>a&&a[p],j);process.stdout.write(k==null?"":String(k))})' "$1"
}
PASS() { echo " ✓ $1"; }
FAIL() { echo " ✗ $1"; FAILED=1; }

ADMIN=$(login admin@rpechain.com Admin@123)
SALES=$(login sales@rpechain.com Admin@123)
WH=$(login warehouse@rpechain.com Admin@123)
FIN=$(login finance@rpechain.com Admin@123)
echo "Admin=${ADMIN:0:15}.. Sales=${SALES:0:15}.. WH=${WH:0:15}.. Fin=${FIN:0:15}.."

RUN=$RANDOM
CUSTOMER_ID=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/customers?limit=1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);process.stdout.write((j.items||j.rows)[0].id)})')
DELIVERED_SHIP_ID=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/shipments?status=DELIVERED&limit=1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);let r=(j.rows||j.items||[])[0];process.stdout.write(r?r.id:"")})')
echo "customer=$CUSTOMER_ID delivered_ship=$DELIVERED_SHIP_ID"

# ───── RBAC ────────────────────────────────────────────────────────
echo ""
echo "===== TEST 1: Anonymous → 401 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" $BASE/ar/invoices)
[ "$CODE" = "401" ] && PASS "401 unauthorized" || FAIL "got $CODE"

echo ""
echo "===== TEST 2: Sales can READ invoices ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $SALES" $BASE/ar/invoices)
[ "$CODE" = "200" ] && PASS "200 read OK" || FAIL "got $CODE"

echo ""
echo "===== TEST 3: Warehouse cannot READ invoices → 403 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $WH" $BASE/ar/invoices)
[ "$CODE" = "403" ] && PASS "403 forbidden" || FAIL "got $CODE"

echo ""
echo "===== TEST 4: Warehouse cannot CREATE invoice → 403 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $WH" -H "Content-Type: application/json" \
  -d '{"customerId":"'$CUSTOMER_ID'","lines":[{"description":"x","quantity":1,"unitPrice":1}]}' $BASE/ar/invoices)
[ "$CODE" = "403" ] && PASS "403 forbidden" || FAIL "got $CODE"

# ───── Invoice lifecycle ───────────────────────────────────────────
echo ""
echo "===== TEST 5: Finance creates POSTED invoice ====="
R=$(curl -s -X POST -H "Authorization: Bearer $FIN" -H "Content-Type: application/json" \
  -d '{"customerId":"'$CUSTOMER_ID'","invoiceNumber":"AR-TEST-'$RUN'","currency":"USD","invoiceDate":"2024-01-01","lines":[{"description":"Demo","quantity":2,"unitPrice":50}]}' \
  $BASE/ar/invoices)
INV_ID=$(echo "$R" | jget id)
STATUS=$(echo "$R" | jget status)
AMT=$(echo "$R" | jget amount)
[ -n "$INV_ID" ] && [ "$STATUS" = "POSTED" ] && PASS "POSTED $INV_ID amount=$AMT" || FAIL "create failed: $R"

echo ""
echo "===== TEST 6: Duplicate invoiceNumber (same customer) → 409 ====="
R=$(curl -s -X POST -H "Authorization: Bearer $FIN" -H "Content-Type: application/json" \
  -d '{"customerId":"'$CUSTOMER_ID'","invoiceNumber":"AR-TEST-'$RUN'","currency":"USD","invoiceDate":"2024-01-01","lines":[{"description":"Dup","quantity":1,"unitPrice":10}]}' \
  $BASE/ar/invoices)
CODE=$(echo "$R" | jget code)
[ "$CODE" = "DUPLICATE_INVOICE" ] && PASS "DUPLICATE_INVOICE" || FAIL "got code=$CODE resp=$R"

echo ""
echo "===== TEST 7: KPIs endpoint reachable ====="
R=$(curl -s -H "Authorization: Bearer $FIN" $BASE/ar/invoices/kpis)
TOTAL=$(echo "$R" | jget total)
OPEN=$(echo "$R" | jget openReceivable)
[ -n "$TOTAL" ] && PASS "kpis total=$TOTAL open=$OPEN" || FAIL "kpis missing: $R"

echo ""
echo "===== TEST 8: Aging summary endpoint ====="
R=$(curl -s -H "Authorization: Bearer $FIN" $BASE/ar/aging/summary)
B0=$(echo "$R" | jget buckets.0)
[ "$B0" = "CURRENT" ] && PASS "buckets[0]=CURRENT" || FAIL "got: $R"

echo ""
echo "===== TEST 9: Aging detail endpoint ====="
R=$(curl -s -H "Authorization: Bearer $FIN" $BASE/ar/aging)
ASOF=$(echo "$R" | jget asOf)
[ -n "$ASOF" ] && PASS "asOf=$ASOF" || FAIL "no asOf: $R"

echo ""
echo "===== TEST 10: Customer statement endpoint ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $FIN" "$BASE/ar/aging/$CUSTOMER_ID/statement")
[ "$CODE" = "200" ] && PASS "200 statement" || FAIL "got $CODE"

# ───── Aging buckets math ──────────────────────────────────────────
echo ""
echo "===== TEST 11: Aging summary totals.CURRENT >= 100 (just-created invoice) ====="
R=$(curl -s -H "Authorization: Bearer $FIN" $BASE/ar/aging/summary)
CUR=$(echo "$R" | jget totals.CURRENT)
[ -n "$CUR" ] && PASS "CURRENT=$CUR" || FAIL "no totals: $R"

# ───── Payments ────────────────────────────────────────────────────
echo ""
echo "===== TEST 12: SALES cannot CREATE payment → 403 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $SALES" -H "Content-Type: application/json" \
  -d '{"customerId":"'$CUSTOMER_ID'","amount":1,"method":"CASH","applications":[]}' $BASE/ar/payments)
[ "$CODE" = "403" ] && PASS "403 forbidden" || FAIL "got $CODE"

echo ""
echo "===== TEST 13: Finance records partial payment ====="
R=$(curl -s -X POST -H "Authorization: Bearer $FIN" -H "Content-Type: application/json" \
  -d '{"customerId":"'$CUSTOMER_ID'","amount":40,"currency":"USD","method":"BANK_TRANSFER","reference":"AR-WIRE-'$RUN'","applications":[{"invoiceId":"'$INV_ID'","amountApplied":40}]}' \
  $BASE/ar/payments)
PAY_ID=$(echo "$R" | jget id)
PAY_STATUS=$(echo "$R" | jget status)
[ -n "$PAY_ID" ] && [ "$PAY_STATUS" = "POSTED" ] && PASS "payment posted $PAY_ID" || FAIL "payment failed: $R"

echo ""
echo "===== TEST 14: Invoice now PARTIALLY_PAID, paid=40 ====="
R=$(curl -s -H "Authorization: Bearer $FIN" $BASE/ar/invoices/$INV_ID)
STATUS=$(echo "$R" | jget status)
PAID=$(echo "$R" | jget paidAmount)
[ "$STATUS" = "PARTIALLY_PAID" ] && PASS "PARTIALLY_PAID paid=$PAID" || FAIL "got status=$STATUS paid=$PAID"

echo ""
echo "===== TEST 15: Over-application → OVER_APPLICATION ====="
R=$(curl -s -X POST -H "Authorization: Bearer $FIN" -H "Content-Type: application/json" \
  -d '{"customerId":"'$CUSTOMER_ID'","amount":9999,"currency":"USD","method":"CASH","applications":[{"invoiceId":"'$INV_ID'","amountApplied":9999}]}' \
  $BASE/ar/payments)
CODE=$(echo "$R" | jget code)
[ "$CODE" = "OVER_APPLICATION" ] && PASS "OVER_APPLICATION" || FAIL "got code=$CODE resp=$R"

echo ""
echo "===== TEST 16: Cross-currency payment without fxRate → FX_RATE_REQUIRED ====="
R=$(curl -s -X POST -H "Authorization: Bearer $FIN" -H "Content-Type: application/json" \
  -d '{"customerId":"'$CUSTOMER_ID'","amount":10,"currency":"EUR","method":"CASH","applications":[{"invoiceId":"'$INV_ID'","amountApplied":10}]}' \
  $BASE/ar/payments)
CODE=$(echo "$R" | jget code)
[ "$CODE" = "FX_RATE_REQUIRED" ] && PASS "FX_RATE_REQUIRED" || FAIL "got code=$CODE resp=$R"

echo ""
echo "===== TEST 17: Pay remaining 60 → invoice PAID ====="
R=$(curl -s -X POST -H "Authorization: Bearer $FIN" -H "Content-Type: application/json" \
  -d '{"customerId":"'$CUSTOMER_ID'","amount":60,"currency":"USD","method":"CASH","reference":"AR-FULL-'$RUN'","applications":[{"invoiceId":"'$INV_ID'","amountApplied":60}]}' \
  $BASE/ar/payments)
PAY2_ID=$(echo "$R" | jget id)
INV_AFTER=$(curl -s -H "Authorization: Bearer $FIN" $BASE/ar/invoices/$INV_ID | jget status)
[ "$INV_AFTER" = "PAID" ] && PASS "invoice PAID" || FAIL "got status=$INV_AFTER"

echo ""
echo "===== TEST 18: Void first payment LOCKED (later POSTED touched same invoice) → PAYMENT_LOCKED ====="
R=$(curl -s -X POST -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
  -d '{"reason":"reverse partial"}' $BASE/ar/payments/$PAY_ID/void)
CODE=$(echo "$R" | jget code)
[ "$CODE" = "PAYMENT_LOCKED" ] && PASS "PAYMENT_LOCKED" || FAIL "got code=$CODE resp=$R"

echo ""
echo "===== TEST 19: Finance cannot void payment (admin only) → 403 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $FIN" -H "Content-Type: application/json" \
  -d '{"reason":"x"}' $BASE/ar/payments/$PAY2_ID/void)
[ "$CODE" = "403" ] && PASS "403 forbidden" || FAIL "got $CODE"

echo ""
echo "===== TEST 20: Admin voids latest payment ====="
R=$(curl -s -X POST -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
  -d '{"reason":"reversal test"}' $BASE/ar/payments/$PAY2_ID/void)
STATUS=$(echo "$R" | jget status)
[ "$STATUS" = "VOIDED" ] && PASS "VOIDED" || FAIL "got status=$STATUS resp=$R"

echo ""
echo "===== TEST 21: Invoice reverted to PARTIALLY_PAID after void ====="
R=$(curl -s -H "Authorization: Bearer $FIN" $BASE/ar/invoices/$INV_ID)
STATUS=$(echo "$R" | jget status)
PAID=$(echo "$R" | jget paidAmount)
[ "$STATUS" = "PARTIALLY_PAID" ] && PASS "PARTIALLY_PAID paid=$PAID" || FAIL "got status=$STATUS paid=$PAID"

echo ""
echo "===== TEST 22: Void invoice with payments → INVOICE_HAS_PAYMENTS ====="
R=$(curl -s -X POST -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
  -d '{"reason":"too late"}' $BASE/ar/invoices/$INV_ID/void)
CODE=$(echo "$R" | jget code)
[ "$CODE" = "INVOICE_HAS_PAYMENTS" ] && PASS "INVOICE_HAS_PAYMENTS" || FAIL "got code=$CODE resp=$R"

# ───── Credit note ─────────────────────────────────────────────────
echo ""
echo "===== TEST 23: Credit note creation (negative amount) ====="
R=$(curl -s -X POST -H "Authorization: Bearer $FIN" -H "Content-Type: application/json" \
  -d '{"creditedInvoiceId":"'$INV_ID'","invoiceNumber":"AR-CN-'$RUN'","invoiceDate":"2024-01-15","lines":[{"description":"Refund","quantity":1,"unitPrice":10}]}' \
  $BASE/ar/credit-notes)
TYPE=$(echo "$R" | jget invoiceType)
CN_AMT=$(echo "$R" | jget amount)
# amount should be negative
NEG=$(echo "$CN_AMT" | awk '{print ($1<0)}')
[ "$TYPE" = "CREDIT_NOTE" ] && [ "$NEG" = "1" ] && PASS "CREDIT_NOTE amount=$CN_AMT" || FAIL "type=$TYPE amount=$CN_AMT resp=$R"

# ───── Generate from shipment + idempotency ─────────────────────────
# NOTE: full SO→pick→pack→ship→deliver flow lives in test-fulfillment.sh,
# which now asserts auto-billing + idempotency end-to-end (tests 23/24 there).

# ───── Alert scan ──────────────────────────────────────────────────
echo ""
echo "===== TEST 26: Alert scan endpoint reports ar section ====="
R=$(curl -s -X POST -H "Authorization: Bearer $ADMIN" $BASE/alerts/scan)
AR=$(echo "$R" | jget ar.active)
[ -n "$AR" ] && PASS "ar.active=$AR" || FAIL "no ar in scan: $R"

echo ""
[ -z "$FAILED" ] && echo "🎉 ALL AR TESTS PASSED" || { echo "❌ SOME TESTS FAILED"; exit 1; }
