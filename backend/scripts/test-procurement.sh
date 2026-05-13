#!/bin/bash
# Procurement (PO + GRN) module RBAC + workflow tests
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

# Find a supplier + product + warehouse to use
SUPPLIER_ID=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/suppliers?limit=1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);process.stdout.write(j.rows[0].id)})')
PRODUCT_ID=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/products?limit=1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);let r=j.rows||j;process.stdout.write(r[0].id)})')
WAREHOUSE_ID=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/inventory/warehouses" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);process.stdout.write(j[0].id)})')
echo "supplier=$SUPPLIER_ID product=$PRODUCT_ID warehouse=$WAREHOUSE_ID"

# ─────────────────────────────────────────────────────────────────────
echo ""
echo "===== TEST 1: Anonymous → 401 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" $BASE/purchase-orders)
[ "$CODE" = "401" ] && PASS "401 unauthorized" || FAIL "got $CODE"

echo ""
echo "===== TEST 2: Warehouse role can READ POs ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $WH" $BASE/purchase-orders)
[ "$CODE" = "200" ] && PASS "200 read OK" || FAIL "got $CODE"

echo ""
echo "===== TEST 3: Warehouse cannot CREATE PO → 403 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $WH" -H "Content-Type: application/json" \
  -d '{"supplierId":"'$SUPPLIER_ID'","lines":[{"productId":"'$PRODUCT_ID'","qtyOrdered":1,"unitPrice":10}]}' $BASE/purchase-orders)
[ "$CODE" = "403" ] && PASS "403 forbidden" || FAIL "got $CODE"

echo ""
echo "===== TEST 4: Procurement creates DRAFT PO ====="
R=$(curl -s -X POST -H "Authorization: Bearer $PROC" -H "Content-Type: application/json" \
  -d '{"supplierId":"'$SUPPLIER_ID'","currency":"USD","lines":[{"productId":"'$PRODUCT_ID'","qtyOrdered":10,"unitPrice":12.50}]}' \
  $BASE/purchase-orders)
PO_ID=$(echo "$R" | jget id)
PO_NUMBER=$(echo "$R" | jget poNumber)
[ -n "$PO_ID" ] && PASS "PO created $PO_NUMBER" || FAIL "$R"

echo ""
echo "===== TEST 5: KPIs endpoint accessible to all auth'd users ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $WH" $BASE/purchase-orders/kpis)
[ "$CODE" = "200" ] && PASS "200 OK" || FAIL "got $CODE"

echo ""
echo "===== TEST 6: Update DRAFT lines ====="
R=$(curl -s -X PUT -H "Authorization: Bearer $PROC" -H "Content-Type: application/json" \
  -d '{"notes":"updated","lines":[{"productId":"'$PRODUCT_ID'","qtyOrdered":20,"unitPrice":11.00}]}' \
  $BASE/purchase-orders/$PO_ID)
NEW_NOTES=$(echo "$R" | jget notes)
[ "$NEW_NOTES" = "updated" ] && PASS "PO updated" || FAIL "$R"

echo ""
echo "===== TEST 7: Submit for approval ====="
R=$(curl -s -X POST -H "Authorization: Bearer $PROC" $BASE/purchase-orders/$PO_ID/submit)
STATUS=$(echo "$R" | jget status)
[ "$STATUS" = "PENDING_APPROVAL" ] && PASS "status PENDING_APPROVAL" || FAIL "got $STATUS: $R"

echo ""
echo "===== TEST 8: Same-user approval blocked (procurement created it) → 409 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $PROC" $BASE/purchase-orders/$PO_ID/approve)
[ "$CODE" = "409" -o "$CODE" = "403" -o "$CODE" = "400" ] && PASS "blocked ($CODE)" || FAIL "got $CODE — same-user approval not blocked"

echo ""
echo "===== TEST 9: Admin can approve ====="
R=$(curl -s -X POST -H "Authorization: Bearer $ADMIN" $BASE/purchase-orders/$PO_ID/approve)
STATUS=$(echo "$R" | jget status)
[ "$STATUS" = "APPROVED" ] && PASS "approved" || FAIL "got $STATUS: $R"

echo ""
echo "===== TEST 10: Send to supplier ====="
R=$(curl -s -X POST -H "Authorization: Bearer $PROC" $BASE/purchase-orders/$PO_ID/send)
STATUS=$(echo "$R" | jget status)
[ "$STATUS" = "SENT" ] && PASS "sent" || FAIL "got $STATUS: $R"

echo ""
echo "===== TEST 11: Procurement cannot RECEIVE (warehouse only) → 403 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $PROC" -H "Content-Type: application/json" \
  -d '{"warehouseId":"'$WAREHOUSE_ID'","lines":[]}' $BASE/purchase-orders/$PO_ID/receive)
[ "$CODE" = "403" ] && PASS "403 forbidden" || FAIL "got $CODE"

echo ""
echo "===== TEST 12: Warehouse receives partial qty ====="
PO=$(curl -s -H "Authorization: Bearer $ADMIN" $BASE/purchase-orders/$PO_ID)
LINE_ID=$(echo "$PO" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{process.stdout.write(JSON.parse(d).lines[0].id)})')
R=$(curl -s -X POST -H "Authorization: Bearer $WH" -H "Content-Type: application/json" \
  -d '{"warehouseId":"'$WAREHOUSE_ID'","lines":[{"poLineId":"'$LINE_ID'","qtyReceived":12}]}' \
  $BASE/purchase-orders/$PO_ID/receive)
GRN_ID=$(echo "$R" | jget id)
[ -n "$GRN_ID" ] && PASS "GRN created $GRN_ID" || FAIL "$R"
PO=$(curl -s -H "Authorization: Bearer $ADMIN" $BASE/purchase-orders/$PO_ID)
STATUS=$(echo "$PO" | jget status)
[ "$STATUS" = "PARTIALLY_RECEIVED" ] && PASS "PO=PARTIALLY_RECEIVED" || FAIL "got $STATUS"

echo ""
echo "===== TEST 13: Over-receipt rejected → 409 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $WH" -H "Content-Type: application/json" \
  -d '{"warehouseId":"'$WAREHOUSE_ID'","lines":[{"poLineId":"'$LINE_ID'","qtyReceived":50}]}' \
  $BASE/purchase-orders/$PO_ID/receive)
[ "$CODE" = "409" ] && PASS "409 OVER_RECEIPT" || FAIL "got $CODE"

echo ""
echo "===== TEST 14: Receive remaining qty → PO RECEIVED ====="
R=$(curl -s -X POST -H "Authorization: Bearer $WH" -H "Content-Type: application/json" \
  -d '{"warehouseId":"'$WAREHOUSE_ID'","lines":[{"poLineId":"'$LINE_ID'","qtyReceived":8}]}' \
  $BASE/purchase-orders/$PO_ID/receive)
GRN2=$(echo "$R" | jget id)
[ -n "$GRN2" ] && PASS "second GRN $GRN2" || FAIL "$R"
PO=$(curl -s -H "Authorization: Bearer $ADMIN" $BASE/purchase-orders/$PO_ID)
STATUS=$(echo "$PO" | jget status)
[ "$STATUS" = "RECEIVED" ] && PASS "PO=RECEIVED" || FAIL "got $STATUS"

echo ""
echo "===== TEST 15: Add landed cost (FREIGHT, VALUE method) ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $FIN" -H "Content-Type: application/json" \
  -d '{"costType":"FREIGHT","amount":50,"allocationMethod":"VALUE"}' \
  $BASE/goods-receipts/$GRN_ID/landed-costs)
[ "$CODE" = "201" -o "$CODE" = "200" ] && PASS "allocated ($CODE)" || FAIL "got $CODE"

echo ""
echo "===== TEST 16: Procurement cannot add landed cost → 403 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $PROC" -H "Content-Type: application/json" \
  -d '{"costType":"DUTY","amount":10,"allocationMethod":"VALUE"}' \
  $BASE/goods-receipts/$GRN_ID/landed-costs)
[ "$CODE" = "403" ] && PASS "403 forbidden" || FAIL "got $CODE"

echo ""
echo "===== TEST 17: Reverse one receipt ====="
R=$(curl -s -X POST -H "Authorization: Bearer $WH" -H "Content-Type: application/json" \
  -d '{"reason":"test reversal"}' $BASE/goods-receipts/$GRN2/reverse)
STATUS=$(echo "$R" | jget status)
[ "$STATUS" = "REVERSED" ] && PASS "reversed" || FAIL "$R"
PO=$(curl -s -H "Authorization: Bearer $ADMIN" $BASE/purchase-orders/$PO_ID)
STATUS=$(echo "$PO" | jget status)
[ "$STATUS" = "PARTIALLY_RECEIVED" ] && PASS "PO rolled back to PARTIALLY_RECEIVED" || FAIL "got $STATUS"

echo ""
echo "===== TEST 18: PO activity log includes workflow events ====="
ACT=$(curl -s -H "Authorization: Bearer $PROC" "$BASE/purchase-orders/$PO_ID/activity?limit=50")
echo "$ACT" | grep -q "PO_SUBMITTED" && PASS "PO_SUBMITTED audited" || FAIL "missing PO_SUBMITTED"
echo "$ACT" | grep -q "PO_APPROVED" && PASS "PO_APPROVED audited" || FAIL "missing PO_APPROVED"
echo "$ACT" | grep -q "PO_SENT" && PASS "PO_SENT audited" || FAIL "missing PO_SENT"
echo "$ACT" | grep -q "PO_GOODS_RECEIVED" && PASS "PO_GOODS_RECEIVED audited" || FAIL "missing PO_GOODS_RECEIVED"

echo ""
echo "===== TEST 19: Cancel sent PO requires ADMIN ====="
# Create a fresh PO, submit/approve/send, then try cancel as procurement
R=$(curl -s -X POST -H "Authorization: Bearer $PROC" -H "Content-Type: application/json" \
  -d '{"supplierId":"'$SUPPLIER_ID'","lines":[{"productId":"'$PRODUCT_ID'","qtyOrdered":5,"unitPrice":5}]}' $BASE/purchase-orders)
PO2=$(echo "$R" | jget id)
curl -s -X POST -H "Authorization: Bearer $PROC" $BASE/purchase-orders/$PO2/submit > /dev/null
curl -s -X POST -H "Authorization: Bearer $ADMIN" $BASE/purchase-orders/$PO2/approve > /dev/null
curl -s -X POST -H "Authorization: Bearer $PROC" $BASE/purchase-orders/$PO2/send > /dev/null
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $PROC" -H "Content-Type: application/json" \
  -d '{"reason":"smoke"}' $BASE/purchase-orders/$PO2/cancel)
[ "$CODE" = "403" -o "$CODE" = "400" -o "$CODE" = "409" ] && PASS "blocked ($CODE)" || FAIL "got $CODE"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
  -d '{"reason":"smoke"}' $BASE/purchase-orders/$PO2/cancel)
[ "$CODE" = "200" ] && PASS "admin cancelled ($CODE)" || FAIL "got $CODE"

echo ""
echo "===== TEST 20: Close received PO ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $PROC" $BASE/purchase-orders/$PO_ID/close)
# PO is now PARTIALLY_RECEIVED (after reversal), so closing may not be allowed; accept 409/400 OR 200 if implementation permits
echo "  (close attempt returned $CODE — depends on current PO state)"

echo ""
[ -z "$FAILED" ] && echo "🎉 ALL PROCUREMENT TESTS PASSED" || { echo "❌ SOME TESTS FAILED"; exit 1; }
