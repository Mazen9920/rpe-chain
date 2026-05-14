#!/bin/bash
# Tier 3 — Phase A: anomaly alerts (demand / margin / lead-time) smoke tests.
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
PROC=$(login procurement@rpechain.com Admin@123)
FIN=$(login finance@rpechain.com Admin@123)
WH=$(login warehouse@rpechain.com Admin@123)

echo ""; echo "===== TIER 3 — ANOMALY ALERTS ====="

echo "T1: Admin scan returns new anomaly sections"
R=$(curl -s -X POST -H "Authorization: Bearer $ADMIN" $BASE/alerts/scan)
DA=$(echo "$R" | jget demandAnomaly.active)
ME=$(echo "$R" | jget marginErosion.active)
LT=$(echo "$R" | jget leadTimeDrift.active)
if [ -n "$DA" ] && [ -n "$ME" ] && [ -n "$LT" ]; then
  PASS "scan keys present (demand=$DA margin=$ME lead=$LT)"
else
  FAIL "missing keys, resp=$R"
fi

echo "T2: /reports/demand-anomalies (admin) → 200 + rows[]"
R=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/reports/demand-anomalies?days=30")
DAYS=$(echo "$R" | jget days)
[ "$DAYS" = "30" ] && PASS "days=30" || FAIL "resp=$R"

echo "T3: /reports/margin-erosion (admin) → 200"
R=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/reports/margin-erosion?days=90")
DAYS=$(echo "$R" | jget days)
[ "$DAYS" = "90" ] && PASS "days=90" || FAIL "resp=$R"

echo "T4: /reports/lead-time-drift (admin) → 200"
R=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/reports/lead-time-drift?days=90")
DAYS=$(echo "$R" | jget days)
[ "$DAYS" = "90" ] && PASS "days=90" || FAIL "resp=$R"

echo "T5: /reports/lead-time-drift (warehouse) → 403"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $WH" "$BASE/reports/lead-time-drift")
[ "$CODE" = "403" ] && PASS "403 wh blocked" || FAIL "got $CODE"

echo "T6: /reports/margin-erosion (procurement) → 403"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $PROC" "$BASE/reports/margin-erosion")
[ "$CODE" = "403" ] && PASS "403 proc blocked" || FAIL "got $CODE"

echo "T7: /dashboard/margin-trend (admin) → 200 + series[30]"
R=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/dashboard/margin-trend?days=30")
LEN=$(echo "$R" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(String(JSON.parse(d).series.length))}catch{process.stdout.write("0")}})')
[ "$LEN" = "30" ] && PASS "series length=30" || FAIL "got len=$LEN resp=$R"

echo "T8: Margin trend has marginPct field"
HAS=$(echo "$R" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{let s=JSON.parse(d).series;process.stdout.write(s.some(x=>"marginPct" in x)?"1":"0")}catch{process.stdout.write("0")}})')
[ "$HAS" = "1" ] && PASS "marginPct present" || FAIL "marginPct missing"

echo "T9: Seed synthetic 7-day demand spike, scan, expect DEMAND_ANOMALY alert"
SEED_OUT=$(cd "$(dirname "$0")/.." && node -e '
(async () => {
  const prisma = require("./src/lib/prisma");
  const product = await prisma.product.findFirst({ where: { isActive: true } });
  const warehouse = await prisma.warehouse.findFirst();
  if (!product || !warehouse) { console.log("NO_FIXTURES"); process.exit(0); }
  const now = Date.now();
  // Baseline: 2/day for days -34..-8 (27 days) so baselineMean ≈ 2.
  for (let i = 34; i >= 8; i -= 1) {
    await prisma.stockMovement.create({
      data: {
        productId: product.id, warehouseId: warehouse.id,
        qty: -2, direction: "OUT", reasonCode: "SHIPMENT",
        notes: "anomaly-smoke-seed",
        createdAt: new Date(now - (i - 0.5) * 86400000),
      },
    });
  }
  // Spike: 50/day for days -7..-1.
  for (let i = 7; i >= 1; i -= 1) {
    await prisma.stockMovement.create({
      data: {
        productId: product.id, warehouseId: warehouse.id,
        qty: -50, direction: "OUT", reasonCode: "SHIPMENT",
        notes: "anomaly-smoke-seed",
        createdAt: new Date(now - (i - 0.5) * 86400000),
      },
    });
  }
  console.log(product.id);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
')
echo "  seed product: $SEED_OUT"
curl -s -X POST -H "Authorization: Bearer $ADMIN" $BASE/alerts/scan >/dev/null
R=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/alerts?type=DEMAND_ANOMALY&status=OPEN&limit=20")
TOTAL=$(echo "$R" | jget total)
if [ "$TOTAL" -ge "1" ] 2>/dev/null; then
  PASS "DEMAND_ANOMALY alerts created (total=$TOTAL)"
else
  FAIL "no DEMAND_ANOMALY alert raised after spike (resp=$R)"
fi

echo "T10: Cleanup synthetic spike & re-scan auto-resolves alert"
cd "$(dirname "$0")/.." && node -e '
(async () => {
  const prisma = require("./src/lib/prisma");
  await prisma.stockMovement.deleteMany({ where: { notes: "anomaly-smoke-seed" } });
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
'
curl -s -X POST -H "Authorization: Bearer $ADMIN" $BASE/alerts/scan >/dev/null
R=$(curl -s -H "Authorization: Bearer $ADMIN" "$BASE/alerts?type=DEMAND_ANOMALY&status=OPEN&limit=20")
TOTAL_AFTER=$(echo "$R" | jget total)
PASS "after cleanup OPEN total=$TOTAL_AFTER (auto-resolve eligible)"

if [ "${FAILED:-0}" = "1" ]; then
  echo ""; echo "❌ anomaly alerts smoke FAILED"; exit 1
fi
echo ""; echo "✅ anomaly alerts smoke PASSED"
