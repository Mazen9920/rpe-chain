#!/bin/bash
# Tier 3 — Phase D: FX rates + conversion smoke.
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
WH=$(login warehouse@rpechain.com Admin@123)

TODAY=$(date -u +%Y-%m-%dT00:00:00Z)
T30=$(date -u -v-30d +%Y-%m-%dT00:00:00Z 2>/dev/null || date -u -d '30 days ago' +%Y-%m-%dT00:00:00Z)

echo ""; echo "===== TIER 3 — FX RATES + CONVERSION ====="

echo "T1: Anonymous POST /fx/rates → 401"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/fx/rates")
[ "$CODE" = "401" ] && PASS "401" || FAIL "got $CODE"

echo "T2: Warehouse POST /fx/rates → 403"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $WH" -H 'Content-Type: application/json' -d '{"baseCurrency":"USD","quoteCurrency":"EGP","rate":50,"effectiveAt":"'"$TODAY"'"}' "$BASE/fx/rates")
[ "$CODE" = "403" ] && PASS "403" || FAIL "got $CODE"

echo "T3: Finance POST today USD→EGP=50 → 201"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $FIN" -H 'Content-Type: application/json' -d '{"baseCurrency":"USD","quoteCurrency":"EGP","rate":50,"effectiveAt":"'"$TODAY"'"}' "$BASE/fx/rates")
[ "$CODE" = "201" ] && PASS "201" || FAIL "got $CODE"

echo "T4: Admin POST 30d-ago USD→EGP=48 → 201"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"baseCurrency":"USD","quoteCurrency":"EGP","rate":48,"effectiveAt":"'"$T30"'"}' "$BASE/fx/rates")
[ "$CODE" = "201" ] && PASS "201" || FAIL "got $CODE"

echo "T5: GET /fx/convert?amount=1&from=USD&to=EGP&at=today → 50"
R=$(curl -s -H "Authorization: Bearer $FIN" "$BASE/fx/convert?amount=1&from=USD&to=EGP&at=$TODAY")
RESULT=$(echo "$R" | jget result)
[ "$RESULT" = "50" ] && PASS "result=$RESULT" || FAIL "resp=$R"

echo "T6: GET /fx/convert?at=30d-ago → 48"
R=$(curl -s -H "Authorization: Bearer $FIN" "$BASE/fx/convert?amount=1&from=USD&to=EGP&at=$T30")
RESULT=$(echo "$R" | jget result)
[ "$RESULT" = "48" ] && PASS "result=$RESULT" || FAIL "resp=$R"

echo "T7: Inverse conversion EGP→USD uses 1/rate"
R=$(curl -s -H "Authorization: Bearer $FIN" "$BASE/fx/convert?amount=100&from=EGP&to=USD&at=$TODAY")
RATE=$(echo "$R" | jget rate)
RESULT=$(echo "$R" | jget result)
# 1/50 = 0.02, so 100 EGP → 2 USD
if [ -n "$RATE" ] && [ -n "$RESULT" ]; then
  PASS "rate=$RATE result=$RESULT"
else
  FAIL "resp=$R"
fi

echo "T8: Missing-rate path returns 400 with FX_RATE_NOT_FOUND"
R=$(curl -s -H "Authorization: Bearer $FIN" "$BASE/fx/convert?amount=1&from=USD&to=XYZ&at=$TODAY")
CODE=$(echo "$R" | jget code)
[ "$CODE" = "FX_RATE_NOT_FOUND" ] && PASS "code=$CODE" || FAIL "resp=$R"

echo "T9: Same-currency conversion returns 1.0 / no rate lookup"
R=$(curl -s -H "Authorization: Bearer $FIN" "$BASE/fx/convert?amount=42&from=USD&to=USD")
RESULT=$(echo "$R" | jget result)
[ "$RESULT" = "42" ] && PASS "result=$RESULT" || FAIL "resp=$R"

echo "T10: Invalid 3-letter code rejected on POST → 400"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $FIN" -H 'Content-Type: application/json' -d '{"baseCurrency":"US","quoteCurrency":"EGP","rate":50,"effectiveAt":"'"$TODAY"'"}' "$BASE/fx/rates")
[ "$CODE" = "400" ] && PASS "400" || FAIL "got $CODE"

echo "T11: Same base/quote rejected → 400"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $FIN" -H 'Content-Type: application/json' -d '{"baseCurrency":"USD","quoteCurrency":"USD","rate":1,"effectiveAt":"'"$TODAY"'"}' "$BASE/fx/rates")
[ "$CODE" = "400" ] && PASS "400" || FAIL "got $CODE"

echo "T12: GET /fx/rates list returns rows"
R=$(curl -s -H "Authorization: Bearer $FIN" "$BASE/fx/rates?base=USD&quote=EGP&limit=10")
TOTAL=$(echo "$R" | jget total)
if [ -n "$TOTAL" ] && [ "$TOTAL" -ge 2 ]; then
  PASS "total=$TOTAL"
else
  FAIL "resp=$R"
fi

echo "T13: Dashboard summary with reportingCurrency=EGP echoes back"
R=$(curl -s -H "Authorization: Bearer $FIN" "$BASE/dashboard/summary?reportingCurrency=EGP")
RC=$(echo "$R" | jget reportingCurrency)
[ "$RC" = "EGP" ] && PASS "reportingCurrency=$RC" || FAIL "resp=$R"

echo ""
if [ -n "$FAILED" ]; then echo "FX SUITE: FAIL"; exit 1; else echo "FX SUITE: PASS"; fi
