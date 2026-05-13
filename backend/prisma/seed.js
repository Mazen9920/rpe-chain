/**
 * Seed script — RPE Chain Supply OS
 * Creates baseline users, 3 warehouses (Dubai, UK, USA), zones, bins with barcodes,
 * 5 products with reorderPoints, SupplierProducts with preferred flag,
 * lots with varied expiry dates (some expired, some near-expiry, some healthy),
 * and opening stock/cost layers.
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { createCostLayer } = require('../src/services/fifo.service');
const { recordMovement } = require('../src/services/stock.service');

const prisma = new PrismaClient();

async function main() {
  // ── Cleanup legacy test rows from earlier dev sessions ────────────────────
  // Delete any warehouses/bins/products/categories whose code or name matches
  // known throw-away test values from manual UI experimentation.
  const TEST_PATTERNS = ['222', 'ss', 'smoke', 'test'];
  for (const pat of TEST_PATTERNS) {
    await prisma.binLocation.deleteMany({ where: { OR: [{ code: { contains: pat, mode: 'insensitive' } }, { barcode: { contains: pat, mode: 'insensitive' } }] } }).catch(() => {});
    await prisma.warehouseZone.deleteMany({ where: { OR: [{ code: { contains: pat, mode: 'insensitive' } }, { name: { contains: pat, mode: 'insensitive' } }] } }).catch(() => {});
    await prisma.cycleCount.deleteMany({ where: { notes: { contains: pat, mode: 'insensitive' } } }).catch(() => {});
  }

  // ── Users ─────────────────────────────────────────────────────────────────
  const hashed = await bcrypt.hash('Admin@123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@rpechain.com' },
    update: {},
    create: { email: 'admin@rpechain.com', password: hashed, name: 'RPE Admin', role: 'ADMIN' },
  });
  for (const u of [
    { email: 'procurement@rpechain.com', name: 'Procurement Lead', role: 'PROCUREMENT' },
    { email: 'warehouse@rpechain.com',   name: 'Warehouse Operator', role: 'WAREHOUSE' },
    { email: 'finance@rpechain.com',     name: 'Finance Analyst', role: 'FINANCE' },
  ]) {
    await prisma.user.upsert({ where: { email: u.email }, update: {}, create: { ...u, password: hashed } });
  }
  const prodHashed = await bcrypt.hash('Prod@123', 10);
  await prisma.user.upsert({
    where: { email: 'production@rpechain.com' },
    update: {},
    create: { email: 'production@rpechain.com', password: prodHashed, name: 'Production Operator', role: 'PRODUCTION' },
  });

  // ── Warehouses ────────────────────────────────────────────────────────────
  const whDXB = await prisma.warehouse.upsert({
    where: { code: 'DXB-01' },
    update: {},
    create: { code: 'DXB-01', name: 'Dubai Main Warehouse', address: 'Dubai Industrial City, UAE', country: 'AE', currency: 'AED', taxJurisdiction: 'AE-VAT' },
  });
  const whUK = await prisma.warehouse.upsert({
    where: { code: 'UK-01' },
    update: {},
    create: { code: 'UK-01', name: 'UK Distribution Centre', address: 'Lutterworth, Leicestershire, UK', country: 'GB', currency: 'GBP', taxJurisdiction: 'GB-VAT' },
  });
  const whUSA = await prisma.warehouse.upsert({
    where: { code: 'USA-01' },
    update: {},
    create: { code: 'USA-01', name: 'USA East Coast DC', address: 'Newark, New Jersey, USA', country: 'US', currency: 'USD', taxJurisdiction: 'US-NJ' },
  });

  // ── Zones & Bins ──────────────────────────────────────────────────────────
  async function upsertZone(warehouseId, code, name) {
    const existing = await prisma.warehouseZone.findFirst({ where: { warehouseId, code } });
    if (existing) return existing;
    return prisma.warehouseZone.create({ data: { warehouseId, code, name } });
  }
  async function upsertBin(code, zoneId, warehouseId, binType, barcode) {
    const existing = await prisma.binLocation.findFirst({ where: { code, warehouseId } });
    if (existing) return existing;
    return prisma.binLocation.create({ data: { code, zoneId, warehouseId, binType, barcode: barcode || null } });
  }

  // Dubai zones + bins
  const dxbBulk = await upsertZone(whDXB.id, 'DXB-BULK', 'Bulk Storage');
  const dxbPick = await upsertZone(whDXB.id, 'DXB-PICK', 'Pick Face');
  const dxbQua  = await upsertZone(whDXB.id, 'DXB-QUA',  'Quarantine');
  const dxbBins = [];
  for (let r = 1; r <= 3; r++) {
    for (let b = 1; b <= 4; b++) {
      const code = `DXB-B${r}-${String(b).padStart(2,'0')}`;
      const bin = await upsertBin(code, dxbBulk.id, whDXB.id, 'BULK', `BC-DXB-${r}${b}`);
      dxbBins.push(bin);
    }
  }
  const dxbPickBins = [];
  for (let b = 1; b <= 4; b++) {
    const code = `DXB-P${b}`;
    const bin = await upsertBin(code, dxbPick.id, whDXB.id, 'PICK_FACE', `BC-DXBP-${b}`);
    dxbPickBins.push(bin);
  }
  await upsertBin('DXB-QUA-01', dxbQua.id, whDXB.id, 'QUARANTINE', 'BC-DXBQ-1');

  // UK zones + bins
  const ukBulk = await upsertZone(whUK.id, 'UK-BULK', 'Bulk Storage');
  const ukPick = await upsertZone(whUK.id, 'UK-PICK', 'Pick Face');
  const ukBins = [];
  for (let r = 1; r <= 2; r++) {
    for (let b = 1; b <= 4; b++) {
      const code = `UK-B${r}-${String(b).padStart(2,'0')}`;
      const bin = await upsertBin(code, ukBulk.id, whUK.id, 'BULK', `BC-UK-${r}${b}`);
      ukBins.push(bin);
    }
  }
  for (let b = 1; b <= 3; b++) {
    await upsertBin(`UK-P${b}`, ukPick.id, whUK.id, 'PICK_FACE', `BC-UKP-${b}`);
  }

  // USA zones + bins
  const usaBulk = await upsertZone(whUSA.id, 'USA-BULK', 'Bulk Storage');
  const usaBins = [];
  for (let b = 1; b <= 4; b++) {
    const code = `USA-B${b}`;
    const bin = await upsertBin(code, usaBulk.id, whUSA.id, 'BULK', `BC-USA-${b}`);
    usaBins.push(bin);
  }

  // ── Categories ────────────────────────────────────────────────────────────
  const respirators = await prisma.category.upsert({ where: { name: 'Half-Mask Respirators' }, update: {}, create: { name: 'Half-Mask Respirators', abcDefault: 'A', defaultServiceLevel: 0.99 } });
  const filters     = await prisma.category.upsert({ where: { name: 'Filter Cartridges' },     update: {}, create: { name: 'Filter Cartridges',     abcDefault: 'A', defaultServiceLevel: 0.99 } });
  const fullFace    = await prisma.category.upsert({ where: { name: 'Full-Face Respirators' },  update: {}, create: { name: 'Full-Face Respirators',  abcDefault: 'B', defaultServiceLevel: 0.95 } });
  const disposables = await prisma.category.upsert({ where: { name: 'Disposable Respirators' }, update: {}, create: { name: 'Disposable Respirators', abcDefault: 'A', defaultServiceLevel: 0.99 } });
  const accessories = await prisma.category.upsert({ where: { name: 'Accessories' },            update: {}, create: { name: 'Accessories',            abcDefault: 'C', defaultServiceLevel: 0.90 } });

  // ── Suppliers ─────────────────────────────────────────────────────────────
  const sup3M = await prisma.supplier.upsert({
    where: { code: 'SUP-001' },
    update: {},
    create: { code: 'SUP-001', name: '3M Safety Distributor MENA', legalName: '3M Safety Distribution LLC', currency: 'USD', paymentTerms: 'NET30', leadTimeDays: 14, primaryContact: 'Sarah Mansour', email: 'orders@3msafety-mena.example', country: 'AE', riskRating: 'LOW' },
  });
  const supHoneywell = await prisma.supplier.upsert({
    where: { code: 'SUP-002' },
    update: {},
    create: { code: 'SUP-002', name: 'Honeywell Safety UK', legalName: 'Honeywell Safety Products Ltd', currency: 'GBP', paymentTerms: 'NET45', leadTimeDays: 21, primaryContact: 'James Wright', email: 'safety@honeywell-uk.example', country: 'GB', riskRating: 'LOW' },
  });

  // ── Products (5) ──────────────────────────────────────────────────────────
  const productDefs = [
    { sku: 'RPE-HMR-7501', name: 'Half-Mask Respirator (Small)',  uom: 'EA', categoryId: respirators.id, abcClass: 'A', xyzClass: 'X', reorderPoint: 50,  reorderQty: 200,  costPrice: 18.50,  sellingPrice: 32.00,  preferredSupId: sup3M.id },
    { sku: 'RPE-HMR-7502', name: 'Half-Mask Respirator (Medium)', uom: 'EA', categoryId: respirators.id, abcClass: 'A', xyzClass: 'X', reorderPoint: 80,  reorderQty: 300,  costPrice: 18.50,  sellingPrice: 32.00,  preferredSupId: sup3M.id },
    { sku: 'RPE-FLT-2091', name: 'P100 Particulate Filter',       uom: 'PR', categoryId: filters.id,     abcClass: 'A', xyzClass: 'X', reorderPoint: 200, reorderQty: 1000, costPrice: 4.25,   sellingPrice: 8.50,   preferredSupId: sup3M.id },
    { sku: 'RPE-FFR-6800', name: 'Full-Face Respirator',          uom: 'EA', categoryId: fullFace.id,    abcClass: 'B', xyzClass: 'Y', reorderPoint: 20,  reorderQty: 80,   costPrice: 165.00, sellingPrice: 245.00, preferredSupId: supHoneywell.id },
    { sku: 'RPE-DSP-N95',  name: 'N95 Disposable Respirator',    uom: 'BX', categoryId: disposables.id,  abcClass: 'A', xyzClass: 'X', reorderPoint: 100, reorderQty: 500,  costPrice: 28.00,  sellingPrice: 45.00,  preferredSupId: sup3M.id },
  ];

  const createdProducts = [];
  for (const p of productDefs) {
    const { preferredSupId, ...productData } = p;
    const product = await prisma.product.upsert({
      where: { sku: p.sku },
      update: { reorderPoint: p.reorderPoint, reorderQty: p.reorderQty },
      create: productData,
    });
    createdProducts.push({ ...product, preferredSupId, costPrice: p.costPrice });

    // Preferred supplier
    await prisma.supplierProduct.upsert({
      where: { supplierId_productId: { supplierId: preferredSupId, productId: product.id } },
      update: {},
      create: { supplierId: preferredSupId, productId: product.id, agreedPrice: p.costPrice, moq: 50, priority: 1 },
    });
    // Secondary supplier (Honeywell as backup for 3M products)
    if (preferredSupId === sup3M.id) {
      await prisma.supplierProduct.upsert({
        where: { supplierId_productId: { supplierId: supHoneywell.id, productId: product.id } },
        update: {},
        create: { supplierId: supHoneywell.id, productId: product.id, agreedPrice: p.costPrice * 1.05, moq: 100, priority: 2 },
      });
    }
  }

  // ── Lots + Stock (per warehouse) ──────────────────────────────────────────
  // Expiry scenarios: only seed for the first 3 products (respirators + filters)
  const expiryProducts = createdProducts.slice(0, 3);
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const expiryScenarios = [
    { suffix: 'EXPIRED',  expiry: new Date(now - 30 * day),  qty: 20, wh: whDXB, bin: dxbBins[0] },
    { suffix: 'CRITICAL', expiry: new Date(now + 15 * day),  qty: 30, wh: whDXB, bin: dxbBins[1] },
    { suffix: 'WARNING',  expiry: new Date(now + 45 * day),  qty: 50, wh: whUK,  bin: ukBins[0]  },
    { suffix: 'WATCH',    expiry: new Date(now + 75 * day),  qty: 60, wh: whUSA, bin: usaBins[0] },
    { suffix: 'HEALTHY',  expiry: new Date(now + 365 * day), qty: 100, wh: whDXB, bin: dxbBins[2] },
  ];

  const warehouses = [whDXB, whUK, whUSA];
  const whBins = { [whDXB.id]: dxbBins[3], [whUK.id]: ukBins[1], [whUSA.id]: usaBins[1] };

  for (const product of createdProducts) {
    // Expiry scenarios for first 3 products
    if (expiryProducts.some(p => p.id === product.id)) {
      for (const s of expiryScenarios) {
        const lotNum = `${product.sku}-${s.suffix}`;
        const existing = await prisma.lot.findFirst({ where: { lotNumber: lotNum } });
        if (existing) continue;

        const lot = await prisma.lot.create({
          data: { lotNumber: lotNum, productId: product.id, supplierId: product.preferredSupId, expiryDate: s.expiry, qtyReceived: s.qty, qtyRemaining: s.qty, qaStatus: 'RELEASED', currentBinId: s.bin.id },
        });

        await createCostLayer({ productId: product.id, warehouseId: s.wh.id, lotId: lot.id, qty: s.qty, unitCost: product.costPrice, landedCostPerUnit: 0.5, currency: 'USD', fxRate: 1 });
        await recordMovement({ productId: product.id, warehouseId: s.wh.id, binId: s.bin.id, lotId: lot.id, qty: s.qty, reasonCode: 'RECEIPT', sourceDocType: 'SEED', operatorId: admin.id, notes: 'Opening balance' });
      }
    }

    // Healthy opening stock for remaining warehouses for all products
    for (const wh of warehouses) {
      const openQty = 100;
      const lotNum = `${product.sku}-OPENING-${wh.code}`;
      const existing = await prisma.lot.findFirst({ where: { lotNumber: lotNum } });
      if (existing) continue;

      const bin = whBins[wh.id];
      const lot = await prisma.lot.create({
        data: { lotNumber: lotNum, productId: product.id, supplierId: product.preferredSupId, expiryDate: new Date(now + 365 * day), qtyReceived: openQty, qtyRemaining: openQty, qaStatus: 'RELEASED', currentBinId: bin.id },
      });
      await createCostLayer({ productId: product.id, warehouseId: wh.id, lotId: lot.id, qty: openQty, unitCost: product.costPrice, landedCostPerUnit: 0.5, currency: 'USD', fxRate: 1 });
      await recordMovement({ productId: product.id, warehouseId: wh.id, binId: bin.id, lotId: lot.id, qty: openQty, reasonCode: 'RECEIPT', sourceDocType: 'SEED', operatorId: admin.id, notes: 'Opening balance' });
    }
  }

  // ── Manufacturing: tag types, create assembly + active BOM + sample DRAFT order ──
  // Tag existing products
  const componentSkus = ['RPE-HMR-7501', 'RPE-HMR-7502', 'RPE-FLT-2091'];
  await prisma.product.updateMany({ where: { sku: { in: componentSkus } }, data: { type: 'COMPONENT' } });
  await prisma.product.updateMany({ where: { sku: { in: ['RPE-FFR-6800', 'RPE-DSP-N95'] } }, data: { type: 'FINISHED' } });

  // Create assembly (Half-Mask Kit) — finished good with BOM
  const kit = await prisma.product.upsert({
    where: { sku: 'RPE-KIT-HMR' },
    update: {},
    create: {
      sku: 'RPE-KIT-HMR',
      name: 'Half-Mask Respirator Kit (Medium + 1pr P100)',
      uom: 'EA',
      categoryId: respirators.id,
      type: 'FINISHED',
      isManufactured: true,
      reorderPoint: 20,
      reorderQty: 100,
      costPrice: 30.00,
      sellingPrice: 55.00,
      standardLaborCost: 1.50,
      standardOverheadCost: 0.75,
    },
  });

  const hmrMedium = await prisma.product.findUnique({ where: { sku: 'RPE-HMR-7502' } });
  const filterP100 = await prisma.product.findUnique({ where: { sku: 'RPE-FLT-2091' } });

  const existingBom = await prisma.billOfMaterials.findFirst({ where: { productId: kit.id } });
  if (!existingBom && hmrMedium && filterP100) {
    await prisma.billOfMaterials.create({
      data: {
        productId: kit.id,
        version: 1,
        isActive: true,
        notes: 'Standard kit assembly: 1 medium half-mask + 1 pair P100 filters',
        createdById: admin.id,
        lines: {
          create: [
            { componentProductId: hmrMedium.id, qtyPer: 1, uom: 'EA', scrapFactorPct: 0,    position: 1 },
            { componentProductId: filterP100.id, qtyPer: 1, uom: 'PR', scrapFactorPct: 2.0, position: 2 },
          ],
        },
      },
    });
  }

  // Sample DRAFT production order (planner output snapshot for demo)
  const sampleOrderExists = await prisma.productionOrder.findFirst({ where: { productId: kit.id } });
  if (!sampleOrderExists) {
    const year = new Date().getFullYear();
    const orderNumber = `PO-${year}-00001`;
    const bom = await prisma.billOfMaterials.findFirst({ where: { productId: kit.id, isActive: true } });
    if (bom) {
      await prisma.productionOrder.create({
        data: {
          orderNumber,
          productId: kit.id,
          bomId: bom.id,
          warehouseId: whDXB.id,
          plannedQty: 25,
          status: 'DRAFT',
          notes: 'Demo order — release to consume + post output',
          createdById: admin.id,
          lines: {
            create: [
              { componentProductId: hmrMedium.id, plannedQty: 25, uom: 'EA' },
              { componentProductId: filterP100.id, plannedQty: 25.5, uom: 'PR' },
            ],
          },
        },
      });
    }
  }

  console.log('✅ Seed complete.');
  console.log('   Admin login: admin@rpechain.com / Admin@123');
  console.log('   Production login: production@rpechain.com / Prod@123');
  console.log('   Warehouses: DXB-01 (AED), UK-01 (GBP), USA-01 (USD)');
  console.log('   Products: 6 (incl. RPE-KIT-HMR assembly) | Suppliers: 2');
  console.log('   Manufacturing: 1 active BOM + 1 sample DRAFT order');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
