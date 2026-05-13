/**
 * BOM service — Bill of Materials engine.
 *
 * Responsibilities:
 *   - explodeBom: recursive expansion of a BOM with cycle detection
 *   - validateBom: structural & referential validation of a single BOM
 *   - cloneBom: copy a BOM into a new draft version
 *   - activateBom: transactionally archive prior active and set new active
 *   - rollupStandardCost: standard-cost rollup using product.costPrice for leaves
 *   - rollupFifoCost: FIFO-cost rollup using weighted-avg of remaining CostLayer rows
 *
 * All write operations are transactional. Sub-assemblies are exploded recursively
 * for COSTING ONLY — at planning time, sub-assemblies are consumed from stock.
 */
const prisma = require('../lib/prisma');

/**
 * Recursive BOM explosion.
 * @param {string} productId
 * @param {number} qty - top-level qty required
 * @param {object} [opts]
 * @param {number} [opts.depth=0]
 * @param {Set<string>} [opts.visited]
 * @param {object} [opts.client] - prisma client / tx
 * @returns {Promise<Array>} flat list: { productId, sku, name, qtyRequired, depth, isLeaf, hasOwnBom, parentBomId }
 */
async function explodeBom(productId, qty, opts = {}) {
  const { depth = 0, visited = new Set(), client = prisma } = opts;

  if (visited.has(productId)) {
    throw new Error(`BOM cycle detected at product ${productId}`);
  }
  const nextVisited = new Set(visited);
  nextVisited.add(productId);

  const activeBom = await client.billOfMaterials.findFirst({
    where: { productId, isActive: true, archivedAt: null },
    include: { lines: { include: { componentProduct: true } } },
  });

  if (!activeBom) return []; // leaf

  const out = [];
  for (const line of activeBom.lines) {
    const lineQty = Number(qty) * Number(line.qtyPer) * (1 + Number(line.scrapFactorPct) / 100);

    const childBom = await client.billOfMaterials.findFirst({
      where: { productId: line.componentProductId, isActive: true, archivedAt: null },
      select: { id: true },
    });
    const isLeaf = !childBom;

    out.push({
      productId: line.componentProductId,
      sku: line.componentProduct.sku,
      name: line.componentProduct.name,
      uom: line.uom,
      qtyRequired: lineQty,
      depth,
      isLeaf,
      hasOwnBom: !isLeaf,
      parentBomId: activeBom.id,
    });

    if (!isLeaf) {
      const subList = await explodeBom(line.componentProductId, lineQty, {
        depth: depth + 1,
        visited: nextVisited,
        client,
      });
      out.push(...subList);
    }
  }
  return out;
}

/**
 * Structural validation of a BOM (no cycles, all components active).
 * Returns { ok: true } or throws Error.
 */
async function validateBom(bomId) {
  const bom = await prisma.billOfMaterials.findUnique({
    where: { id: bomId },
    include: { lines: { include: { componentProduct: true } } },
  });
  if (!bom) throw new Error('BOM not found');
  if (bom.lines.length === 0) throw new Error('BOM has no lines');

  for (const line of bom.lines) {
    if (!line.componentProduct.isActive || line.componentProduct.deletedAt) {
      throw new Error(`Component ${line.componentProduct.sku} is not active`);
    }
    if (line.componentProductId === bom.productId) {
      throw new Error(`Component cannot equal parent product (${line.componentProduct.sku})`);
    }
    if (Number(line.qtyPer) <= 0) {
      throw new Error(`qtyPer must be > 0 for component ${line.componentProduct.sku}`);
    }
  }

  // Cycle check via a dry-run explode at qty=1.
  await explodeBom(bom.productId, 1);

  return { ok: true };
}

/**
 * Clone a BOM into a new DRAFT (isActive=false). New version = max(version)+1 for that product.
 */
async function cloneBom(bomId, { createdById } = {}) {
  return prisma.$transaction(async (tx) => {
    const src = await tx.billOfMaterials.findUnique({
      where: { id: bomId },
      include: { lines: true },
    });
    if (!src) throw new Error('Source BOM not found');

    const max = await tx.billOfMaterials.aggregate({
      where: { productId: src.productId },
      _max: { version: true },
    });
    const newVersion = (max._max.version || 0) + 1;

    return tx.billOfMaterials.create({
      data: {
        productId: src.productId,
        version: newVersion,
        isActive: false,
        notes: src.notes ? `Cloned from v${src.version}` : null,
        createdById: createdById || null,
        lines: {
          create: src.lines.map((l) => ({
            componentProductId: l.componentProductId,
            qtyPer: l.qtyPer,
            uom: l.uom,
            scrapFactorPct: l.scrapFactorPct,
            position: l.position,
            notes: l.notes,
          })),
        },
      },
      include: { lines: true },
    });
  });
}

/**
 * Activate a BOM: archives the currently active BOM (if any) for the same product.
 */
async function activateBom(bomId) {
  return prisma.$transaction(async (tx) => {
    const bom = await tx.billOfMaterials.findUnique({ where: { id: bomId } });
    if (!bom) throw new Error('BOM not found');
    if (bom.archivedAt) throw new Error('Cannot activate an archived BOM');
    if (bom.isActive) return bom;

    // Validate before activating.
    await validateBom(bomId);

    // Archive prior active.
    await tx.billOfMaterials.updateMany({
      where: { productId: bom.productId, isActive: true, NOT: { id: bomId } },
      data: { isActive: false, archivedAt: new Date() },
    });

    // Mark this product as manufactured.
    await tx.product.update({
      where: { id: bom.productId },
      data: { isManufactured: true },
    });

    return tx.billOfMaterials.update({
      where: { id: bomId },
      data: { isActive: true },
    });
  });
}

/**
 * Standard cost rollup. Uses product.costPrice for leaves, recurses for sub-BOMs.
 * Returns { tree, totalUnitCost }.
 */
async function rollupStandardCost(productId, opts = {}) {
  const { visited = new Set(), client = prisma } = opts;

  if (visited.has(productId)) {
    throw new Error(`Cost rollup cycle at product ${productId}`);
  }
  const next = new Set(visited);
  next.add(productId);

  const product = await client.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error('Product not found');

  const activeBom = await client.billOfMaterials.findFirst({
    where: { productId, isActive: true, archivedAt: null },
    include: { lines: { include: { componentProduct: true } } },
  });

  if (!activeBom) {
    return {
      productId,
      sku: product.sku,
      name: product.name,
      isLeaf: true,
      qtyPer: 1,
      unitCost: Number(product.costPrice),
      labor: 0,
      overhead: 0,
      lineCost: Number(product.costPrice),
      components: [],
    };
  }

  const components = [];
  let componentTotal = 0;
  for (const line of activeBom.lines) {
    const child = await rollupStandardCost(line.componentProductId, {
      visited: next,
      client,
    });
    const qtyPer = Number(line.qtyPer) * (1 + Number(line.scrapFactorPct) / 100);
    const lineCost = qtyPer * child.unitCost;
    componentTotal += lineCost;
    components.push({ ...child, qtyPer, lineCost });
  }

  const labor = Number(product.standardLaborCost);
  const overhead = Number(product.standardOverheadCost);
  const unitCost = componentTotal + labor + overhead;

  return {
    productId,
    sku: product.sku,
    name: product.name,
    isLeaf: false,
    qtyPer: 1,
    unitCost,
    labor,
    overhead,
    lineCost: unitCost,
    components,
  };
}

/**
 * FIFO cost rollup. Leaves use weighted-avg remaining FIFO cost from CostLayer
 * (filtered by warehouseId if given). Falls back to product.costPrice if no layers.
 */
async function rollupFifoCost(productId, warehouseId = null, opts = {}) {
  const { visited = new Set(), client = prisma } = opts;

  if (visited.has(productId)) {
    throw new Error(`Cost rollup cycle at product ${productId}`);
  }
  const next = new Set(visited);
  next.add(productId);

  const product = await client.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error('Product not found');

  const layers = await client.costLayer.findMany({
    where: {
      productId,
      qtyRemaining: { gt: 0 },
      ...(warehouseId ? { warehouseId } : {}),
    },
    select: { qtyRemaining: true, functionalUnitCost: true },
  });

  let fifoUnitCost = Number(product.costPrice);
  if (layers.length > 0) {
    const totalQty = layers.reduce((s, l) => s + l.qtyRemaining, 0);
    const totalCost = layers.reduce((s, l) => s + l.qtyRemaining * Number(l.functionalUnitCost), 0);
    if (totalQty > 0) fifoUnitCost = totalCost / totalQty;
  }

  const activeBom = await client.billOfMaterials.findFirst({
    where: { productId, isActive: true, archivedAt: null },
    include: { lines: { include: { componentProduct: true } } },
  });

  // Sub-assemblies in stock: use FIFO of the sub-assembly itself (already includes labor/overhead from prior production).
  // If no FIFO layers and product has a BOM, recurse to estimate.
  if (!activeBom) {
    return {
      productId,
      sku: product.sku,
      name: product.name,
      isLeaf: true,
      qtyPer: 1,
      unitCost: fifoUnitCost,
      labor: 0,
      overhead: 0,
      lineCost: fifoUnitCost,
      components: [],
    };
  }

  // For BOM nodes: if there is FIFO stock of the parent, prefer it (fully baked cost).
  // Otherwise, recurse and add labor + overhead.
  if (layers.length > 0) {
    return {
      productId,
      sku: product.sku,
      name: product.name,
      isLeaf: false,
      qtyPer: 1,
      unitCost: fifoUnitCost,
      labor: 0,
      overhead: 0,
      lineCost: fifoUnitCost,
      components: [], // collapsed: in-stock FIFO already reflects historical components
      collapsedReason: 'FIFO stock available; using weighted-avg layer cost',
    };
  }

  const components = [];
  let componentTotal = 0;
  for (const line of activeBom.lines) {
    const child = await rollupFifoCost(line.componentProductId, warehouseId, {
      visited: next,
      client,
    });
    const qtyPer = Number(line.qtyPer) * (1 + Number(line.scrapFactorPct) / 100);
    const lineCost = qtyPer * child.unitCost;
    componentTotal += lineCost;
    components.push({ ...child, qtyPer, lineCost });
  }

  const labor = Number(product.standardLaborCost);
  const overhead = Number(product.standardOverheadCost);
  const unitCost = componentTotal + labor + overhead;

  return {
    productId,
    sku: product.sku,
    name: product.name,
    isLeaf: false,
    qtyPer: 1,
    unitCost,
    labor,
    overhead,
    lineCost: unitCost,
    components,
  };
}

module.exports = {
  explodeBom,
  validateBom,
  cloneBom,
  activateBom,
  rollupStandardCost,
  rollupFifoCost,
};
