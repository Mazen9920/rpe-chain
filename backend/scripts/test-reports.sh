#!/bin/bash
# Tier 4 #15 — Custom reports + scheduled exports (v1.5.0)
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
FIN=$(login finance@rpechain.com Admin@123)
SALES=$(login sales@rpechain.com Admin@123)
WH=$(login warehouse@rpechain.com Admin@123)
RO=$(login readonly@rpechain.com Admin@123 2>/dev/null || true)
echo "Admin=${ADMIN:0:15}.. Fin=${FIN:0:15}.. Sales=${SALES:0:15}.. WH=${WH:0:15}.."

RUN=$RANDOM
FAILED=0

# ────────── 1. RBAC ──────────
echo ""
echo "===== TEST 1: Anonymous → 401 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" $BASE/reports/definitions)
[[ "$CODE" == "401" ]] && PASS "401 without token" || FAIL "expected 401, got $CODE"

echo ""
echo "===== TEST 2: SALES can list, WH can list (all roles read) ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $SALES" $BASE/reports/definitions)
[[ "$CODE" == "200" ]] && PASS "SALES can list definitions" || FAIL "got $CODE"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $WH" $BASE/reports/definitions)
[[ "$CODE" == "200" ]] && PASS "WAREHOUSE can list definitions" || FAIL "got $CODE"

echo ""
echo "===== TEST 3: WAREHOUSE cannot create schedule (FINANCE/ADMIN only) ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $WH" -H 'Content-Type: application/json' \
  -d '{"definitionId":"x","cron":"0 7 * * *","format":"PDF","recipients":["a@b.c"]}' $BASE/reports/schedules)
[[ "$CODE" == "403" ]] && PASS "WAREHOUSE blocked from /schedules POST" || FAIL "expected 403, got $CODE"

# ────────── 2. Available report keys ──────────
echo ""
echo "===== TEST 4: GET /definitions/available ====="
AVAIL=$(curl -s -H "Authorization: Bearer $ADMIN" $BASE/reports/definitions/available)
echo "$AVAIL" | grep -q "ap-aging" && PASS "ap-aging key present" || FAIL "missing ap-aging"
echo "$AVAIL" | grep -q "ar-aging" && PASS "ar-aging key present" || FAIL "missing ar-aging"
echo "$AVAIL" | grep -q "supplier-scorecards" && PASS "supplier-scorecards key present" || FAIL "missing supplier-scorecards"
echo "$AVAIL" | grep -q "sales-fulfillment" && PASS "sales-fulfillment key present" || FAIL "missing sales-fulfillment"

# ────────── 3. Ad-hoc render endpoints ──────────
echo ""
echo "===== TEST 5: Render CSV ====="
RESP=$(curl -s -o /tmp/rpt-$RUN.csv -w "HTTP=%{http_code} TYPE=%{content_type} SIZE=%{size_download}" \
  -H "Authorization: Bearer $ADMIN" "$BASE/reports/render?reportKey=ap-aging&format=csv")
echo "$RESP"
echo "$RESP" | grep -q "HTTP=200" && PASS "CSV 200" || FAIL "CSV not 200"
echo "$RESP" | grep -q "TYPE=text/csv" && PASS "Content-Type text/csv" || FAIL "not csv"
head -1 /tmp/rpt-$RUN.csv | grep -q "Supplier Code" && PASS "CSV header present" || FAIL "CSV header missing"

echo ""
echo "===== TEST 6: Render XLSX ====="
RESP=$(curl -s -o /tmp/rpt-$RUN.xlsx -w "HTTP=%{http_code} TYPE=%{content_type} SIZE=%{size_download}" \
  -H "Authorization: Bearer $ADMIN" "$BASE/reports/render?reportKey=ar-aging&format=xlsx")
echo "$RESP"
echo "$RESP" | grep -q "HTTP=200" && PASS "XLSX 200" || FAIL "XLSX not 200"
echo "$RESP" | grep -q "spreadsheetml" && PASS "Content-Type XLSX" || FAIL "not xlsx"
file /tmp/rpt-$RUN.xlsx | grep -q "Excel" && PASS "XLSX magic bytes ok" || FAIL "XLSX not recognized"

echo ""
echo "===== TEST 7: Render PDF ====="
RESP=$(curl -s -o /tmp/rpt-$RUN.pdf -w "HTTP=%{http_code} TYPE=%{content_type} SIZE=%{size_download}" \
  -H "Authorization: Bearer $ADMIN" "$BASE/reports/render?reportKey=sales-fulfillment&format=pdf")
echo "$RESP"
echo "$RESP" | grep -q "HTTP=200" && PASS "PDF 200" || FAIL "PDF not 200"
echo "$RESP" | grep -q "TYPE=application/pdf" && PASS "Content-Type PDF" || FAIL "not pdf"
file /tmp/rpt-$RUN.pdf | grep -q "PDF document" && PASS "PDF magic bytes ok" || FAIL "PDF not recognized"

echo ""
echo "===== TEST 8: Invalid reportKey → 400 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $ADMIN" "$BASE/reports/render?reportKey=nope&format=csv")
[[ "$CODE" == "400" ]] && PASS "invalid key 400" || FAIL "got $CODE"

echo ""
echo "===== TEST 9: Missing reportKey → 400 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $ADMIN" "$BASE/reports/render?format=csv")
[[ "$CODE" == "400" ]] && PASS "missing key 400" || FAIL "got $CODE"

echo ""
echo "===== TEST 10: Invalid format → 400 ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $ADMIN" "$BASE/reports/render?reportKey=ap-aging&format=html")
[[ "$CODE" == "400" ]] && PASS "invalid format 400" || FAIL "got $CODE"

# ────────── 4. Definition CRUD ──────────
echo ""
echo "===== TEST 11: Create definition (shared) ====="
DEF=$(curl -s -X POST -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Test Report $RUN\",\"reportKey\":\"ap-aging\",\"params\":{},\"isShared\":true}" \
  $BASE/reports/definitions)
DEF_ID=$(echo "$DEF" | jget id)
[[ -n "$DEF_ID" ]] && PASS "Created def id=$DEF_ID" || { FAIL "no id"; echo "$DEF"; }

echo ""
echo "===== TEST 12: SALES cannot create shared (SHARED_FORBIDDEN) ====="
RESP=$(curl -s -X POST -H "Authorization: Bearer $SALES" -H 'Content-Type: application/json' \
  -d "{\"name\":\"x$RUN\",\"reportKey\":\"sales-fulfillment\",\"isShared\":true}" \
  $BASE/reports/definitions)
echo "$RESP" | grep -q "SHARED_FORBIDDEN" && PASS "SALES blocked from shared" || FAIL "expected SHARED_FORBIDDEN: $RESP"

echo ""
echo "===== TEST 13: SALES can create private definition ====="
SALES_DEF=$(curl -s -X POST -H "Authorization: Bearer $SALES" -H 'Content-Type: application/json' \
  -d "{\"name\":\"sales-priv-$RUN\",\"reportKey\":\"sales-fulfillment\",\"isShared\":false}" \
  $BASE/reports/definitions)
SALES_DEF_ID=$(echo "$SALES_DEF" | jget id)
[[ -n "$SALES_DEF_ID" ]] && PASS "Sales private def id=$SALES_DEF_ID" || FAIL "no id: $SALES_DEF"

echo ""
echo "===== TEST 14: WAREHOUSE doesn't see SALES private def ====="
LIST=$(curl -s -H "Authorization: Bearer $WH" $BASE/reports/definitions)
echo "$LIST" | grep -q "$SALES_DEF_ID" && FAIL "WH leaked private def" || PASS "WH does not see private def"
echo "$LIST" | grep -q "$DEF_ID" && PASS "WH sees shared def" || FAIL "WH should see shared"

echo ""
echo "===== TEST 15: Render saved definition (CSV) ====="
RESP=$(curl -s -o /tmp/saved-$RUN.csv -w "HTTP=%{http_code} TYPE=%{content_type}" \
  -H "Authorization: Bearer $ADMIN" "$BASE/reports/render/definition/$DEF_ID?format=csv")
echo "$RESP"
echo "$RESP" | grep -q "HTTP=200" && PASS "Saved render 200" || FAIL "got $RESP"
head -1 /tmp/saved-$RUN.csv | grep -q "Supplier Code" && PASS "Saved CSV header ok" || FAIL "header missing"

echo ""
echo "===== TEST 16: PATCH definition (rename) ====="
RESP=$(curl -s -X PATCH -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"name":"Renamed"}' $BASE/reports/definitions/$DEF_ID)
echo "$RESP" | grep -q '"name":"Renamed"' && PASS "Renamed" || FAIL "rename failed: $RESP"

# ────────── 5. Schedule CRUD ──────────
echo ""
echo "===== TEST 17: Create schedule ====="
SCHED=$(curl -s -X POST -H "Authorization: Bearer $FIN" -H 'Content-Type: application/json' \
  -d "{\"definitionId\":\"$DEF_ID\",\"cron\":\"0 7 * * *\",\"format\":\"PDF\",\"recipients\":[\"finance@rpechain.com\"]}" \
  $BASE/reports/schedules)
SCHED_ID=$(echo "$SCHED" | jget id)
[[ -n "$SCHED_ID" ]] && PASS "Created schedule id=$SCHED_ID" || { FAIL "no id"; echo "$SCHED"; }
NEXT=$(echo "$SCHED" | jget nextRunAt)
[[ -n "$NEXT" ]] && PASS "nextRunAt populated: $NEXT" || FAIL "nextRunAt missing"

echo ""
echo "===== TEST 18: Invalid cron → 400 CRON_INVALID ====="
RESP=$(curl -s -X POST -H "Authorization: Bearer $FIN" -H 'Content-Type: application/json' \
  -d "{\"definitionId\":\"$DEF_ID\",\"cron\":\"not a cron\",\"format\":\"PDF\",\"recipients\":[\"a@b.c\"]}" \
  $BASE/reports/schedules)
echo "$RESP" | grep -q "CRON_INVALID" && PASS "Invalid cron rejected" || FAIL "expected CRON_INVALID: $RESP"

echo ""
echo "===== TEST 19: Invalid format → FORMAT_INVALID ====="
RESP=$(curl -s -X POST -H "Authorization: Bearer $FIN" -H 'Content-Type: application/json' \
  -d "{\"definitionId\":\"$DEF_ID\",\"cron\":\"0 7 * * *\",\"format\":\"DOCX\",\"recipients\":[\"a@b.c\"]}" \
  $BASE/reports/schedules)
echo "$RESP" | grep -q "FORMAT_INVALID" && PASS "Invalid format rejected" || FAIL "expected FORMAT_INVALID: $RESP"

echo ""
echo "===== TEST 20: Invalid email → RECIPIENTS_INVALID ====="
RESP=$(curl -s -X POST -H "Authorization: Bearer $FIN" -H 'Content-Type: application/json' \
  -d "{\"definitionId\":\"$DEF_ID\",\"cron\":\"0 7 * * *\",\"format\":\"PDF\",\"recipients\":[\"not-an-email\"]}" \
  $BASE/reports/schedules)
echo "$RESP" | grep -q "RECIPIENTS_INVALID" && PASS "Bad email rejected" || FAIL "expected RECIPIENTS_INVALID: $RESP"

echo ""
echo "===== TEST 21: Run-now creates outbox row ====="
RESP=$(curl -s -X POST -H "Authorization: Bearer $FIN" $BASE/reports/schedules/$SCHED_ID/run-now)
OBX=$(echo "$RESP" | jget outboxId)
[[ -n "$OBX" ]] && PASS "Run-now → outboxId=$OBX" || FAIL "no outboxId: $RESP"

echo ""
echo "===== TEST 22: Process outbox → SCHEDULED_REPORT handler enqueues email ====="
node -e "
(async()=>{
  require('./src/services/integrations/email/handler');
  require('./src/services/integrations/scheduledReport/handler');
  const outbox=require('./src/services/outbox.service');
  // First pass: SCHEDULED_REPORT row runs, enqueues email row.
  let r1=await outbox.processBatch({limit:5});
  let r2=await outbox.processBatch({limit:5});
  console.log('pass1='+JSON.stringify(r1)+' pass2='+JSON.stringify(r2));
  const prisma=require('./src/lib/prisma');
  const sched=await prisma.integrationOutbox.findMany({where:{target:'SCHEDULED_REPORT',action:'RENDER_AND_EMAIL'},orderBy:{createdAt:'desc'},take:1});
  const email=await prisma.integrationOutbox.findMany({where:{target:'email',action:'SCHEDULED_REPORT'},orderBy:{createdAt:'desc'},take:1});
  console.log('SCHEDULED_REPORT status='+(sched[0]&&sched[0].status));
  console.log('email row status='+(email[0]&&email[0].status));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
" > /tmp/obx-$RUN.log 2>&1
cat /tmp/obx-$RUN.log
grep -q "SCHEDULED_REPORT status=SENT" /tmp/obx-$RUN.log && PASS "SCHEDULED_REPORT row processed" || FAIL "SCHEDULED_REPORT not SENT"
grep -q "email row status=SENT" /tmp/obx-$RUN.log && PASS "email outbox row enqueued + sent (noop)" || FAIL "email row not SENT"

echo ""
echo "===== TEST 23: Cleanup — delete schedule & definitions ====="
curl -s -X DELETE -H "Authorization: Bearer $FIN" $BASE/reports/schedules/$SCHED_ID -o /dev/null -w "del-sched=%{http_code}\n"
curl -s -X DELETE -H "Authorization: Bearer $ADMIN" $BASE/reports/definitions/$DEF_ID -o /dev/null -w "del-def=%{http_code}\n"
curl -s -X DELETE -H "Authorization: Bearer $SALES" $BASE/reports/definitions/$SALES_DEF_ID -o /dev/null -w "del-sales-def=%{http_code}\n"
PASS "Cleanup ran"

echo ""
if [[ "$FAILED" == "1" ]]; then
  echo "TIER 4 #15 — Custom Reports: SOME TESTS FAILED"
  exit 1
fi
echo "TIER 4 #15 — Custom Reports: ALL TESTS PASSED ✓"
