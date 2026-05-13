#!/bin/bash
# Suppliers module RBAC + business-rule tests
set -e
BASE=http://localhost:3000/api

login() {
  curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);process.stdout.write(j.token||"")})'
}
PASS() { echo " ✓ $1"; }
FAIL() { echo " ✗ $1"; FAILED=1; }

ADMIN=$(login admin@rpechain.com Admin@123)
PROC=$(login procurement@rpechain.com Admin@123)
WH=$(login warehouse@rpechain.com Admin@123)
echo "Admin=${ADMIN:0:15}.. Proc=${PROC:0:15}.. Warehouse=${WH:0:15}.."

# Use unique code per run (deactivate is soft → code remains in DB)
RUN=$RANDOM
SUP_CODE="SUP-TEST-$RUN"
CAT_CODE="TEST_CAT_$RUN"

echo ""
echo "===== TEST 1: Anonymous → 401 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" $BASE/suppliers)
[ "$CODE" = "401" ] && PASS "401 unauthorized" || FAIL "got $CODE"

echo ""
echo "===== TEST 2: Warehouse role can READ ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $WH" $BASE/suppliers)
[ "$CODE" = "200" ] && PASS "200 read OK" || FAIL "got $CODE"

echo ""
echo "===== TEST 3: Warehouse role cannot CREATE → 403 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $WH" -H "Content-Type: application/json" \
  -d '{"code":"'$SUP_CODE'-X","name":"X"}' $BASE/suppliers)
[ "$CODE" = "403" ] && PASS "403 forbidden" || FAIL "got $CODE"

echo ""
echo "===== TEST 4: Procurement can CREATE ====="
R=$(curl -s -X POST -H "Authorization: Bearer $PROC" -H "Content-Type: application/json" \
  -d '{"code":"'$SUP_CODE'","name":"Test Supplier","currency":"USD","paymentTerms":"NET30","leadTimeDays":10}' \
  $BASE/suppliers)
NEW_ID=$(echo "$R" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);process.stdout.write(j.id||"")})')
[ -n "$NEW_ID" ] && PASS "created $NEW_ID" || FAIL "no id returned: $R"

echo ""
echo "===== TEST 5: Duplicate code → 409 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $PROC" -H "Content-Type: application/json" \
  -d '{"code":"'$SUP_CODE'","name":"Dup"}' $BASE/suppliers)
[ "$CODE" = "409" ] && PASS "409 conflict" || FAIL "got $CODE"

echo ""
echo "===== TEST 6: Procurement cannot DELETE (admin only) → 403 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE -H "Authorization: Bearer $PROC" $BASE/suppliers/$NEW_ID)
[ "$CODE" = "403" ] && PASS "403 forbidden" || FAIL "got $CODE"

echo ""
echo "===== TEST 7: Procurement cannot CREATE category → 403 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $PROC" -H "Content-Type: application/json" \
  -d '{"code":"'$CAT_CODE'","name":"Test"}' $BASE/supplier-categories)
[ "$CODE" = "403" ] && PASS "403 forbidden" || FAIL "got $CODE"

echo ""
echo "===== TEST 8: Admin can CREATE category ====="
R=$(curl -s -X POST -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
  -d '{"code":"'$CAT_CODE'_OK","name":"Test Cat OK"}' $BASE/supplier-categories)
CAT_ID=$(echo "$R" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);process.stdout.write(j.id||"")})')
[ -n "$CAT_ID" ] && PASS "created $CAT_ID" || FAIL "no id: $R"

echo ""
echo "===== TEST 9: Add primary contact ====="
R=$(curl -s -X POST -H "Authorization: Bearer $PROC" -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@test.example","isPrimary":true}' \
  $BASE/suppliers/$NEW_ID/contacts)
C1_ID=$(echo "$R" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);process.stdout.write(j.id||"")})')
[ -n "$C1_ID" ] && PASS "contact 1 created" || FAIL "no id: $R"

echo ""
echo "===== TEST 10: Adding second primary demotes the first ====="
R=$(curl -s -X POST -H "Authorization: Bearer $PROC" -H "Content-Type: application/json" \
  -d '{"name":"Bob","email":"bob@test.example","isPrimary":true}' \
  $BASE/suppliers/$NEW_ID/contacts)
C2_ID=$(echo "$R" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);process.stdout.write(j.id||"")})')
LIST=$(curl -s -H "Authorization: Bearer $PROC" $BASE/suppliers/$NEW_ID/contacts)
PRIMARY_COUNT=$(echo "$LIST" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let a=JSON.parse(d);console.log(a.filter(c=>c.isPrimary).length)})')
[ "$PRIMARY_COUNT" = "1" ] && PASS "exactly 1 primary" || FAIL "got $PRIMARY_COUNT primaries"

echo ""
echo "===== TEST 11: Document upload — bad mime → 400 ====="
echo "evil" > /tmp/sup-evil.exe
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $PROC" \
  -F "file=@/tmp/sup-evil.exe" -F "category=CONTRACT" $BASE/suppliers/$NEW_ID/documents)
[ "$CODE" = "400" ] && PASS "400 bad mime" || FAIL "got $CODE"

echo ""
echo "===== TEST 12: Document upload — valid PDF → 201 + downloadable ====="
echo "%PDF-1.4 fake" > /tmp/sup-test.pdf
R=$(curl -s -X POST -H "Authorization: Bearer $PROC" \
  -F "file=@/tmp/sup-test.pdf;type=application/pdf" \
  -F "category=CONTRACT" -F "title=Test contract" \
  $BASE/suppliers/$NEW_ID/documents)
DOC_ID=$(echo "$R" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);process.stdout.write(j.id||"")})')
[ -n "$DOC_ID" ] && PASS "uploaded $DOC_ID" || FAIL "no id: $R"

DLCODE=$(curl -s -o /tmp/sup-dl.pdf -w "%{http_code}" -H "Authorization: Bearer $PROC" $BASE/suppliers/documents/$DOC_ID/download)
[ "$DLCODE" = "200" ] && PASS "downloaded 200" || FAIL "got $DLCODE"

echo ""
echo "===== TEST 13: Manual scorecard upsert ====="
R=$(curl -s -X POST -H "Authorization: Bearer $PROC" -H "Content-Type: application/json" \
  -d '{"periodStart":"2025-01-01","periodEnd":"2025-03-31","onTimeRate":0.95,"fillRate":0.97,"defectRate":0.01}' \
  $BASE/suppliers/$NEW_ID/performance)
SCORE=$(echo "$R" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);console.log(j.overallScore||"")})')
[ -n "$SCORE" ] && PASS "score computed: $SCORE" || FAIL "no score: $R"

echo ""
echo "===== TEST 14: Recompute returns no_data scaffold ====="
R=$(curl -s -X POST -H "Authorization: Bearer $PROC" $BASE/suppliers/$NEW_ID/performance/recompute)
STATUS=$(echo "$R" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);console.log(j.status||"")})')
[ "$STATUS" = "no_data" ] && PASS "scaffold path active" || FAIL "got '$STATUS': $R"

echo ""
echo "===== TEST 15: Approval status transition is audited ====="
curl -s -X POST -H "Authorization: Bearer $PROC" -H "Content-Type: application/json" \
  -d '{"status":"APPROVED","reason":"smoke test"}' $BASE/suppliers/$NEW_ID/approval > /dev/null
ACT=$(curl -s -H "Authorization: Bearer $PROC" "$BASE/suppliers/$NEW_ID/activity?limit=20")
echo "$ACT" | grep -q "SUPPLIER_STATUS_CHANGED" && PASS "audit event present" || FAIL "no event: $ACT"

echo ""
echo "===== TEST 16: Admin can DELETE supplier ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE -H "Authorization: Bearer $ADMIN" $BASE/suppliers/$NEW_ID)
[ "$CODE" = "200" -o "$CODE" = "204" ] && PASS "deleted ($CODE)" || FAIL "got $CODE"

echo ""
echo "===== Cleanup ====="
curl -s -X DELETE -H "Authorization: Bearer $ADMIN" $BASE/supplier-categories/$CAT_ID > /dev/null && PASS "category cleaned"
rm -f /tmp/sup-evil.exe /tmp/sup-test.pdf /tmp/sup-dl.pdf

echo ""
[ -z "$FAILED" ] && echo "🎉 ALL SUPPLIERS TESTS PASSED" || { echo "❌ SOME TESTS FAILED"; exit 1; }
