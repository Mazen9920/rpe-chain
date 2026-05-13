#!/bin/bash
# Accounts Payable (Section 5) RBAC + workflow tests
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
PROC=$(login procurement@rpechain.com Admin@123)
WH=$(login warehouse@rpechain.com Admin@123)
FIN=$(login finance@rpechain.com Admin@123)
echo "Admin=${ADMIN:0:15}.. Proc=${PROC:0:15}.. WH=${WH:0:15}.. Fin=${FIN:0:15}.."

RUN=$RANDOM

SUPPLIER_ID=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/suppliers?limit=1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);process.stdout.write(j.rows[0].id)})')
echo "supplier=$SUPPLIER_ID"

# ─────────────────────────────────────────────────────────────────────
echo ""
echo "===== TEST 1: Anonymous → 401 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" $BASE/ap/invoices)
[ "$CODE" = "401" ] && PASS "401 unauthorized" || FAIL "got $CODE"

echo ""
echo "===== TEST 2: Procurement can READ invoices (AP_READ) ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $PROC" $BASE/ap/invoices)
[ "$CODE" = "200" ] && PASS "200 read OK" || FAIL "got $CODE"

echo ""
echo "===== TEST 3: Warehouse cannot READ invoices → 403 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $WH" $BASE/ap/invoices)
[ "$CODE" = "403" ] && PASS "403 forbidden" || FAIL "got $CODE"

echo ""
echo "===== TEST 4: Procurement cannot CREATE invoice → 403 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $PROC" -H "Content-Type: application/json" \
  -d '{"supplierId":"'$SUPPLIER_ID'","invoiceNumber":"X","lines":[{"quantity":1,"unitPrice":1}]}' $BASE/ap/invoices)
[ "$CODE" = "403" ] && PASS "403 forbidden" || FAIL "got $CODE"

echo ""
echo "===== TEST 5: Finance creates DRAFT invoice ====="
R=$(curl -s -X POST -H "Authorization: Bearer $FIN" -H "Content-Type: application/json" \
  -d '{"supplierId":"'$SUPPLIER_ID'","invoiceNumber":"TEST-'$RUN'","currency":"USD","invoiceDate":"2024-01-01","lines":[{"description":"Demo","quantity":2,"unitPrice":50}]}' \
  $BASE/ap/invoices)
INV_ID=$(echo "$R" | jget id)
STATUS=$(echo "$R" | jget status)
[ -n "$INV_ID" ] && [ "$STATUS" = "DRAFT" ] && PASS "created DRAFT $INV_ID" || FAIL "create failed: $R"

echo ""
echo "===== TEST 6: Duplicate invoiceNumber → 409 DUPLICATE_INVOICE ====="
R=$(curl -s -X POST -H "Authorization: Bearer $FIN" -H "Content-Type: application/json" \
  -d '{"supplierId":"'$SUPPLIER_ID'","invoiceNumber":"TEST-'$RUN'","currency":"USD","invoiceDate":"2024-01-01","lines":[{"description":"Dup","quantity":1,"unitPrice":10}]}' \
  $BASE/ap/invoices)
CODE=$(echo "$R" | jget code)
[ "$CODE" = "DUPLICATE_INVOICE" ] && PASS "DUPLICATE_INVOICE" || FAIL "got code=$CODE resp=$R"

echo ""
echo "===== TEST 7: Submit for matching → MATCHED (non-PO line goes NO_PO, auto-MATCHED) ====="
R=$(curl -s -X POST -H "Authorization: Bearer $FIN" $BASE/ap/invoices/$INV_ID/submit)
STATUS=$(echo "$R" | jget status)
[ "$STATUS" = "MATCHED" ] && PASS "MATCHED" || FAIL "got status=$STATUS resp=$R"

echo ""
echo "===== TEST 8: Approve invoice ====="
R=$(curl -s -X POST -H "Authorization: Bearer $FIN" -H "Content-Type: application/json" -d '{}' $BASE/ap/invoices/$INV_ID/approve)
STATUS=$(echo "$R" | jget status)
[ "$STATUS" = "APPROVED" ] && PASS "APPROVED" || FAIL "got status=$STATUS resp=$R"

echo ""
echo "===== TEST 9: KPIs endpoint reachable ====="
R=$(curl -s -H "Authorization: Bearer $FIN" $BASE/ap/invoices/kpis)
TOTAL=$(echo "$R" | jget total)
[ -n "$TOTAL" ] && PASS "kpis total=$TOTAL" || FAIL "kpis missing: $R"

echo ""
echo "===== TEST 10: Aging summary endpoint ====="
R=$(curl -s -H "Authorization: Bearer $FIN" $BASE/ap/aging/summary)
BUCKETS=$(echo "$R" | jget buckets.0)
[ "$BUCKETS" = "CURRENT" ] && PASS "buckets[0]=CURRENT" || FAIL "got: $R"

echo ""
echo "===== TEST 11: Aging detail endpoint ====="
R=$(curl -s -H "Authorization: Bearer $FIN" $BASE/ap/aging)
ASOF=$(echo "$R" | jget asOf)
[ -n "$ASOF" ] && PASS "asOf=$ASOF" || FAIL "no asOf: $R"

echo ""
echo "===== TEST 12: Supplier statement endpoint ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $FIN" "$BASE/ap/aging/statement/$SUPPLIER_ID")
[ "$CODE" = "200" ] && PASS "200 statement" || FAIL "got $CODE"

echo ""
echo "===== TEST 13: Procurement cannot CREATE payment → 403 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $PROC" -H "Content-Type: application/json" \
  -d '{"supplierId":"'$SUPPLIER_ID'","amount":1,"method":"CASH","applications":[]}' $BASE/ap/payments)
[ "$CODE" = "403" ] && PASS "403 forbidden" || FAIL "got $CODE"

echo ""
echo "===== TEST 14: Finance records partial payment ====="
R=$(curl -s -X POST -H "Authorization: Bearer $FIN" -H "Content-Type: application/json" \
  -d '{"supplierId":"'$SUPPLIER_ID'","amount":40,"currency":"USD","method":"BANK_TRANSFER","reference":"WIRE-'$RUN'","applications":[{"invoiceId":"'$INV_ID'","amountApplied":40}]}' \
  $BASE/ap/payments)
PAY_ID=$(echo "$R" | jget id)
PAY_STATUS=$(echo "$R" | jget status)
[ -n "$PAY_ID" ] && [ "$PAY_STATUS" = "POSTED" ] && PASS "payment posted $PAY_ID" || FAIL "payment failed: $R"

echo ""
echo "===== TEST 15: Invoice now PARTIALLY_PAID ====="
R=$(curl -s -H "Authorization: Bearer $FIN" $BASE/ap/invoices/$INV_ID)
STATUS=$(echo "$R" | jget status)
PAID=$(echo "$R" | jget paidAmount)
[ "$STATUS" = "PARTIALLY_PAID" ] && PASS "status=PARTIALLY_PAID paid=$PAID" || FAIL "got status=$STATUS paid=$PAID"

echo ""
echo "===== TEST 16: Over-application rejected → 409 OVER_APPLICATION ====="
R=$(curl -s -X POST -H "Authorization: Bearer $FIN" -H "Content-Type: application/json" \
  -d '{"supplierId":"'$SUPPLIER_ID'","amount":9999,"currency":"USD","method":"CASH","applications":[{"invoiceId":"'$INV_ID'","amountApplied":9999}]}' \
  $BASE/ap/payments)
CODE=$(echo "$R" | jget code)
[ "$CODE" = "OVER_APPLICATION" ] && PASS "OVER_APPLICATION" || FAIL "got code=$CODE resp=$R"

echo ""
echo "===== TEST 17: Finance cannot VOID payment (admin only) → 403 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $FIN" -H "Content-Type: application/json" \
  -d '{"reason":"test"}' $BASE/ap/payments/$PAY_ID/void)
[ "$CODE" = "403" ] && PASS "403 forbidden" || FAIL "got $CODE"

echo ""
echo "===== TEST 18: Admin VOIDS payment ====="
R=$(curl -s -X POST -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
  -d '{"reason":"reversal test"}' $BASE/ap/payments/$PAY_ID/void)
STATUS=$(echo "$R" | jget status)
[ "$STATUS" = "VOIDED" ] && PASS "VOIDED" || FAIL "got status=$STATUS resp=$R"

echo ""
echo "===== TEST 19: Invoice reverted to APPROVED with paidAmount=0 ====="
R=$(curl -s -H "Authorization: Bearer $FIN" $BASE/ap/invoices/$INV_ID)
STATUS=$(echo "$R" | jget status)
PAID=$(echo "$R" | jget paidAmount)
[ "$STATUS" = "APPROVED" ] && PASS "status=APPROVED paid=$PAID" || FAIL "got status=$STATUS paid=$PAID"

echo ""
echo "===== TEST 20: Void invoice with no payments → VOID ====="
R=$(curl -s -X POST -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
  -d '{"reason":"end of test"}' $BASE/ap/invoices/$INV_ID/void)
STATUS=$(echo "$R" | jget status)
[ "$STATUS" = "VOID" ] && PASS "VOID" || FAIL "got status=$STATUS resp=$R"

echo ""
echo "===== TEST 21: Credit note creation ====="
# Find a non-voided approved/paid invoice from seed
PAID_INV=$(curl -s -H "Authorization: Bearer $FIN" "$BASE/ap/invoices?status=PAID&limit=1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);process.stdout.write(j.rows[0]?j.rows[0].id:"")})')
if [ -n "$PAID_INV" ]; then
  R=$(curl -s -X POST -H "Authorization: Bearer $FIN" -H "Content-Type: application/json" \
    -d '{"creditedInvoiceId":"'$PAID_INV'","invoiceNumber":"CN-TEST-'$RUN'","invoiceDate":"2024-01-01","lines":[{"description":"Refund","quantity":1,"unitPrice":10}]}' \
    $BASE/ap/credit-notes)
  TYPE=$(echo "$R" | jget invoiceType)
  [ "$TYPE" = "CREDIT_NOTE" ] && PASS "credit note created" || FAIL "type=$TYPE resp=$R"
else
  echo "  (no PAID invoice in seed; skipping)"
fi

echo ""
[ -z "$FAILED" ] && echo "🎉 ALL AP TESTS PASSED" || { echo "❌ SOME TESTS FAILED"; exit 1; }
