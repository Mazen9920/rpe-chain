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
    update: { approvalStatus: 'PREFERRED', taxRegistered: true, incoterms: 'DDP', website: 'https://3m.example', addressLine1: 'Sheikh Zayed Rd 215', city: 'Dubai', country: 'AE', postalCode: '00000', bankName: 'Emirates NBD', iban: 'AE070331234567890123456', swift: 'EBILAEAD' },
    create: { code: 'SUP-001', name: '3M Safety Distributor MENA', legalName: '3M Safety Distribution LLC', currency: 'USD', paymentTerms: 'NET30', leadTimeDays: 14, primaryContact: 'Sarah Mansour', email: 'orders@3msafety-mena.example', country: 'AE', riskRating: 'LOW', approvalStatus: 'PREFERRED', taxRegistered: true, incoterms: 'DDP', website: 'https://3m.example', addressLine1: 'Sheikh Zayed Rd 215', city: 'Dubai', postalCode: '00000', bankName: 'Emirates NBD', iban: 'AE070331234567890123456', swift: 'EBILAEAD' },
  });
  const supHoneywell = await prisma.supplier.upsert({
    where: { code: 'SUP-002' },
    update: { approvalStatus: 'APPROVED', taxRegistered: true, incoterms: 'FOB', website: 'https://honeywell.example', addressLine1: '17 Marsh Wall', city: 'London', country: 'GB', postalCode: 'E14 9TJ', bankName: 'HSBC UK', iban: 'GB29NWBK60161331926819', swift: 'HBUKGB4B' },
    create: { code: 'SUP-002', name: 'Honeywell Safety UK', legalName: 'Honeywell Safety Products Ltd', currency: 'GBP', paymentTerms: 'NET45', leadTimeDays: 21, primaryContact: 'James Wright', email: 'safety@honeywell-uk.example', country: 'GB', riskRating: 'LOW', approvalStatus: 'APPROVED', taxRegistered: true, incoterms: 'FOB', website: 'https://honeywell.example', addressLine1: '17 Marsh Wall', city: 'London', postalCode: 'E14 9TJ', bankName: 'HSBC UK', iban: 'GB29NWBK60161331926819', swift: 'HBUKGB4B' },
  });
  const supDraeger = await prisma.supplier.upsert({
    where: { code: 'SUP-003' },
    update: {},
    create: { code: 'SUP-003', name: 'Dräger Safety GmbH', legalName: 'Drägerwerk AG & Co. KGaA', currency: 'EUR', paymentTerms: 'NET60', incoterms: 'EXW', leadTimeDays: 28, primaryContact: 'Lukas Hoffmann', email: 'export@draeger.example', country: 'DE', riskRating: 'LOW', approvalStatus: 'UNDER_REVIEW', taxRegistered: true, addressLine1: 'Moislinger Allee 53-55', city: 'Lübeck', postalCode: '23558', bankName: 'Deutsche Bank', iban: 'DE89370400440532013000', swift: 'DEUTDEFF' },
  });
  const supMoldex = await prisma.supplier.upsert({
    where: { code: 'SUP-004' },
    update: {},
    create: { code: 'SUP-004', name: 'Moldex-Metric Inc', legalName: 'Moldex-Metric, Inc.', currency: 'USD', paymentTerms: 'NET30', incoterms: 'FOB', leadTimeDays: 18, primaryContact: 'Maria Lopez', email: 'sales@moldex.example', country: 'US', riskRating: 'MEDIUM', approvalStatus: 'APPROVED', taxRegistered: true, addressLine1: '10111 W Jefferson Blvd', city: 'Culver City', state: 'CA', postalCode: '90232', bankName: 'Bank of America', iban: 'US12345678901234567890', swift: 'BOFAUS3N' },
  });
  const supGulf = await prisma.supplier.upsert({
    where: { code: 'SUP-005' },
    update: {},
    create: { code: 'SUP-005', name: 'Gulf PPE Trading', legalName: 'Gulf PPE Trading FZE', currency: 'AED', paymentTerms: 'NET15', incoterms: 'CIF', leadTimeDays: 7, primaryContact: 'Omar Al-Rashid', email: 'omar@gulfppe.example', country: 'AE', riskRating: 'HIGH', approvalStatus: 'DRAFT', taxRegistered: false, addressLine1: 'Jebel Ali Free Zone', city: 'Dubai', postalCode: '17000', notes: 'New vendor; pending compliance review.' },
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
      update: { supplierSku: `${preferredSupId === sup3M.id ? '3M' : 'HW'}-${product.sku}`, leadTimeDays: preferredSupId === sup3M.id ? 14 : 21 },
      create: { supplierId: preferredSupId, productId: product.id, agreedPrice: p.costPrice, moq: 50, priority: 1, supplierSku: `${preferredSupId === sup3M.id ? '3M' : 'HW'}-${product.sku}`, leadTimeDays: preferredSupId === sup3M.id ? 14 : 21 },
    });
    // Secondary supplier (Honeywell as backup for 3M products)
    if (preferredSupId === sup3M.id) {
      await prisma.supplierProduct.upsert({
        where: { supplierId_productId: { supplierId: supHoneywell.id, productId: product.id } },
        update: { supplierSku: `HW-${product.sku}`, leadTimeDays: 21 },
        create: { supplierId: supHoneywell.id, productId: product.id, agreedPrice: p.costPrice * 1.05, moq: 100, priority: 2, supplierSku: `HW-${product.sku}`, leadTimeDays: 21 },
      });
    }
  }

  // ── Suppliers v1.0: categories, contacts, performance, extra product links ──
  const supCategories = [
    { code: 'RAW_MATERIALS', name: 'Raw materials',  description: 'Filter media, polymers, elastomers' },
    { code: 'PACKAGING',     name: 'Packaging',      description: 'Boxes, labels, dunnage' },
    { code: 'LOGISTICS',     name: 'Logistics',      description: 'Carriers, freight forwarders' },
    { code: 'SERVICES',      name: 'Services',       description: 'Calibration, audit, training' },
    { code: 'CAPEX',         name: 'CapEx',          description: 'Capital equipment' },
  ];
  const catIds = {};
  for (const c of supCategories) {
    const row = await prisma.supplierCategory.upsert({ where: { code: c.code }, update: {}, create: c });
    catIds[c.code] = row.id;
  }

  const categoryAssignments = [
    [sup3M.id,        ['RAW_MATERIALS']],
    [supHoneywell.id, ['RAW_MATERIALS', 'PACKAGING']],
    [supDraeger.id,   ['CAPEX', 'SERVICES']],
    [supMoldex.id,    ['RAW_MATERIALS']],
    [supGulf.id,      ['LOGISTICS', 'PACKAGING']],
  ];
  for (const [supplierId, codes] of categoryAssignments) {
    for (const code of codes) {
      await prisma.supplierCategoryLink.upsert({
        where: { supplierId_categoryId: { supplierId, categoryId: catIds[code] } },
        update: {},
        create: { supplierId, categoryId: catIds[code] },
      });
    }
  }

  const contacts = [
    { supplierId: sup3M.id,        name: 'Sarah Mansour',   role: 'Account Manager', email: 'sarah@3msafety-mena.example', phone: '+971-4-555-0100', isPrimary: true  },
    { supplierId: sup3M.id,        name: 'Tariq Hassan',    role: 'Logistics',       email: 'tariq@3msafety-mena.example', phone: '+971-4-555-0101', isPrimary: false },
    { supplierId: supHoneywell.id, name: 'James Wright',    role: 'Sales Director',  email: 'james@honeywell-uk.example',  phone: '+44-20-7000-0001', isPrimary: true  },
    { supplierId: supHoneywell.id, name: 'Emily Carter',    role: 'Customer Service',email: 'emily@honeywell-uk.example',  phone: '+44-20-7000-0002', isPrimary: false },
    { supplierId: supDraeger.id,   name: 'Lukas Hoffmann',  role: 'Export Manager',  email: 'lukas@draeger.example',       phone: '+49-451-882-0',    isPrimary: true  },
    { supplierId: supMoldex.id,    name: 'Maria Lopez',     role: 'Sales',           email: 'maria@moldex.example',        phone: '+1-310-837-6500',  isPrimary: true  },
    { supplierId: supGulf.id,      name: 'Omar Al-Rashid',  role: 'Owner',           email: 'omar@gulfppe.example',        phone: '+971-50-555-0500', isPrimary: true  },
  ];
  for (const c of contacts) {
    const existing = await prisma.supplierContact.findFirst({ where: { supplierId: c.supplierId, name: c.name } });
    if (!existing) await prisma.supplierContact.create({ data: c });
  }

  // Manual scorecards (last 2 quarters) for established suppliers
  const _now = Date.now();
  const _day = 24 * 60 * 60 * 1000;
  const q1Start = new Date(_now - 180 * _day);
  const q1End   = new Date(_now - 90 * _day);
  const q2Start = new Date(_now - 90 * _day);
  const q2End   = new Date(_now - 1 * _day);
  const perfRows = [
    { supplierId: sup3M.id,        periodStart: q1Start, periodEnd: q1End, onTimeRate: 0.96, fillRate: 0.98, defectRate: 0.005, leadTimeMean: 13.5 },
    { supplierId: sup3M.id,        periodStart: q2Start, periodEnd: q2End, onTimeRate: 0.97, fillRate: 0.99, defectRate: 0.004, leadTimeMean: 13.2 },
    { supplierId: supHoneywell.id, periodStart: q1Start, periodEnd: q1End, onTimeRate: 0.92, fillRate: 0.95, defectRate: 0.012, leadTimeMean: 21.0 },
    { supplierId: supHoneywell.id, periodStart: q2Start, periodEnd: q2End, onTimeRate: 0.93, fillRate: 0.96, defectRate: 0.010, leadTimeMean: 20.5 },
    { supplierId: supMoldex.id,    periodStart: q2Start, periodEnd: q2End, onTimeRate: 0.88, fillRate: 0.91, defectRate: 0.020, leadTimeMean: 18.8 },
  ];
  for (const r of perfRows) {
    const existing = await prisma.supplierPerformance.findFirst({ where: { supplierId: r.supplierId, periodStart: r.periodStart, periodEnd: r.periodEnd } });
    if (!existing) await prisma.supplierPerformance.create({ data: { ...r, source: 'MANUAL' } });
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

  // ── Section 4: Procurement demo POs ────────────────────────────────────
  // Idempotent: only create on a clean run (no existing PO matching marker note).
  const existingDemoPO = await prisma.purchaseOrder.findFirst({ where: { notes: { contains: '[seed:procurement]' } } });
  if (!existingDemoPO) {
    const hmrSmall = await prisma.product.findUnique({ where: { sku: 'RPE-HMR-7501' } });
    const flt = await prisma.product.findUnique({ where: { sku: 'RPE-FLT-2091' } });
    const day = 86400000;
    const now = Date.now();

    // PO-A: DRAFT (3M, USD)
    await prisma.purchaseOrder.create({
      data: {
        poNumber: `PO-SEED-A-${Date.now()}`,
        supplierId: sup3M.id,
        createdById: admin.id,
        currency: 'USD',
        expectedDate: new Date(now + 14 * day),
        notes: '[seed:procurement] Draft PO for 3M',
        totalAmount: 18.5 * 100,
        lines: { create: [{ productId: hmrSmall.id, qtyOrdered: 100, unitPrice: 18.5 }] },
      },
    });

    // PO-B: SENT (Honeywell, overdue)
    await prisma.purchaseOrder.create({
      data: {
        poNumber: `PO-SEED-B-${Date.now()}`,
        supplierId: supHoneywell.id,
        createdById: admin.id,
        approvedById: admin.id,
        approvedAt: new Date(now - 21 * day),
        submittedAt: new Date(now - 25 * day),
        sentAt: new Date(now - 20 * day),
        status: 'SENT',
        currency: 'USD',
        expectedDate: new Date(now - 3 * day),
        notes: '[seed:procurement] Sent overdue PO',
        totalAmount: 165 * 25,
        lines: { create: [{ productId: (await prisma.product.findUnique({ where: { sku: 'RPE-FFR-6800' } })).id, qtyOrdered: 25, unitPrice: 165 }] },
      },
    });

    // PO-C: SENT for receiving demo (3M, USD)
    await prisma.purchaseOrder.create({
      data: {
        poNumber: `PO-SEED-C-${Date.now()}`,
        supplierId: sup3M.id,
        createdById: admin.id,
        approvedById: admin.id,
        approvedAt: new Date(now - 7 * day),
        submittedAt: new Date(now - 8 * day),
        sentAt: new Date(now - 5 * day),
        status: 'SENT',
        currency: 'USD',
        expectedDate: new Date(now + 5 * day),
        notes: '[seed:procurement] Ready to receive',
        totalAmount: 4.25 * 500,
        lines: { create: [{ productId: flt.id, qtyOrdered: 500, unitPrice: 4.25 }] },
      },
    });

    // PO-D: CANCELLED
    await prisma.purchaseOrder.create({
      data: {
        poNumber: `PO-SEED-D-${Date.now()}`,
        supplierId: supDraeger.id,
        createdById: admin.id,
        status: 'CANCELLED',
        currency: 'EUR',
        fxRate: 1.08,
        cancelledAt: new Date(now - 2 * day),
        cancelReason: 'Demo: supplier substituted',
        notes: '[seed:procurement] Cancelled PO',
        totalAmount: 20 * 9,
        lines: { create: [{ productId: hmrSmall.id, qtyOrdered: 20, unitPrice: 9 }] },
      },
    });

    // PO-E: SENT (Gulf, AED, multi-currency demo)
    await prisma.purchaseOrder.create({
      data: {
        poNumber: `PO-SEED-E-${Date.now()}`,
        supplierId: supGulf.id,
        createdById: admin.id,
        approvedById: admin.id,
        approvedAt: new Date(now - 2 * day),
        submittedAt: new Date(now - 3 * day),
        sentAt: new Date(now - 1 * day),
        status: 'SENT',
        currency: 'AED',
        fxRate: 0.272,
        expectedDate: new Date(now + 10 * day),
        notes: '[seed:procurement] FX demo (AED → USD)',
        totalAmount: 70 * 50,
        lines: { create: [{ productId: hmrSmall.id, qtyOrdered: 50, unitPrice: 70 }] },
      },
    });

    console.log('   Procurement: 5 demo POs created');
  }

  // ── Accounts Payable demo (Section 5) ─────────────────────────────────────
  const existingInv = await prisma.supplierInvoice.count();
  if (existingInv === 0) {
    const apInvoice = require('../src/services/apInvoice.service');
    const paymentSvc = require('../src/services/payment.service');
    const creditNote = require('../src/services/creditNote.service');
    const actor = { id: admin.id };
    const ts = Date.now();

    // 1) Fully paid invoice (3M, USD 1000) — non-PO, will auto-MATCH on submit.
    const inv1 = await apInvoice.createInvoice({
      invoiceNumber: `AP-PAID-${ts}`,
      supplierId: sup3M.id,
      currency: 'USD',
      invoiceDate: new Date(now - 40 * day).toISOString(),
      notes: '[seed:ap] Fully paid demo',
      lines: [{ description: 'Bulk filters', quantity: 100, unitPrice: 10 }],
    }, actor, '127.0.0.1');
    await apInvoice.submitForMatching(inv1.id, actor, '127.0.0.1');
    await apInvoice.approveInvoice(inv1.id, {}, actor, '127.0.0.1');
    await paymentSvc.recordPayment({
      supplierId: sup3M.id,
      amount: 1000,
      currency: 'USD',
      paymentDate: new Date(now - 5 * day).toISOString(),
      method: 'BANK_TRANSFER',
      reference: `WIRE-${ts}`,
      applications: [{ invoiceId: inv1.id, amountApplied: 1000 }],
    }, actor, '127.0.0.1');

    // 2) Partially paid invoice (Honeywell, GBP 2000 → 500 paid).
    const inv2 = await apInvoice.createInvoice({
      invoiceNumber: `AP-PART-${ts}`,
      supplierId: supHoneywell.id,
      currency: 'GBP',
      invoiceDate: new Date(now - 25 * day).toISOString(),
      notes: '[seed:ap] Partially paid demo',
      lines: [{ description: 'Full-face respirator units', quantity: 10, unitPrice: 200 }],
    }, actor, '127.0.0.1');
    await apInvoice.submitForMatching(inv2.id, actor, '127.0.0.1');
    await apInvoice.approveInvoice(inv2.id, {}, actor, '127.0.0.1');
    await paymentSvc.recordPayment({
      supplierId: supHoneywell.id,
      amount: 500,
      currency: 'GBP',
      paymentDate: new Date(now - 3 * day).toISOString(),
      method: 'BANK_TRANSFER',
      reference: `WIRE-PART-${ts}`,
      applications: [{ invoiceId: inv2.id, amountApplied: 500 }],
    }, actor, '127.0.0.1');

    // 3) Approved, unpaid, overdue (Moldex, USD 750) — for aging demo.
    const inv3 = await apInvoice.createInvoice({
      invoiceNumber: `AP-OVERDUE-${ts}`,
      supplierId: supMoldex.id,
      currency: 'USD',
      invoiceDate: new Date(now - 75 * day).toISOString(),
      notes: '[seed:ap] Overdue aging demo',
      lines: [{ description: 'N95 boxes', quantity: 25, unitPrice: 30 }],
    }, actor, '127.0.0.1');
    await apInvoice.submitForMatching(inv3.id, actor, '127.0.0.1');
    await apInvoice.approveInvoice(inv3.id, {}, actor, '127.0.0.1');
    // Backdate dueDate so it lands in 31_60 bucket
    await prisma.supplierInvoice.update({
      where: { id: inv3.id },
      data: { dueDate: new Date(now - 45 * day) },
    });

    // 4) Draft invoice (Dräger, EUR) — sits in queue.
    await apInvoice.createInvoice({
      invoiceNumber: `AP-DRAFT-${ts}`,
      supplierId: supDraeger.id,
      currency: 'EUR',
      fxRate: 1.08,
      invoiceDate: new Date(now - 2 * day).toISOString(),
      notes: '[seed:ap] Draft awaiting submission',
      lines: [{ description: 'Cartridge replacements', quantity: 30, unitPrice: 25 }],
    }, actor, '127.0.0.1');

    // 5) Credit note against invoice #1 (refund 50).
    await creditNote.createCreditNote({
      invoiceNumber: `CN-${ts}`,
      creditedInvoiceId: inv1.id,
      invoiceDate: new Date(now - 1 * day).toISOString(),
      notes: '[seed:ap] Refund credit note',
      lines: [{ description: 'Quality refund', quantity: 1, unitPrice: 50 }],
    }, actor, '127.0.0.1');

    console.log('   AP: 4 invoices + 1 credit note + 2 payments created');
  }

  console.log('✅ Seed complete.');
  console.log('   Admin login: admin@rpechain.com / Admin@123');
  console.log('   Production login: production@rpechain.com / Prod@123');
  console.log('   Warehouses: DXB-01 (AED), UK-01 (GBP), USA-01 (USD)');
  console.log('   Products: 6 (incl. RPE-KIT-HMR assembly) | Suppliers: 5 (5 categories, contacts, scorecards)');
  console.log('   Manufacturing: 1 active BOM + 1 sample DRAFT order');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
