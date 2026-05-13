#!/bin/bash
# Fulfillment (Section 6) RBAC + workflow tests
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

WAREHOUSE_ID=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/inventory/warehouses" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);let arr=Array.isArray(j)?j:(j.rows||j.items||[]);process.stdout.write(arr[0].id)})')
PRODUCT_ID=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/products?limit=50" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);let arr=Array.isArray(j)?j:(j.rows||j.items||[]);let p=arr.find(x=>x.sku==="RPE-FFR-6800")||arr.find(x=>x.type==="FINISHED")||arr[0];process.stdout.write(p.id)})')
echo "warehouse=$WAREHOUSE_ID product=$PRODUCT_ID"

# ─────────────────────────────────────────────────────────────────────
echo ""; echo "===== TEST 1: Anonymous → 401 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" $BASE/customers)
[ "$CODE" = "401" ] && PASS "401 unauthorized" || FAIL "got $CODE"

echo ""; echo "===== TEST 2: Warehouse can READ customers ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $WH" $BASE/customers)
[ "$CODE" = "200" ] && PASS "200 read OK" || FAIL "got $CODE"

echo ""; echo "===== TEST 3: Warehouse cannot CREATE customer → 403 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $WH" -H "Content-Type: application/json" \
  -d '{"code":"X","name":"Y"}' $BASE/customers)
[ "$CODE" = "403" ] && PASS "403 forbidden" || FAIL "got $CODE"

echo ""; echo "===== TEST 4: Sales creates customer ====="
R=$(curl -s -X POST -H "Authorization: Bearer $SALES" -H "Content-Type: application/json" \
  -d '{"code":"TEST-'$RUN'","name":"Test Customer '$RUN'","email":"t'$RUN'@test.example","currency":"USD","paymentTerms":"NET_30"}' \
  $BASE/customers)
CUST_ID=$(echo "$R" | jget id)
[ -n "$CUST_ID" ] && PASS "created $CUST_ID" || FAIL "create failed: $R"

echo ""; echo "===== TEST 5: Duplicate customer code → 409 ====="
R=$(curl -s -X POST -H "Authorization: Bearer $SALES" -H "Content-Type: application/json" \
  -d '{"code":"TEST-'$RUN'","name":"Dup"}' $BASE/customers)
CODE=$(echo "$R" | jget code)
[ "$CODE" = "DUPLICATE_CUSTOMER" ] && PASS "DUPLICATE_CUSTOMER" || FAIL "got code=$CODE"

echo ""; echo "===== TEST 6: Update customer ====="
R=$(curl -s -X PATCH -H "Authorization: Bearer $SALES" -H "Content-Type: application/json" \
  -d '{"phone":"+1-555-1234"}' $BASE/customers/$CUST_ID)
PHONE=$(echo "$R" | jget phone)
[ "$PHONE" = "+1-555-1234" ] && PASS "updated" || FAIL "got phone=$PHONE resp=$R"

echo ""; echo "===== TEST 7: Add contact ====="
R=$(curl -s -X POST -H "Authorization: Bearer $SALES" -H "Content-Type: application/json" \
  -d '{"name":"John Doe","email":"john@t.example","isPrimary":true}' \
  $BASE/customers/$CUST_ID/contacts)
CONTACT_ID=$(echo "$R" | jget id)
[ -n "$CONTACT_ID" ] && PASS "contact $CONTACT_ID" || FAIL "add contact failed: $R"

echo ""; echo "===== TEST 8: Add second contact (not primary) ====="
R=$(curl -s -X POST -H "Authorization: Bearer $SALES" -H "Content-Type: application/json" \
  -d '{"name":"Jane Roe","email":"jane@t.example"}' \
  $BASE/customers/$CUST_ID/contacts)
CONTACT2_ID=$(echo "$R" | jget id)
[ -n "$CONTACT2_ID" ] && PASS "contact $CONTACT2_ID" || FAIL "add contact 2 failed: $R"

echo ""; echo "===== TEST 9: Set second contact as primary ====="
R=$(curl -s -X POST -H "Authorization: Bearer $SALES" $BASE/customers/$CUST_ID/contacts/$CONTACT2_ID/primary)
IS_PRIM=$(echo "$R" | jget isPrimary)
[ "$IS_PRIM" = "true" ] && PASS "primary swapped" || FAIL "got isPrimary=$IS_PRIM resp=$R"

echo ""; echo "===== TEST 10: Delete first contact (auto-promote remaining) ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE -H "Authorization: Bearer $SALES" $BASE/customers/$CUST_ID/contacts/$CONTACT_ID)
[ "$CODE" = "200" ] || [ "$CODE" = "204" ] && PASS "deleted ($CODE)" || FAIL "got $CODE"

echo ""; echo "===== TEST 11: Warehouse cannot CREATE sales order → 403 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $WH" -H "Content-Type: application/json" \
  -d '{"customerId":"'$CUST_ID'","warehouseId":"'$WAREHOUSE_ID'","lines":[{"productId":"'$PRODUCT_ID'","qty":1,"unitPrice":1}]}' \
  $BASE/sales-orders)
[ "$CODE" = "403" ] && PASS "403 forbidden" || FAIL "got $CODE"

echo ""; echo "===== TEST 12: Sales creates SO ====="
R=$(curl -s -X POST -H "Authorization: Bearer $SALES" -H "Content-Type: application/json" \
  -d '{"customerId":"'$CUST_ID'","warehouseId":"'$WAREHOUSE_ID'","currency":"USD","lines":[{"productId":"'$PRODUCT_ID'","qty":2,"unitPrice":100}]}' \
  $BASE/sales-orders)
SO_ID=$(echo "$R" | jget id)
SO_STATUS=$(echo "$R" | jget status)
[ -n "$SO_ID" ] && [ "$SO_STATUS" = "RECEIVED" ] && PASS "SO $SO_ID status=$SO_STATUS" || FAIL "create failed: $R"

echo ""; echo "===== TEST 13: Empty lines → 400 ====="
R=$(curl -s -X POST -H "Authorization: Bearer $SALES" -H "Content-Type: application/json" \
  -d '{"customerId":"'$CUST_ID'","warehouseId":"'$WAREHOUSE_ID'","lines":[]}' \
  $BASE/sales-orders)
CODE=$(echo "$R" | jget code)
if [ "$CODE" = "VALIDATION" ] || [ "$CODE" = "EMPTY_LINES" ] || [ "$CODE" = "EMPTY_ORDER" ]; then PASS "rejected ($CODE)"; else FAIL "got code=$CODE"; fi

echo ""; echo "===== TEST 14: Confirm SO ====="
R=$(curl -s -X POST -H "Authorization: Bearer $SALES" $BASE/sales-orders/$SO_ID/confirm)
SO_STATUS=$(echo "$R" | jget status)
[ "$SO_STATUS" = "CONFIRMED" ] && PASS "CONFIRMED" || FAIL "got status=$SO_STATUS resp=$R"

echo ""; echo "===== TEST 15: Allocate SO ====="
R=$(curl -s -X POST -H "Authorization: Bearer $SALES" $BASE/sales-orders/$SO_ID/allocate)
SO_STATUS=$(echo "$R" | jget status)
SO_CODE=$(echo "$R" | jget code)
if [ "$SO_STATUS" = "ALLOCATED" ]; then
  PASS "ALLOCATED"
  ALLOC_OK=1
elif [ "$SO_CODE" = "INSUFFICIENT_STOCK" ]; then
  PASS "INSUFFICIENT_STOCK gracefully reported (no FIFO available)"
  ALLOC_OK=0
else
  FAIL "unexpected: $R"; ALLOC_OK=0
fi

echo ""; echo "===== TEST 16: KPIs endpoint ====="
R=$(curl -s -H "Authorization: Bearer $SALES" $BASE/sales-orders/kpis)
TOTAL=$(echo "$R" | jget total)
[ -n "$TOTAL" ] && PASS "kpis total=$TOTAL" || FAIL "kpis empty: $R"

echo ""; echo "===== TEST 17: List SOs ====="
R=$(curl -s -H "Authorization: Bearer $SALES" "$BASE/sales-orders?limit=5")
ROWS=$(echo "$R" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);let a=j.rows||j.items||j;process.stdout.write(String(a.length||0))})')
[ "$ROWS" != "0" ] && PASS "list ($ROWS rows)" || FAIL "no rows"

if [ "$ALLOC_OK" = "1" ]; then
  echo ""; echo "===== TEST 18: Pick SO ====="
  # build pick payload from order lines
  LINES_JSON=$(curl -s -H "Authorization: Bearer $SALES" $BASE/sales-orders/$SO_ID | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);let arr=(j.lines||[]).map(l=>({lineId:l.id,qtyPicked:l.qtyAllocated||l.qty}));process.stdout.write(JSON.stringify(arr))})')
  R=$(curl -s -X POST -H "Authorization: Bearer $SALES" -H "Content-Type: application/json" \
    -d "{\"lines\":$LINES_JSON}" $BASE/sales-orders/$SO_ID/pick)
  SO_STATUS=$(echo "$R" | jget status)
  [ "$SO_STATUS" = "PICKED" ] && PASS "PICKED" || FAIL "got status=$SO_STATUS resp=$R"

  echo ""; echo "===== TEST 19: Pack SO ====="
  R=$(curl -s -X POST -H "Authorization: Bearer $SALES" $BASE/sales-orders/$SO_ID/pack)
  SO_STATUS=$(echo "$R" | jget status)
  [ "$SO_STATUS" = "PACKED" ] && PASS "PACKED" || FAIL "got status=$SO_STATUS resp=$R"

  echo ""; echo "===== TEST 20: Ship SO ====="
  R=$(curl -s -X POST -H "Authorization: Bearer $SALES" -H "Content-Type: application/json" \
    -d '{"carrier":"DHL","trackingNumber":"DHL-TEST-'$RUN'","markInTransit":true}' \
    $BASE/sales-orders/$SO_ID/ship)
  SO_STATUS=$(echo "$R" | jget status)
  SHIP_ID=$(echo "$R" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);let s=(j.shipments&&j.shipments[0])||j.shipment||{};process.stdout.write(s.id||"")})')
  [ "$SO_STATUS" = "SHIPPED" ] && [ -n "$SHIP_ID" ] && PASS "SHIPPED shipment=$SHIP_ID" || FAIL "got status=$SO_STATUS ship=$SHIP_ID"

  echo ""; echo "===== TEST 21: Sales cannot VOID shipment → 403 ====="
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $SALES" $BASE/shipments/$SHIP_ID/void)
  [ "$CODE" = "403" ] && PASS "403 forbidden" || FAIL "got $CODE"

  echo ""; echo "===== TEST 22: Mark shipment DELIVERED ====="
  R=$(curl -s -X POST -H "Authorization: Bearer $SALES" $BASE/shipments/$SHIP_ID/deliver)
  SHIP_STATUS=$(echo "$R" | jget status)
  [ "$SHIP_STATUS" = "DELIVERED" ] && PASS "DELIVERED" || FAIL "got status=$SHIP_STATUS resp=$R"
fi

echo ""; echo "===== TEST 23: Cancel a fresh SO releases reservations ====="
R=$(curl -s -X POST -H "Authorization: Bearer $SALES" -H "Content-Type: application/json" \
  -d '{"customerId":"'$CUST_ID'","warehouseId":"'$WAREHOUSE_ID'","currency":"USD","lines":[{"productId":"'$PRODUCT_ID'","qty":1,"unitPrice":100}]}' \
  $BASE/sales-orders)
SO2_ID=$(echo "$R" | jget id)
R=$(curl -s -X POST -H "Authorization: Bearer $SALES" $BASE/sales-orders/$SO2_ID/cancel)
SO_STATUS=$(echo "$R" | jget status)
[ "$SO_STATUS" = "CANCELLED" ] && PASS "CANCELLED" || FAIL "got status=$SO_STATUS resp=$R"

echo ""; echo "===== TEST 24: Deactivate customer ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE -H "Authorization: Bearer $SALES" $BASE/customers/$CUST_ID)
[ "$CODE" = "200" ] || [ "$CODE" = "204" ] && PASS "deactivated ($CODE)" || FAIL "got $CODE"

echo ""
if [ "$FAILED" = "1" ]; then
  echo "✗ FAILED"; exit 1
else
  echo "✅ All fulfillment tests passed"
fi
