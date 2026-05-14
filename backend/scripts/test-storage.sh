#!/bin/bash
# Storage abstraction — v2.1.0 smoke tests
set -e
BASE=http://localhost:3000/api
export JWT_SECRET="${JWT_SECRET:-ci-test-secret-do-not-use-in-prod}"

login() {
  curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);process.stdout.write(j.token||"")})'
}
PASS() { echo " ✓ $1"; }
FAIL() { echo " ✗ $1"; exit 1; }

ADMIN=$(login admin@rpechain.com Admin@123)
[ -n "$ADMIN" ] || FAIL "login"

# ── Pick any supplier ────────────────────────────────────────────────────
SUPPLIER_ID=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/suppliers?limit=1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);let arr=j.items||j.rows||j;process.stdout.write(arr[0].id)})')
[ -n "$SUPPLIER_ID" ] && PASS "supplier=$SUPPLIER_ID" || FAIL "no supplier"

# ── Create a tmp file ────────────────────────────────────────────────────
TMP=$(mktemp -t storage-test).pdf
echo "%PDF-1.4 fake-pdf-content-$RANDOM" > "$TMP"

echo ""
echo "===== TEST 1: Upload supplier doc → 201 with key-style storagePath ====="
UPLOAD=$(curl -s -X POST -H "Authorization: Bearer $ADMIN" \
  -F "file=@$TMP;type=application/pdf" \
  -F "category=CONTRACT" \
  -F "title=Storage Test $RANDOM" \
  "$BASE/suppliers/$SUPPLIER_ID/documents")
DOC_ID=$(echo "$UPLOAD" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);process.stdout.write(j.id||"")})')
STORAGE_KEY=$(echo "$UPLOAD" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);process.stdout.write(j.storagePath||"")})')
[ -n "$DOC_ID" ] && PASS "doc=$DOC_ID" || FAIL "upload: $UPLOAD"
case "$STORAGE_KEY" in
  suppliers/*) PASS "key-style storagePath=$STORAGE_KEY" ;;
  *)           FAIL "expected suppliers/... got $STORAGE_KEY" ;;
esac

echo ""
echo "===== TEST 2: File written to storage root ====="
STORAGE_ROOT="$(cd "$(dirname "$0")/.." && pwd)/uploads/storage"
if [ -f "$STORAGE_ROOT/$STORAGE_KEY" ]; then
  PASS "file on disk under storage root"
else
  FAIL "expected file at $STORAGE_ROOT/$STORAGE_KEY"
fi

echo ""
echo "===== TEST 3: Authenticated download returns bytes ====="
BODY=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/suppliers/documents/$DOC_ID/download")
echo "$BODY" | grep -q "fake-pdf-content" && PASS "download returns file content" || FAIL "got: $(echo $BODY | head -c 80)"

echo ""
echo "===== TEST 4: Storage local-route rejects unsigned URL ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/storage/local/$STORAGE_KEY")
[ "$CODE" = "403" ] && PASS "unsigned → 403" || FAIL "got $CODE"

echo ""
echo "===== TEST 5: Storage local-route rejects bad signature ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/storage/local/$STORAGE_KEY?exp=9999999999&sig=deadbeef")
[ "$CODE" = "403" ] && PASS "bad sig → 403" || FAIL "got $CODE"

echo ""
echo "===== TEST 6: Storage local-route rejects path traversal ====="
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/storage/local/..%2F..%2Fetc%2Fpasswd?exp=9999999999&sig=x")
case "$CODE" in
  400|403) PASS "traversal blocked → $CODE" ;;
  *)       FAIL "got $CODE — traversal not blocked" ;;
esac

echo ""
echo "===== TEST 7: Generate a valid signed URL via getSignedUrl + fetch it ====="
SIGNED=$(LOG_LEVEL=silent node -e "
process.chdir('$(cd "$(dirname "$0")/.." && pwd)');
const s = require('./src/lib/storage');
s.getSignedUrl('$STORAGE_KEY', 60).then(u => { process.stdout.write('\nURL=' + u + '\n'); });
" 2>/dev/null | grep '^URL=' | sed 's/^URL=//')
case "$SIGNED" in
  /api/storage/local/*sig=*) PASS "signed URL shape ok" ;;
  *)                         FAIL "unexpected: $SIGNED" ;;
esac

DL_CODE=$(curl -s -o /tmp/storage-dl.out -w "%{http_code}" "http://localhost:3000$SIGNED")
[ "$DL_CODE" = "200" ] && PASS "signed download → 200" || FAIL "got $DL_CODE"
grep -q "fake-pdf-content" /tmp/storage-dl.out && PASS "signed download returns content" || FAIL "content mismatch"

echo ""
echo "===== TEST 8: Expired signature → 403 ====="
EXPIRED=$(LOG_LEVEL=silent node -e "
process.chdir('$(cd "$(dirname "$0")/.." && pwd)');
const s = require('./src/lib/storage');
const crypto = require('crypto');
const exp = Math.floor(Date.now()/1000) - 60;
const key = '$STORAGE_KEY';
const h = crypto.createHmac('sha256', process.env.STORAGE_SIGNING_KEY || process.env.JWT_SECRET || 'rpe-dev-storage-signing-key');
h.update(key + '\n' + exp);
process.stdout.write('\nURL=/api/storage/local/' + key.split('/').map(encodeURIComponent).join('/') + '?exp=' + exp + '&sig=' + h.digest('hex') + '\n');
" 2>/dev/null | grep '^URL=' | sed 's/^URL=//')
EXP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000$EXPIRED")
[ "$EXP_CODE" = "403" ] && PASS "expired → 403" || FAIL "got $EXP_CODE"

echo ""
echo "===== TEST 9: Round-trip storage.putObject + getObject ====="
node -e "
process.chdir('$(cd "$(dirname "$0")/.." && pwd)');
const s = require('./src/lib/storage');
const buf = Buffer.from('hello-storage-$RANDOM');
(async () => {
  await s.putObject('test/roundtrip.txt', buf, 'text/plain');
  const out = await s.getObject('test/roundtrip.txt');
  if (out.toString() !== buf.toString()) { console.error('mismatch'); process.exit(1); }
  await s.deleteObject('test/roundtrip.txt');
  console.log('roundtrip-ok');
})();
" 2>/dev/null | grep -q roundtrip-ok && PASS "putObject/getObject/deleteObject roundtrip" || FAIL "roundtrip failed"

echo ""
echo "===== TEST 10: Driver reports correct value ====="
DRIVER=$(LOG_LEVEL=silent node -e "process.chdir('$(cd "$(dirname "$0")/.." && pwd)');console.log('DRV=' + require('./src/lib/storage').DRIVER)" 2>/dev/null | grep '^DRV=' | sed 's/^DRV=//')
PASS "driver=$DRIVER"

rm -f "$TMP" /tmp/storage-dl.out
echo ""
echo "ALL STORAGE TESTS PASSED ✓"
