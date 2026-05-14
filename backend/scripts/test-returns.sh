#!/bin/bash
# Customer Returns (RMA) — v2.0.0 smoke tests
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
FAIL() { echo " ✗ $1"; FAILED=1; exit 1; }

ADMIN=$(login admin@rpechain.com Admin@123)
SALES=$(login sales@rpechain.com Admin@123)
WH=$(login warehouse@rpechain.com Admin@123)
FIN=$(login finance@rpechain.com Admin@123)

# ── Find or create a posted CustomerInvoice with product lines ───────────
CUSTOMER_ID=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/customers?limit=1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);process.stdout.write((j.items||j.rows)[0].id)})')
WAREHOUSE_ID=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/inventory/warehouses" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);let arr=j.items||j.rows||j;process.stdout.write(arr[0].id)})')
PRODUCT_ID=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/products?limit=1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);let arr=j.items||j.rows||j;process.stdout.write(arr[0].id)})')
echo "customer=$CUSTOMER_ID warehouse=$WAREHOUSE_ID product=$PRODUCT_ID"

RUN=$RANDOM
INV_RES=$(curl -s -X POST -H "Authorization: Bearer $FIN" -H "Content-Type: application/json" \
  -d "{\"customerId\":\"$CUSTOMER_ID\",\"invoiceNumber\":\"RMA-TEST-$RUN\",\"invoiceDate\":\"$(date -u +%Y-%m-%d)\",\"lines\":[{\"productId\":\"$PRODUCT_ID\",\"description\":\"widget\",\"quantity\":5,\"unitPrice\":20}]}" \
  $BASE/ar/invoices)
INVOICE_ID=$(echo "$INV_RES" | jget id)
[ -n "$INVOICE_ID" ] && PASS "seed invoice $INVOICE_ID" || FAIL "no invoice: $INV_RES"

echo ""
echo "===== TEST 1: Anonymous list returns → 401 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" $BASE/customer-returns)
[ "$CODE" = "401" ] && PASS "401" || FAIL "got $CODE"

echo ""
echo "===== TEST 2: SALES can create a return ====="
CR_RES=$(curl -s -X POST -H "Authorization: Bearer $SALES" -H "Content-Type: application/json" \
  -d "{\"customerInvoiceId\":\"$INVOICE_ID\",\"warehouseId\":\"$WAREHOUSE_ID\",\"reason\":\"DEFECTIVE\",\"lines\":[{\"productId\":\"$PRODUCT_ID\",\"qty\":2,\"unitPrice\":20}]}" \
  $BASE/customer-returns)
CR_ID=$(echo "$CR_RES" | jget id)
RETURN_NUM=$(echo "$CR_RES" | jget returnNumber)
[ -n "$CR_ID" ] && PASS "created $RETURN_NUM ($CR_ID)" || FAIL "no return: $CR_RES"

echo ""
echo "===== TEST 3: returnNumber matches RMA-YYYYMM-NNNN ====="
echo "$RETURN_NUM" | grep -qE '^RMA-[0-9]{6}-[0-9]{4}$' && PASS "format OK" || FAIL "got $RETURN_NUM"

echo ""
echo "===== TEST 4: WAREHOUSE cannot create → 403 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $WH" -H "Content-Type: application/json" \
  -d "{\"customerInvoiceId\":\"$INVOICE_ID\",\"warehouseId\":\"$WAREHOUSE_ID\",\"lines\":[{\"productId\":\"$PRODUCT_ID\",\"qty\":1}]}" \
  $BASE/customer-returns)
[ "$CODE" = "403" ] && PASS "403" || FAIL "got $CODE"

echo ""
echo "===== TEST 5: Qty exceeding invoiced → 400 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $SALES" -H "Content-Type: application/json" \
  -d "{\"customerInvoiceId\":\"$INVOICE_ID\",\"warehouseId\":\"$WAREHOUSE_ID\",\"lines\":[{\"productId\":\"$PRODUCT_ID\",\"qty\":99}]}" \
  $BASE/customer-returns)
[ "$CODE" = "400" ] && PASS "400" || FAIL "got $CODE"

echo ""
echo "===== TEST 6: SALES cannot approve → 403 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $SALES" $BASE/customer-returns/$CR_ID/approve)
[ "$CODE" = "403" ] && PASS "403" || FAIL "got $CODE"

echo ""
echo "===== TEST 7: FINANCE approves ====="
APP_RES=$(curl -s -X POST -H "Authorization: Bearer $FIN" $BASE/customer-returns/$CR_ID/approve)
STATUS=$(echo "$APP_RES" | jget status)
[ "$STATUS" = "APPROVED" ] && PASS "APPROVED" || FAIL "got $STATUS: $APP_RES"

echo ""
echo "===== TEST 8: Cannot approve again → 409 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $FIN" $BASE/customer-returns/$CR_ID/approve)
[ "$CODE" = "409" ] && PASS "409" || FAIL "got $CODE"

echo ""
echo "===== TEST 9: WAREHOUSE receives → stock IN ====="
# Capture stock before
ONHAND_BEFORE=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/inventory/stock-levels?productId=$PRODUCT_ID&warehouseId=$WAREHOUSE_ID" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);let arr=j.items||j.rows||j;process.stdout.write(String(Number((arr[0]||{}).onHand||0)))})')
RCV_RES=$(curl -s -X POST -H "Authorization: Bearer $WH" $BASE/customer-returns/$CR_ID/receive)
STATUS=$(echo "$RCV_RES" | jget status)
[ "$STATUS" = "RECEIVED" ] && PASS "RECEIVED" || FAIL "got $STATUS: $RCV_RES"
ONHAND_AFTER=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/inventory/stock-levels?productId=$PRODUCT_ID&warehouseId=$WAREHOUSE_ID" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);let arr=j.items||j.rows||j;process.stdout.write(String(Number((arr[0]||{}).onHand||0)))})')
DELTA=$(node -e "console.log($ONHAND_AFTER - $ONHAND_BEFORE)")
[ "$DELTA" = "2" ] && PASS "onHand +2 ($ONHAND_BEFORE → $ONHAND_AFTER)" || FAIL "delta=$DELTA (before=$ONHAND_BEFORE after=$ONHAND_AFTER)"

echo ""
echo "===== TEST 10: FINANCE refunds → credit note ====="
REF_RES=$(curl -s -X POST -H "Authorization: Bearer $FIN" $BASE/customer-returns/$CR_ID/refund)
STATUS=$(echo "$REF_RES" | jget status)
CN_ID=$(echo "$REF_RES" | jget creditNoteId)
[ "$STATUS" = "REFUNDED" ] && [ -n "$CN_ID" ] && PASS "REFUNDED creditNoteId=$CN_ID" || FAIL "got $STATUS cn=$CN_ID: $REF_RES"

echo ""
echo "===== TEST 11: Cannot double-refund → 409 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $FIN" $BASE/customer-returns/$CR_ID/refund)
[ "$CODE" = "409" ] && PASS "409" || FAIL "got $CODE"

echo ""
echo "===== TEST 12: Credit note exists in AR with negative amount ====="
CN_AMT=$(curl -s -H "Authorization: Bearer $ADMIN" $BASE/ar/invoices/$CN_ID | jget amount)
node -e "process.exit(Number('$CN_AMT') < 0 ? 0 : 1)" && PASS "amount=$CN_AMT" || FAIL "amount=$CN_AMT"

echo ""
echo "===== TEST 13: Reject path on a fresh return ====="
CR2_RES=$(curl -s -X POST -H "Authorization: Bearer $SALES" -H "Content-Type: application/json" \
  -d "{\"customerInvoiceId\":\"$INVOICE_ID\",\"warehouseId\":\"$WAREHOUSE_ID\",\"lines\":[{\"productId\":\"$PRODUCT_ID\",\"qty\":1,\"unitPrice\":20}]}" \
  $BASE/customer-returns)
CR2_ID=$(echo "$CR2_RES" | jget id)
REJ=$(curl -s -X POST -H "Authorization: Bearer $FIN" -H "Content-Type: application/json" -d '{"reason":"customer changed mind"}' $BASE/customer-returns/$CR2_ID/reject)
STATUS=$(echo "$REJ" | jget status)
[ "$STATUS" = "REJECTED" ] && PASS "REJECTED" || FAIL "got $STATUS: $REJ"

echo ""
echo "🎉 ALL RMA TESTS PASSED"
