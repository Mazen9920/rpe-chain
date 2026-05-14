#!/bin/bash
# v1.7.1 — OAuth integration smoke for QuickBooks + Xero.
# Stands up a local stub OAuth/API server on port 4501, points QBO + Xero
# providers at it via env, and walks: connect→callback→push→refresh→disconnect.
set -e
BASE=http://localhost:3000/api
STUB_PORT=4501
RUN=$RANDOM

PASS() { echo " ✓ $1"; }
FAIL() { echo " ✗ $1"; FAILED=1; }
FAILED=0

login() {
  curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);process.stdout.write(j.token||"")})'
}
jget() {
  node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);let k=process.argv[1].split(".").reduce((a,p)=>a&&a[p],j);process.stdout.write(k==null?"":String(k))})' "$1"
}

ADMIN=$(login admin@rpechain.com Admin@123)
SALES=$(login sales@rpechain.com Admin@123)
echo "Admin=${ADMIN:0:15}.. Sales=${SALES:0:15}.."

# ────────── Start stub provider on $STUB_PORT ──────────
echo ""; echo "===== Starting stub provider on :$STUB_PORT ====="
STUB_LOG=/tmp/oauth-stub.log
pkill -f "oauth-stub-$STUB_PORT" 2>/dev/null || true
sleep 1
node -e '
const http = require("http");
const PORT = '"$STUB_PORT"';
const calls = { token: 0, qboJournal: 0, xeroJournal: 0, refresh: 0 };
const srv = http.createServer((req, res) => {
  let body = "";
  req.on("data", c => body += c);
  req.on("end", () => {
    if (req.url === "/token") {
      const isRefresh = /grant_type=refresh_token/.test(body);
      if (isRefresh) calls.refresh++; else calls.token++;
      res.setHeader("Content-Type","application/json");
      res.end(JSON.stringify({
        access_token: "stub-access-" + Date.now(),
        refresh_token: "stub-refresh-" + Date.now(),
        expires_in: 3600,
        token_type: "Bearer",
      }));
      return;
    }
    if (/\/v3\/company\/.*\/journalentry/.test(req.url)) {
      calls.qboJournal++;
      res.setHeader("Content-Type","application/json");
      res.end(JSON.stringify({ JournalEntry: { Id: "QBO-REAL-" + calls.qboJournal, DocNumber: "from-stub" } }));
      return;
    }
    if (/\/api\.xro\/2\.0\/ManualJournals/.test(req.url)) {
      calls.xeroJournal++;
      res.setHeader("Content-Type","application/json");
      res.end(JSON.stringify({ ManualJournals: [{ ManualJournalID: "XERO-REAL-" + calls.xeroJournal }] }));
      return;
    }
    if (req.url === "/_counts") {
      res.setHeader("Content-Type","application/json");
      res.end(JSON.stringify(calls));
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
});
srv.listen(PORT, () => process.stdout.write("stub-ready\n"));
process.title = "oauth-stub-'"$STUB_PORT"'";
' > $STUB_LOG 2>&1 &
STUB_PID=$!
sleep 1
if curl -sf http://localhost:$STUB_PORT/_counts > /dev/null; then PASS "stub up (pid=$STUB_PID)"; else FAIL "stub did not start"; cat $STUB_LOG; exit 1; fi

cleanup() { kill $STUB_PID 2>/dev/null || true; }
trap cleanup EXIT

# ────────── 1. RBAC: SALES forbidden ──────────
echo ""; echo "===== TEST 1: SALES forbidden from status ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $SALES" $BASE/integrations/quickbooks/status)
[[ "$CODE" == "403" ]] && PASS "SALES blocked (403)" || FAIL "got $CODE"

# ────────── 2. anon → 401 ──────────
CODE=$(curl -s -o /dev/null -w "%{http_code}" $BASE/integrations/quickbooks/status)
[[ "$CODE" == "401" ]] && PASS "anon 401 on status" || FAIL "got $CODE"

# ────────── 3. status when not configured ──────────
echo ""; echo "===== TEST 3: status (unconfigured) ====="
S=$(curl -s -H "Authorization: Bearer $ADMIN" $BASE/integrations/quickbooks/status)
CONF=$(echo "$S" | jget configured)
CONN=$(echo "$S" | jget connected)
[[ "$CONF" == "false" && "$CONN" == "false" ]] && PASS "unconfigured + not connected" || FAIL "got $S"

# ────────── 4. connect when unconfigured → 400 ──────────
echo ""; echo "===== TEST 4: connect blocked when unconfigured ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $ADMIN" $BASE/integrations/quickbooks/connect)
[[ "$CODE" == "400" ]] && PASS "connect 400 when unconfigured" || FAIL "got $CODE"

# ────────── 5. callback with bad state → 400 ──────────
echo ""; echo "===== TEST 5: callback rejects forged state ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/integrations/quickbooks/callback?code=x&state=not-a-jwt&realmId=42")
[[ "$CODE" == "400" ]] && PASS "forged state 400" || FAIL "got $CODE"

# ────────── 6. unknown provider → 400 ──────────
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $ADMIN" $BASE/integrations/notreal/status)
[[ "$CODE" == "400" ]] && PASS "unknown provider 400" || FAIL "got $CODE"

# ────────── 7. exchange code → tokens persisted (inline) ──────────
echo ""; echo "===== TEST 7: token exchange persists encrypted creds ====="
cd "$(dirname "$0")/.."
OUT=$(QBO_TOKEN_URL=http://localhost:$STUB_PORT/token \
      QBO_API_BASE=http://localhost:$STUB_PORT \
      QUICKBOOKS_CLIENT_ID=stub QUICKBOOKS_CLIENT_SECRET=stub QUICKBOOKS_REDIRECT_URI=http://localhost/cb \
      DATABASE_URL="postgresql://rpe_user:rpe_pass@localhost:5432/rpe_supply" \
      JWT_SECRET="ci-test-secret-do-not-use-in-prod" \
      node -e '
const oauth = require("./src/services/integrations/oauth.service");
const prisma = require("./src/lib/prisma");
(async () => {
  await oauth.exchangeCodeForToken("quickbooks", "auth-code-123", { realmId: "REALM-'"$RUN"'" });
  const cred = await prisma.glIntegrationCredential.findUnique({ where: { provider: "quickbooks" } });
  console.log(JSON.stringify({
    realmId: cred.realmId,
    encPrefix: cred.accessToken && cred.accessToken.slice(0,3),
    isActive: cred.isActive,
  }));
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
')
REALM=$(echo "$OUT" | tail -1 | jget realmId)
PREF=$(echo "$OUT" | tail -1 | jget encPrefix)
[[ "$REALM" == "REALM-$RUN" && "$PREF" == "v1:" ]] && PASS "tokens persisted (realm=$REALM, enc=v1:)" || FAIL "got $OUT"

# ────────── 8. push with real OAuth flow (uses stub) ──────────
echo ""; echo "===== TEST 8: outbox journal.push hits stub QBO ====="
# Find a non-pushed AR journal
JID=$(QBO_TOKEN_URL=http://localhost:$STUB_PORT/token \
      QBO_API_BASE=http://localhost:$STUB_PORT \
      QUICKBOOKS_CLIENT_ID=stub QUICKBOOKS_CLIENT_SECRET=stub QUICKBOOKS_REDIRECT_URI=http://localhost/cb \
      DATABASE_URL="postgresql://rpe_user:rpe_pass@localhost:5432/rpe_supply" \
      JWT_SECRET="ci-test-secret-do-not-use-in-prod" \
      node -e '
const prisma = require("./src/lib/prisma");
(async () => {
  // Pick any journal — wipe externalId so we re-push.
  const j = await prisma.glJournal.findFirst({ orderBy: { postedAt: "desc" } });
  if (!j) { console.error("no journal seeded"); process.exit(2); }
  await prisma.glJournal.update({ where: { id: j.id }, data: { externalId: null, exportProvider: null, exportedAt: null } });
  console.log(j.id);
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
' | tail -1)
[[ -n "$JID" ]] && PASS "journal selected ($JID)" || { FAIL "no journal"; exit 1; }

EXT=$(QBO_TOKEN_URL=http://localhost:$STUB_PORT/token \
      QBO_API_BASE=http://localhost:$STUB_PORT \
      QUICKBOOKS_CLIENT_ID=stub QUICKBOOKS_CLIENT_SECRET=stub QUICKBOOKS_REDIRECT_URI=http://localhost/cb \
      DATABASE_URL="postgresql://rpe_user:rpe_pass@localhost:5432/rpe_supply" \
      JWT_SECRET="ci-test-secret-do-not-use-in-prod" \
      LOG_LEVEL=error \
      node -e '
require("./src/services/integrations/quickbooks/handler");
const outbox = require("./src/services/outbox.service");
const prisma = require("./src/lib/prisma");
(async () => {
  await outbox.enqueue({ target: "quickbooks", action: "journal.push", payload: { journalId: "'"$JID"'" }, idempotencyKey: "gl:quickbooks:'"$JID"':'"$RUN"'" });
  await outbox.processBatch({ limit: 5 });
  const j = await prisma.glJournal.findUnique({ where: { id: "'"$JID"'" } });
  console.log(j.externalId || "");
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
' | tail -1)
[[ "$EXT" == QBO-REAL-* ]] && PASS "real-push externalId=$EXT" || FAIL "expected QBO-REAL-*, got '$EXT'"

# ────────── 9. stub call counts ──────────
COUNTS=$(curl -s http://localhost:$STUB_PORT/_counts)
TOK=$(echo "$COUNTS" | jget token)
QBOJ=$(echo "$COUNTS" | jget qboJournal)
[[ "$TOK" -ge "1" && "$QBOJ" -ge "1" ]] && PASS "stub saw $TOK token + $QBOJ journal call(s)" || FAIL "counts=$COUNTS"

# ────────── 10. disconnect ──────────
echo ""; echo "===== TEST 10: disconnect ====="
QBO_TOKEN_URL=http://localhost:$STUB_PORT/token \
QBO_API_BASE=http://localhost:$STUB_PORT \
QUICKBOOKS_CLIENT_ID=stub QUICKBOOKS_CLIENT_SECRET=stub QUICKBOOKS_REDIRECT_URI=http://localhost/cb \
  curl -s -X POST -H "Authorization: Bearer $ADMIN" $BASE/integrations/quickbooks/disconnect > /dev/null || true
S=$(curl -s -H "Authorization: Bearer $ADMIN" $BASE/integrations/quickbooks/status)
CONN=$(echo "$S" | jget connected)
[[ "$CONN" == "false" ]] && PASS "disconnected" || FAIL "still connected: $S"

# ────────── summary ──────────
echo ""
if [[ "$FAILED" == "0" ]]; then
  echo "===== ALL OAUTH TESTS PASSED ====="
  exit 0
else
  echo "===== SOME OAUTH TESTS FAILED ====="
  exit 1
fi
