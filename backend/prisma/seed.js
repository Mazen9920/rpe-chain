/**
 * Seed script — RPE Chain Supply OS
 * Aligns with the master plan: creates baseline users, warehouses, suppliers,
 * categories, RPE products, lots, and opening cost layers (so the FIFO ledger
 * is non-empty on first boot).
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { createCostLayer } = require('../src/services/fifo.service');
const { recordMovement } = require('../src/services/stock.service');

const prisma = new PrismaClient();

async function main() {
  // ── Users ────────────────────────────────────────────────────────────────
  const hashed = await bcrypt.hash('Admin@123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@rpechain.com' },
    update: {},
    create: { email: 'admin@rpechain.com', password: hashed, name: 'RPE Admin', role: 'ADMIN' },
  });
  await prisma.user.upsert({
    where: { email: 'procurement@rpechain.com' },
    update: {},
    create: {
      email: 'procurement@rpechain.com',
      password: hashed,
      name: 'Procurement Lead',
      role: 'PROCUREMENT',
    },
  });
  await prisma.user.upsert({
    where: { email: 'warehouse@rpechain.com' },
    update: {},
    create: {
      email: 'warehouse@rpechain.com',
      password: hashed,
      name: 'Warehouse Operator',
      role: 'WAREHOUSE',
    },
  });
  await prisma.user.upsert({
    where: { email: 'finance@rpechain.com' },
    update: {},
    create: {
      email: 'finance@rpechain.com',
      password: hashed,
      name: 'Finance Analyst',
      role: 'FINANCE',
    },
  });

  // ── Warehouse ────────────────────────────────────────────────────────────
  const wh = await prisma.warehouse.upsert({
    where: { code: 'CAI-01' },
    update: {},
    create: {
      code: 'CAI-01',
      name: 'Cairo Main Warehouse',
      address: '10th of Ramadan City, Egypt',
      taxJurisdiction: 'EG',
    },
  });

  // ── Categories ───────────────────────────────────────────────────────────
  const respirators = await prisma.category.upsert({
    where: { name: 'Half-Mask Respirators' },
    update: {},
    create: { name: 'Half-Mask Respirators', abcDefault: 'A', defaultServiceLevel: 0.99 },
  });
  const filters = await prisma.category.upsert({
    where: { name: 'Filter Cartridges' },
    update: {},
    create: { name: 'Filter Cartridges', abcDefault: 'A', defaultServiceLevel: 0.99 },
  });
  const fullFace = await prisma.category.upsert({
    where: { name: 'Full-Face Respirators' },
    update: {},
    create: { name: 'Full-Face Respirators', abcDefault: 'B', defaultServiceLevel: 0.95 },
  });

  // ── Supplier ─────────────────────────────────────────────────────────────
  const supplier = await prisma.supplier.upsert({
    where: { code: 'SUP-001' },
    update: {},
    create: {
      code: 'SUP-001',
      name: '3M Safety Distributor MENA',
      legalName: '3M Safety Distribution LLC',
      currency: 'USD',
      paymentTerms: 'NET30',
      leadTimeDays: 14,
      primaryContact: 'Sarah Mansour',
      email: 'orders@3msafety-mena.example',
      country: 'AE',
      riskRating: 'LOW',
    },
  });

  // ── Products ─────────────────────────────────────────────────────────────
  const products = [
    {
      sku: 'RPE-HMR-7501',
      name: 'Half-Mask Respirator (Small)',
      categoryId: respirators.id,
      abcClass: 'A',
      xyzClass: 'X',
      reorderPoint: 50,
      reorderQty: 200,
      costPrice: 18.5,
      sellingPrice: 32.0,
      certifications: [
        { type: 'NIOSH', number: 'TC-84A-1234', issuedAt: '2024-01-01', expiresAt: '2027-01-01' },
        { type: 'EN149', number: 'EN149:2001+A1:2009', issuedAt: '2024-01-01', expiresAt: '2027-01-01' },
      ],
    },
    {
      sku: 'RPE-FLT-2091',
      name: 'P100 Particulate Filter',
      categoryId: filters.id,
      abcClass: 'A',
      xyzClass: 'X',
      reorderPoint: 200,
      reorderQty: 1000,
      costPrice: 4.25,
      sellingPrice: 8.5,
      certifications: [
        { type: 'NIOSH', number: 'TC-84A-5678', issuedAt: '2024-01-01', expiresAt: '2027-01-01' },
      ],
    },
    {
      sku: 'RPE-FFR-6800',
      name: 'Full-Face Respirator',
      categoryId: fullFace.id,
      abcClass: 'B',
      xyzClass: 'Y',
      reorderPoint: 20,
      reorderQty: 80,
      costPrice: 165.0,
      sellingPrice: 245.0,
      certifications: [
        { type: 'CE', number: 'CE-0086', issuedAt: '2024-01-01', expiresAt: '2027-01-01' },
      ],
    },
  ];

  for (const p of products) {
    const product = await prisma.product.upsert({
      where: { sku: p.sku },
      update: {},
      create: p,
    });

    // Link to supplier as primary source.
    await prisma.supplierProduct.upsert({
      where: { supplierId_productId: { supplierId: supplier.id, productId: product.id } },
      update: {},
      create: {
        supplierId: supplier.id,
        productId: product.id,
        agreedPrice: p.costPrice,
        moq: 50,
        priority: 1,
      },
    });

    // Create one opening lot with an active cost layer so FIFO is non-empty.
    const openingQty = 100;
    const lot = await prisma.lot.create({
      data: {
        lotNumber: `${p.sku}-LOT-001`,
        productId: product.id,
        supplierId: supplier.id,
        expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        qtyReceived: openingQty,
        qtyRemaining: openingQty,
        qaStatus: 'RELEASED',
      },
    });

    await createCostLayer({
      productId: product.id,
      warehouseId: wh.id,
      lotId: lot.id,
      qty: openingQty,
      unitCost: p.costPrice,
      landedCostPerUnit: 0.5,
      currency: 'USD',
      fxRate: 1,
    });

    await recordMovement({
      productId: product.id,
      warehouseId: wh.id,
      lotId: lot.id,
      qty: openingQty,
      reasonCode: 'RECEIPT',
      sourceDocType: 'SEED',
      operatorId: admin.id,
      notes: 'Opening balance',
    });
  }

  console.log('Seed complete.');
  console.log('Admin login: admin@rpechain.com / Admin@123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
