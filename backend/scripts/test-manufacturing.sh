#!/bin/bash
# Manufacturing module negative + smoke tests
set -e
BASE=http://localhost:3000/api

login() {
  curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);process.stdout.write(j.token||"")})'
}

ADMIN=$(login admin@rpechain.com Admin@123)
PROD=$(login production@rpechain.com Prod@123)
echo "Admin token: ${ADMIN:0:15}... | Prod token: ${PROD:0:15}..."

# --- Get product ids ---
PRODUCTS=$(curl -s -H "Authorization: Bearer $ADMIN" $BASE/products)
KIT_ID=$(node -e "let d=$PRODUCTS;console.log(d.find(p=>p.sku==='RPE-KIT-HMR').id)")
HMR_ID=$(node -e "let d=$PRODUCTS;console.log(d.find(p=>p.sku==='RPE-HMR-7502').id)")
FLT_ID=$(node -e "let d=$PRODUCTS;console.log(d.find(p=>p.sku==='RPE-FLT-2091').id)")
echo "KIT=$KIT_ID HMR=$HMR_ID FLT=$FLT_ID"

echo ""
echo "===== TEST 1: Cycle BOM rejection (KIT→KIT) ====="
R=$(curl -s -X POST -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
  -d "{\"productId\":\"$KIT_ID\",\"lines\":[{\"componentProductId\":\"$KIT_ID\",\"qtyPer\":1}]}" \
  $BASE/boms)
echo "$R" | head -c 200
echo "$R" | grep -q "Component cannot equal parent" && echo " ✓ rejected" || echo " ✗ NOT rejected"

echo ""
echo "===== TEST 2: qtyPer<=0 rejection ====="
R=$(curl -s -X POST -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
  -d "{\"productId\":\"$KIT_ID\",\"lines\":[{\"componentProductId\":\"$HMR_ID\",\"qtyPer\":0}]}" \
  $BASE/boms)
echo "$R" | head -c 200
echo "$R" | grep -q "qtyPer must be > 0" && echo " ✓ rejected" || echo " ✗ NOT rejected"

echo ""
echo "===== TEST 3: RBAC — read-only-ish (procurement role) cannot create BOM ====="
PROC=$(login procurement@rpechain.com Admin@123)
R=$(curl -s -w "\nHTTP:%{http_code}" -X POST -H "Authorization: Bearer $PROC" -H "Content-Type: application/json" \
  -d "{\"productId\":\"$KIT_ID\",\"lines\":[{\"componentProductId\":\"$HMR_ID\",\"qtyPer\":1}]}" \
  $BASE/boms)
echo "$R" | tail -c 100
echo "$R" | grep -q "HTTP:403" && echo " ✓ 403" || echo " ✗ NOT 403"

echo ""
echo "===== TEST 4: Plan with insufficient stock surfaces shortfalls (no block) ====="
WHS=$(curl -s -H "Authorization: Bearer $ADMIN" $BASE/inventory/warehouses)
DXB=$(node -e "let d=$WHS;console.log(d.find(w=>w.code==='DXB-01').id)")
R=$(curl -s -X POST -H "Authorization: Bearer $PROD" -H "Content-Type: application/json" \
  -d "{\"productId\":\"$KIT_ID\",\"plannedQty\":99999,\"warehouseId\":\"$DXB\"}" \
  $BASE/production-orders/plan)
SHORT=$(echo "$R" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);console.log(j.shortfalls?j.shortfalls.length:"none")})')
echo "Shortfalls: $SHORT"
[ "$SHORT" = "2" ] && echo " ✓ 2 shortfalls reported" || echo " ✗ wrong count"

echo ""
echo "===== TEST 5: Cancel after consumption rejected ====="
ORDERS=$(curl -s -H "Authorization: Bearer $PROD" $BASE/production-orders)
COMPL=$(node -e "let d=$ORDERS;let o=d.find(x=>x.status==='COMPLETED');console.log(o?o.id:'')")
[ -n "$COMPL" ] && {
  R=$(curl -s -X POST -H "Authorization: Bearer $PROD" -H "Content-Type: application/json" -d '{}' $BASE/production-orders/$COMPL/cancel)
  echo "$R" | head -c 150
  echo "$R" | grep -q "Cannot cancel" && echo " ✓ rejected" || echo " ✗ NOT rejected"
}

echo ""
echo "===== TEST 6: Output qty=10 with scrap=2 → CostLayer reduced by scrap ====="
# Use the just-created insufficient order for cancellation, create a fresh one with qty=5
R=$(curl -s -X POST -H "Authorization: Bearer $PROD" -H "Content-Type: application/json" \
  -d "{\"productId\":\"$KIT_ID\",\"plannedQty\":5,\"warehouseId\":\"$DXB\"}" \
  $BASE/production-orders/plan)
NEW=$(echo "$R" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);console.log(j.order.id)})')
echo "Order: $NEW"
curl -s -X POST -H "Authorization: Bearer $PROD" $BASE/production-orders/$NEW/release > /dev/null
curl -s -X POST -H "Authorization: Bearer $PROD" $BASE/production-orders/$NEW/consume > /dev/null
R=$(curl -s -X POST -H "Authorization: Bearer $PROD" -H "Content-Type: application/json" \
  -d '{"qty":5,"scrapQty":1}' $BASE/production-orders/$NEW/output)
LOTID=$(echo "$R" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j=JSON.parse(d);console.log(j.lot.id)})')
echo "Lot: $LOTID"
# Verify Lot.qtyRemaining and CostLayer.qtyRemaining match
node -e "
const p=new (require('@prisma/client').PrismaClient)();
(async()=>{
  const l=await p.lot.findUnique({where:{id:'$LOTID'}});
  const cl=await p.costLayer.findFirst({where:{lotId:'$LOTID'}});
  console.log('Lot.qtyRemaining=',l.qtyRemaining,'CostLayer.qtyRemaining=',cl?cl.qtyRemaining:'none');
  if(l.qtyRemaining===4 && cl && cl.qtyRemaining===4) console.log(' ✓ scrap depleted CostLayer correctly');
  else console.log(' ✗ MISMATCH');
  await p.\$disconnect();
})();
"

echo ""
echo "===== TEST 7: Archive last active BOM resets isManufactured ====="
BOMS=$(curl -s -H "Authorization: Bearer $ADMIN" $BASE/boms)
ACTIVE_BOM=$(node -e "let d=$BOMS;let b=d.find(x=>x.isActive);console.log(b?b.id:'')")
echo "Archiving BOM $ACTIVE_BOM"
curl -s -X POST -H "Authorization: Bearer $ADMIN" $BASE/boms/$ACTIVE_BOM/archive > /dev/null
node -e "
const p=new (require('@prisma/client').PrismaClient)();
(async()=>{
  const k=await p.product.findUnique({where:{id:'$KIT_ID'}});
  console.log('isManufactured=',k.isManufactured);
  if(!k.isManufactured) console.log(' ✓ reset'); else console.log(' ✗ still true');
  // restore for further use: reactivate the BOM via direct db update
  await p.billOfMaterials.update({where:{id:'$ACTIVE_BOM'},data:{archivedAt:null,isActive:true}});
  await p.product.update({where:{id:'$KIT_ID'},data:{isManufactured:true}});
  await p.\$disconnect();
})();
"

echo ""
echo "===== ALL TESTS COMPLETE ====="
