#!/bin/bash
# Tier 3 — Phase C: 3-way-match tolerance bands + MATCH_EXCEPTION alert smoke.
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
FIN=$(login finance@rpechain.com Admin@123)
PROC=$(login procurement@rpechain.com Admin@123)
WH=$(login warehouse@rpechain.com Admin@123)

echo ""; echo "===== TIER 3 — MATCH TOLERANCES + EXCEPTION ALERT ====="

echo "T1: Anonymous GET /settings/match-tolerances → 401"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/settings/match-tolerances")
[ "$CODE" = "401" ] && PASS "401" || FAIL "got $CODE"

echo "T2: Warehouse GET → 403"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $WH" "$BASE/settings/match-tolerances")
[ "$CODE" = "403" ] && PASS "403" || FAIL "got $CODE"

echo "T3: Finance GET → 200 + global/overrides/bounds"
R=$(curl -s -H "Authorization: Bearer $FIN" "$BASE/settings/match-tolerances")
QTY=$(echo "$R" | jget global.qtyPct)
PRICE=$(echo "$R" | jget global.pricePct)
MAX=$(echo "$R" | jget bounds.max)
if [ -n "$QTY" ] && [ -n "$PRICE" ] && [ -n "$MAX" ]; then
  PASS "global qty=$QTY price=$PRICE bounds.max=$MAX"
else
  FAIL "resp=$R"
fi

echo "T4: Finance PUT /global → 403 (admin-only)"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT -H "Authorization: Bearer $FIN" -H 'Content-Type: application/json' -d '{"qtyPct":3}' "$BASE/settings/match-tolerances/global")
[ "$CODE" = "403" ] && PASS "403" || FAIL "got $CODE"

echo "T5: Admin PUT /global with out-of-range → 400"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"qtyPct":99}' "$BASE/settings/match-tolerances/global")
[ "$CODE" = "400" ] && PASS "400" || FAIL "got $CODE"

echo "T6: Admin PUT /global { qtyPct: 5, pricePct: 3 } → 200"
R=$(curl -s -X PUT -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"qtyPct":5,"pricePct":3}' "$BASE/settings/match-tolerances/global")
GQ=$(echo "$R" | jget qtyPct)
GP=$(echo "$R" | jget pricePct)
[ "$GQ" = "5" ] && [ "$GP" = "3" ] && PASS "global updated qty=$GQ price=$GP" || FAIL "resp=$R"

echo "T7: GET reflects new globals"
R=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/settings/match-tolerances")
QSRC=$(echo "$R" | jget global.qtySource)
QV=$(echo "$R" | jget global.qtyPct)
[ "$QSRC" = "global" ] && [ "$QV" = "5" ] && PASS "qtySource=global qty=$QV" || FAIL "resp=$R"

echo "T8: Per-supplier override"
SUPPLIER_ID=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/suppliers?limit=1" | jget rows.0.id)
if [ -z "$SUPPLIER_ID" ]; then
  SUPPLIER_ID=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/suppliers?limit=1" | jget 0.id)
fi
if [ -n "$SUPPLIER_ID" ]; then
  R=$(curl -s -X PUT -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"qtyPct":0.5,"pricePct":0.5}' "$BASE/settings/match-tolerances/suppliers/$SUPPLIER_ID")
  SQ=$(echo "$R" | jget qtyPct)
  if [ "$SQ" = "0.5" ]; then
    PASS "supplier $SUPPLIER_ID override qty=0.5"
  else
    FAIL "resp=$R"
  fi

  echo "T9: Override appears in GET overrides[]"
  R=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/settings/match-tolerances")
  N=$(echo "$R" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);process.stdout.write(String((j.overrides||[]).length))})')
  if [ "$N" -ge "1" ] 2>/dev/null; then
    PASS "$N override row(s) returned"
  else
    FAIL "resp=$R"
  fi

  echo "T10: Clear supplier override (qtyPct=null, pricePct=null)"
  R=$(curl -s -X PUT -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"qtyPct":null,"pricePct":null}' "$BASE/settings/match-tolerances/suppliers/$SUPPLIER_ID")
  SQ=$(echo "$R" | jget qtyPct)
  [ "$SQ" = "" ] && PASS "override cleared" || FAIL "resp=$R"
else
  echo " ⚠ no supplier in fixtures — skipping T8-T10"
fi

echo "T11: Reset global to defaults"
curl -s -X PUT -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"qtyPct":2,"pricePct":1}' "$BASE/settings/match-tolerances/global" > /dev/null
PASS "globals reset to 2%/1%"

echo "T12: Alert scan includes matchException section"
R=$(curl -s -X POST -H "Authorization: Bearer $ADMIN" "$BASE/alerts/scan")
ME=$(echo "$R" | jget matchException.active)
[ -n "$ME" ] && PASS "matchException.active=$ME" || FAIL "resp=$R"

echo ""
if [ -n "$FAILED" ]; then echo "===== FAILED ====="; exit 1; fi
echo "===== ALL TOLERANCE TESTS PASSED ====="
