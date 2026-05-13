const prisma = require('../lib/prisma');
const { getInventoryValuation } = require('../services/fifo.service');
const { logEvent } = require('../services/audit.service');
const { recordMovement, binMove } = require('../services/stock.service');

function pickWarehouseData(body) {
  return {
    code: body.code,
    name: body.name,
    address: body.address || null,
    country: body.country || null,
    currency: body.currency || 'USD',
    taxJurisdiction: body.taxJurisdiction || null,
  };
}

function nextDocNumber(prefix) {
  return `${prefix}-${Date.now()}`;
}

async function listWarehouses(_req, res) {
  const warehouses = await prisma.warehouse.findMany({
    where: { isActive: true },
    orderBy: { code: 'asc' },
  });
  res.json(warehouses);
}

async function getWarehouse(req, res) {
  const warehouse = await prisma.warehouse.findFirst({
    where: { id: req.params.id, isActive: true },
    include: {
      stockLevels: {
        include: {
          product: { select: { id: true, sku: true, name: true, uom: true, reorderPoint: true } },
        },
      },
    },
  });
  if (!warehouse) return res.status(404).json({ error: 'Warehouse not found' });
  res.json(warehouse);
}

async function createWarehouse(req, res) {
  const data = pickWarehouseData(req.body);
  if (!data.code || !data.name) {
    return res.status(400).json({ error: 'Warehouse code and name are required' });
  }

  const existing = await prisma.warehouse.findUnique({ where: { code: data.code } });
  if (existing) return res.status(409).json({ error: 'Warehouse code already exists' });

  const warehouse = await prisma.warehouse.create({ data });
  await logEvent({
    eventType: 'WAREHOUSE_CREATED',
    entityType: 'Warehouse',
    entityId: warehouse.id,
    actorId: req.user?.id,
    payload: { after: warehouse },
    sourceIp: req.ip,
  });
  res.status(201).json(warehouse);
}

async function updateWarehouse(req, res) {
  const before = await prisma.warehouse.findUnique({ where: { id: req.params.id } });
  if (!before || !before.isActive) return res.status(404).json({ error: 'Warehouse not found' });

  const data = pickWarehouseData({ ...before, ...req.body });
  if (!data.code || !data.name) {
    return res.status(400).json({ error: 'Warehouse code and name are required' });
  }

  const codeOwner = await prisma.warehouse.findUnique({ where: { code: data.code } });
  if (codeOwner && codeOwner.id !== req.params.id) {
    return res.status(409).json({ error: 'Warehouse code already exists' });
  }

  const warehouse = await prisma.warehouse.update({
    where: { id: req.params.id },
    data,
  });
  await logEvent({
    eventType: 'WAREHOUSE_UPDATED',
    entityType: 'Warehouse',
    entityId: warehouse.id,
    actorId: req.user?.id,
    payload: { before, after: warehouse },
    sourceIp: req.ip,
  });
  res.json(warehouse);
}

async function deactivateWarehouse(req, res) {
  const before = await prisma.warehouse.findUnique({ where: { id: req.params.id } });
  if (!before || !before.isActive) return res.status(404).json({ error: 'Warehouse not found' });

  const warehouse = await prisma.warehouse.update({
    where: { id: req.params.id },
    data: { isActive: false },
  });
  await logEvent({
    eventType: 'WAREHOUSE_DEACTIVATED',
    entityType: 'Warehouse',
    entityId: warehouse.id,
    actorId: req.user?.id,
    payload: { before, after: warehouse },
    sourceIp: req.ip,
  });
  res.status(204).send();
}

async function listZones(req, res) {
  const zones = await prisma.warehouseZone.findMany({
    where: { warehouseId: req.params.warehouseId, isActive: true },
    include: { bins: { where: { isActive: true }, orderBy: { code: 'asc' } } },
    orderBy: { code: 'asc' },
  });
  res.json(zones);
}

async function createZone(req, res) {
  const { code, name, description } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'Zone code and name are required' });

  const zone = await prisma.warehouseZone.create({
    data: { warehouseId: req.params.warehouseId, code, name, description: description || null },
  });
  await logEvent({
    eventType: 'WAREHOUSE_ZONE_CREATED',
    entityType: 'WarehouseZone',
    entityId: zone.id,
    actorId: req.user?.id,
    payload: { after: zone },
    sourceIp: req.ip,
  });
  res.status(201).json(zone);
}

async function updateZone(req, res) {
  const before = await prisma.warehouseZone.findUnique({ where: { id: req.params.zoneId } });
  if (!before || before.warehouseId !== req.params.warehouseId || !before.isActive) {
    return res.status(404).json({ error: 'Zone not found' });
  }

  const zone = await prisma.warehouseZone.update({
    where: { id: req.params.zoneId },
    data: {
      ...(req.body.code !== undefined ? { code: req.body.code } : {}),
      ...(req.body.name !== undefined ? { name: req.body.name } : {}),
      ...(req.body.description !== undefined ? { description: req.body.description || null } : {}),
    },
  });
  await logEvent({
    eventType: 'WAREHOUSE_ZONE_UPDATED',
    entityType: 'WarehouseZone',
    entityId: zone.id,
    actorId: req.user?.id,
    payload: { before, after: zone },
    sourceIp: req.ip,
  });
  res.json(zone);
}

async function listBins(req, res) {
  const where = { isActive: true };
  if (req.query.warehouseId) where.warehouseId = req.query.warehouseId;
  if (req.query.zoneId) where.zoneId = req.query.zoneId;

  const bins = await prisma.binLocation.findMany({
    where,
    include: { warehouse: { select: { id: true, code: true, name: true } }, zone: true },
    orderBy: [{ warehouse: { code: 'asc' } }, { code: 'asc' }],
  });
  res.json(bins);
}

async function createBin(req, res) {
  const { warehouseId, zoneId, code, name, barcode, binType } = req.body;
  if (!warehouseId || !code) return res.status(400).json({ error: 'warehouseId and bin code are required' });

  const bin = await prisma.binLocation.create({
    data: {
      warehouseId,
      zoneId: zoneId || null,
      code,
      name: name || null,
      barcode: barcode || null,
      binType: binType || 'PICK',
    },
  });
  await logEvent({
    eventType: 'BIN_CREATED',
    entityType: 'BinLocation',
    entityId: bin.id,
    actorId: req.user?.id,
    payload: { after: bin },
    sourceIp: req.ip,
  });
  res.status(201).json(bin);
}

async function updateBin(req, res) {
  const before = await prisma.binLocation.findUnique({ where: { id: req.params.id } });
  if (!before || !before.isActive) return res.status(404).json({ error: 'Bin not found' });

  const bin = await prisma.binLocation.update({
    where: { id: req.params.id },
    data: {
      ...(req.body.zoneId !== undefined ? { zoneId: req.body.zoneId || null } : {}),
      ...(req.body.code !== undefined ? { code: req.body.code } : {}),
      ...(req.body.name !== undefined ? { name: req.body.name || null } : {}),
      ...(req.body.barcode !== undefined ? { barcode: req.body.barcode || null } : {}),
      ...(req.body.binType !== undefined ? { binType: req.body.binType || 'PICK' } : {}),
    },
  });
  await logEvent({
    eventType: 'BIN_UPDATED',
    entityType: 'BinLocation',
    entityId: bin.id,
    actorId: req.user?.id,
    payload: { before, after: bin },
    sourceIp: req.ip,
  });
  res.json(bin);
}

async function deactivateBin(req, res) {
  const before = await prisma.binLocation.findUnique({ where: { id: req.params.id } });
  if (!before || !before.isActive) return res.status(404).json({ error: 'Bin not found' });

  const bin = await prisma.binLocation.update({ where: { id: req.params.id }, data: { isActive: false } });
  await logEvent({
    eventType: 'BIN_DEACTIVATED',
    entityType: 'BinLocation',
    entityId: bin.id,
    actorId: req.user?.id,
    payload: { before, after: bin },
    sourceIp: req.ip,
  });
  res.status(204).send();
}

async function listStockLevels(req, res) {
  const { warehouseId, productId } = req.query;
  const where = {};
  if (warehouseId) where.warehouseId = warehouseId;
  if (productId) where.productId = productId;

  const levels = await prisma.stockLevel.findMany({
    where,
    include: {
      product: { select: { id: true, sku: true, name: true, uom: true, reorderPoint: true } },
      warehouse: { select: { id: true, code: true, name: true } },
    },
    orderBy: [{ warehouse: { code: 'asc' } }, { product: { sku: 'asc' } }],
  });
  res.json(levels);
}

async function listBinStock(req, res) {
  const where = {};
  if (req.query.warehouseId) where.warehouseId = req.query.warehouseId;
  if (req.query.binId) where.binId = req.query.binId;
  if (req.query.productId) where.productId = req.query.productId;

  const levels = await prisma.binStockLevel.findMany({
    where,
    include: {
      product: { select: { id: true, sku: true, name: true, uom: true } },
      warehouse: { select: { id: true, code: true, name: true } },
      bin: { include: { zone: true } },
    },
    orderBy: [{ warehouse: { code: 'asc' } }, { bin: { code: 'asc' } }, { product: { sku: 'asc' } }],
  });
  res.json(levels);
}

async function listLots(req, res) {
  const { expiringInDays, productId } = req.query;
  const where = { qtyRemaining: { gt: 0 } };
  if (productId) where.productId = productId;
  if (expiringInDays) {
    const cutoff = new Date(Date.now() + Number(expiringInDays) * 24 * 60 * 60 * 1000);
    where.expiryDate = { lte: cutoff };
  }

  const lots = await prisma.lot.findMany({
    where,
    include: {
      product: { select: { id: true, sku: true, name: true, uom: true } },
    },
    orderBy: { expiryDate: 'asc' },
  });
  res.json(lots);
}

async function updateLotQaStatus(req, res) {
  const { qaStatus, warehouseId, qty, notes } = req.body;
  if (!qaStatus) return res.status(400).json({ error: 'qaStatus is required' });

  const before = await prisma.lot.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: 'Lot not found' });

  const movementQty = qty === undefined || qty === null ? 0 : Number(qty);
  if (movementQty < 0 || !Number.isFinite(movementQty)) {
    return res.status(400).json({ error: 'qty must be a non-negative number' });
  }
  if (movementQty > 0 && !warehouseId) {
    return res.status(400).json({ error: 'warehouseId is required when qty is provided' });
  }

  try {
    const lot = await prisma.$transaction(async (tx) => {
      if (movementQty > 0 && qaStatus === 'QUARANTINED') {
        await recordMovement({
          productId: before.productId,
          warehouseId,
          lotId: before.id,
          qty: movementQty,
          reasonCode: 'QA_HOLD',
          sourceDocType: 'QA',
          sourceDocId: before.lotNumber,
          operatorId: req.user?.id,
          notes: notes || 'Lot moved to quarantine',
        }, tx);
        await tx.stockLevel.update({
          where: { productId_warehouseId: { productId: before.productId, warehouseId } },
          data: { quarantine: { increment: movementQty } },
        });
      }

      if (movementQty > 0 && qaStatus === 'RELEASED') {
        const stockLevel = await tx.stockLevel.findUnique({
          where: { productId_warehouseId: { productId: before.productId, warehouseId } },
        });
        if (!stockLevel || stockLevel.quarantine < movementQty) {
          throw new Error('Cannot release more stock than is currently quarantined');
        }
        await recordMovement({
          productId: before.productId,
          warehouseId,
          lotId: before.id,
          qty: movementQty,
          reasonCode: 'QA_RELEASE',
          sourceDocType: 'QA',
          sourceDocId: before.lotNumber,
          operatorId: req.user?.id,
          notes: notes || 'Lot released from quarantine',
        }, tx);
        await tx.stockLevel.update({
          where: { productId_warehouseId: { productId: before.productId, warehouseId } },
          data: { quarantine: { decrement: movementQty } },
        });
      }

      return tx.lot.update({ where: { id: before.id }, data: { qaStatus } });
    });

    await logEvent({
      eventType: 'LOT_QA_STATUS_UPDATED',
      entityType: 'Lot',
      entityId: lot.id,
      actorId: req.user?.id,
      payload: { before, after: lot, movementQty, warehouseId: warehouseId || null },
      sourceIp: req.ip,
    });
    res.json(lot);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to update lot QA status' });
  }
}

async function getValuation(req, res) {
  const { warehouseId, productId } = req.query;
  const result = await getInventoryValuation({ warehouseId, productId });
  res.json(result);
}

async function listMovements(req, res) {
  const { productId, warehouseId, limit = 50 } = req.query;
  const where = {};
  if (productId) where.productId = productId;
  if (warehouseId) where.warehouseId = warehouseId;

  const movements = await prisma.stockMovement.findMany({
    where,
    take: Number(limit),
    orderBy: { createdAt: 'desc' },
    include: {
      product: { select: { id: true, sku: true, name: true, uom: true } },
      warehouse: { select: { id: true, code: true, name: true } },
      lot: { select: { id: true, lotNumber: true } },
    },
  });
  res.json(movements);
}

async function adjustStock(req, res) {
  const { productId, warehouseId, binId, lotId, qty, notes } = req.body;
  const numericQty = Number(qty);

  if (!productId || !warehouseId || !Number.isFinite(numericQty) || numericQty === 0) {
    return res.status(400).json({ error: 'productId, warehouseId, and non-zero qty are required' });
  }

  try {
    const movement = await recordMovement({
      productId,
      warehouseId,
      binId: binId || null,
      lotId: lotId || null,
      qty: numericQty,
      reasonCode: 'ADJUSTMENT',
      sourceDocType: 'MANUAL',
      sourceDocId: `ADJ-${Date.now()}`,
      operatorId: req.user?.id,
      notes: notes || null,
    });
    await logEvent({
      eventType: 'STOCK_ADJUSTED',
      entityType: 'StockMovement',
      entityId: movement.id,
      actorId: req.user?.id,
      payload: { productId, warehouseId, binId: binId || null, lotId: lotId || null, qty: numericQty, notes: notes || null },
      sourceIp: req.ip,
    });
    res.status(201).json(movement);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to adjust stock' });
  }
}

async function lookupBarcode(req, res) {
  const code = (req.query.code || '').trim();
  if (!code) return res.status(400).json({ error: 'code query param is required' });

  // 1. Bin barcode
  const bin = await prisma.binLocation.findFirst({
    where: { barcode: code, isActive: true },
    include: {
      warehouse: { select: { id: true, code: true, name: true } },
      zone: { select: { id: true, code: true, name: true } },
    },
  });
  if (bin) return res.json({ type: 'BIN', entity: bin });

  // 2. Product SKU or GTIN
  const product = await prisma.product.findFirst({
    where: { OR: [{ sku: code }, { gtin: code }], isActive: true, deletedAt: null },
    include: { category: { select: { id: true, name: true } } },
  });
  if (product) return res.json({ type: 'PRODUCT', entity: product });

  // 3. Lot number
  const lot = await prisma.lot.findFirst({
    where: { lotNumber: code },
    include: {
      product: { select: { id: true, sku: true, name: true, uom: true } },
      currentBin: { select: { id: true, code: true } },
    },
  });
  if (lot) return res.json({ type: 'LOT', entity: lot });

  return res.status(404).json({ error: `No bin, product, or lot matched "${code}"` });
}

async function moveBetweenBins(req, res) {
  const { productId, warehouseId, fromBinId, toBinId, lotId, qty, notes } = req.body;
  const numericQty = Number(qty);
  if (!productId || !warehouseId || !fromBinId || !toBinId || !Number.isFinite(numericQty) || numericQty <= 0) {
    return res.status(400).json({ error: 'productId, warehouseId, fromBinId, toBinId and positive qty are required' });
  }
  if (fromBinId === toBinId) {
    return res.status(400).json({ error: 'Source and destination bins must differ' });
  }
  try {
    const result = await binMove({
      productId,
      warehouseId,
      fromBinId,
      toBinId,
      lotId: lotId || null,
      qty: numericQty,
      operatorId: req.user?.id,
      notes: notes || null,
    });
    await logEvent({
      eventType: 'BIN_MOVE',
      entityType: 'StockMovement',
      entityId: result.outMove.id,
      actorId: req.user?.id,
      payload: { productId, warehouseId, fromBinId, toBinId, lotId: lotId || null, qty: numericQty, notes: notes || null },
      sourceIp: req.ip,
    });
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to move stock between bins' });
  }
}

async function listTransfers(_req, res) {
  const transfers = await prisma.stockTransfer.findMany({
    include: {
      sourceWarehouse: { select: { id: true, code: true, name: true } },
      destinationWarehouse: { select: { id: true, code: true, name: true } },
      lines: { include: { product: { select: { id: true, sku: true, name: true, uom: true } }, lot: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(transfers);
}

async function createTransfer(req, res) {
  const { sourceWarehouseId, destinationWarehouseId, notes, lines = [] } = req.body;
  if (!sourceWarehouseId || !destinationWarehouseId || sourceWarehouseId === destinationWarehouseId) {
    return res.status(400).json({ error: 'Distinct source and destination warehouses are required' });
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: 'At least one transfer line is required' });
  }
  const invalidLine = lines.find((line) => !line.productId || !Number.isFinite(Number(line.qtyRequested)) || Number(line.qtyRequested) <= 0);
  if (invalidLine) return res.status(400).json({ error: 'Each transfer line requires productId and positive qtyRequested' });

  const transfer = await prisma.stockTransfer.create({
    data: {
      transferNumber: nextDocNumber('TRF'),
      sourceWarehouseId,
      destinationWarehouseId,
      notes: notes || null,
      requestedById: req.user?.id,
      lines: {
        create: lines.map((line) => ({
          productId: line.productId,
          lotId: line.lotId || null,
          sourceBinId: line.sourceBinId || null,
          destinationBinId: line.destinationBinId || null,
          qtyRequested: Number(line.qtyRequested),
        })),
      },
    },
    include: { lines: true },
  });
  await logEvent({
    eventType: 'STOCK_TRANSFER_CREATED',
    entityType: 'StockTransfer',
    entityId: transfer.id,
    actorId: req.user?.id,
    payload: { after: transfer },
    sourceIp: req.ip,
  });
  res.status(201).json(transfer);
}

async function shipTransfer(req, res) {
  const transfer = await prisma.stockTransfer.findUnique({ where: { id: req.params.id }, include: { lines: true } });
  if (!transfer) return res.status(404).json({ error: 'Transfer not found' });
  if (transfer.status !== 'DRAFT') return res.status(409).json({ error: 'Only draft transfers can be shipped' });

  // Optional per-line overrides: { lines: [{ lineId, qtyShipped }] }. Defaults to qtyRequested.
  const lineOverrides = Array.isArray(req.body && req.body.lines)
    ? new Map(req.body.lines.map((l) => [l.lineId, Number(l.qtyShipped)]))
    : new Map();

  try {
    const result = await prisma.$transaction(async (tx) => {
      for (const line of transfer.lines) {
        const qtyShipped = lineOverrides.has(line.id)
          ? lineOverrides.get(line.id)
          : line.qtyRequested;
        if (!Number.isFinite(qtyShipped) || qtyShipped <= 0) continue;
        await recordMovement({
          productId: line.productId,
          warehouseId: transfer.sourceWarehouseId,
          binId: line.sourceBinId,
          lotId: line.lotId,
          qty: -qtyShipped,
          reasonCode: 'TRANSFER',
          sourceDocType: 'TRANSFER',
          sourceDocId: transfer.transferNumber,
          operatorId: req.user?.id,
          notes: `Transfer shipped to warehouse ${transfer.destinationWarehouseId}`,
        }, tx);
        await tx.stockTransferLine.update({ where: { id: line.id }, data: { qtyShipped } });
      }
      return tx.stockTransfer.update({
        where: { id: transfer.id },
        data: { status: 'IN_TRANSIT', shippedAt: new Date() },
        include: { lines: { include: { product: { select: { id: true, sku: true, name: true, uom: true } } } } },
      });
    });
    await logEvent({
      eventType: 'STOCK_TRANSFER_SHIPPED',
      entityType: 'StockTransfer',
      entityId: result.id,
      actorId: req.user?.id,
      payload: { after: result },
      sourceIp: req.ip,
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to ship transfer' });
  }
}

async function receiveTransfer(req, res) {
  const transfer = await prisma.stockTransfer.findUnique({ where: { id: req.params.id }, include: { lines: true } });
  if (!transfer) return res.status(404).json({ error: 'Transfer not found' });
  if (!['IN_TRANSIT', 'PARTIALLY_RECEIVED'].includes(transfer.status)) {
    return res.status(409).json({ error: 'Only in-transit or partially-received transfers can be received' });
  }

  // Optional per-line overrides: { lines: [{ lineId, qtyReceived }] }. Defaults to full remaining qty.
  const lineOverrides = Array.isArray(req.body && req.body.lines)
    ? new Map(req.body.lines.map((l) => [l.lineId, Number(l.qtyReceived)]))
    : new Map();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const finalLines = [];
      for (const line of transfer.lines) {
        const remaining = line.qtyShipped - line.qtyReceived;
        if (remaining <= 0) {
          finalLines.push(line);
          continue;
        }
        const toReceive = lineOverrides.has(line.id)
          ? Math.min(Math.max(0, lineOverrides.get(line.id)), remaining)
          : remaining;
        if (toReceive <= 0) {
          finalLines.push(line);
          continue;
        }
        await recordMovement({
          productId: line.productId,
          warehouseId: transfer.destinationWarehouseId,
          binId: line.destinationBinId,
          lotId: line.lotId,
          qty: toReceive,
          reasonCode: 'TRANSFER',
          sourceDocType: 'TRANSFER',
          sourceDocId: transfer.transferNumber,
          operatorId: req.user?.id,
          notes: `Transfer received from warehouse ${transfer.sourceWarehouseId}`,
        }, tx);
        const updated = await tx.stockTransferLine.update({
          where: { id: line.id },
          data: { qtyReceived: line.qtyReceived + toReceive },
        });
        finalLines.push(updated);
      }
      const allReceived = finalLines.every((l) => l.qtyReceived >= l.qtyShipped);
      const newStatus = allReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
      return tx.stockTransfer.update({
        where: { id: transfer.id },
        data: { status: newStatus, receivedAt: allReceived ? new Date() : null },
        include: { lines: { include: { product: { select: { id: true, sku: true, name: true, uom: true } } } } },
      });
    });
    await logEvent({
      eventType: 'STOCK_TRANSFER_RECEIVED',
      entityType: 'StockTransfer',
      entityId: result.id,
      actorId: req.user?.id,
      payload: { status: result.status, after: result },
      sourceIp: req.ip,
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to receive transfer' });
  }
}

async function listCycleCounts(req, res) {
  const where = {};
  if (req.query.warehouseId) where.warehouseId = req.query.warehouseId;
  if (req.query.status) where.status = req.query.status;

  const counts = await prisma.cycleCount.findMany({
    where,
    include: {
      warehouse: { select: { id: true, code: true, name: true } },
      lines: { include: { product: { select: { id: true, sku: true, name: true, uom: true } }, bin: true, lot: true } },
    },
    orderBy: { startedAt: 'desc' },
  });
  res.json(counts);
}

async function createCycleCount(req, res) {
  const { warehouseId, productIds, notes } = req.body;
  if (!warehouseId) return res.status(400).json({ error: 'warehouseId is required' });

  const stockWhere = { warehouseId };
  if (Array.isArray(productIds) && productIds.length > 0) stockWhere.productId = { in: productIds };

  const stockLevels = await prisma.stockLevel.findMany({ where: stockWhere });
  if (stockLevels.length === 0) return res.status(400).json({ error: 'No stock positions found for cycle count' });

  const cycleCount = await prisma.cycleCount.create({
    data: {
      countNumber: nextDocNumber('CC'),
      warehouseId,
      startedById: req.user?.id,
      notes: notes || null,
      lines: {
        create: stockLevels.map((level) => ({
          productId: level.productId,
          expectedQty: level.onHand,
        })),
      },
    },
    include: { lines: true },
  });
  await logEvent({
    eventType: 'CYCLE_COUNT_CREATED',
    entityType: 'CycleCount',
    entityId: cycleCount.id,
    actorId: req.user?.id,
    payload: { after: cycleCount },
    sourceIp: req.ip,
  });
  res.status(201).json(cycleCount);
}

async function updateCycleCountLine(req, res) {
  const { countedQty, notes } = req.body;
  const numericCountedQty = Number(countedQty);
  if (!Number.isFinite(numericCountedQty) || numericCountedQty < 0) {
    return res.status(400).json({ error: 'countedQty must be a non-negative number' });
  }

  const line = await prisma.cycleCountLine.findUnique({
    where: { id: req.params.lineId },
    include: { cycleCount: true },
  });
  if (!line || line.cycleCountId !== req.params.id) return res.status(404).json({ error: 'Cycle count line not found' });
  if (line.cycleCount.status !== 'OPEN') return res.status(409).json({ error: 'Only open cycle counts can be edited' });

  const updated = await prisma.cycleCountLine.update({
    where: { id: req.params.lineId },
    data: {
      countedQty: numericCountedQty,
      varianceQty: numericCountedQty - line.expectedQty,
      notes: notes || null,
      countedAt: new Date(),
    },
  });
  res.json(updated);
}

async function postCycleCount(req, res) {
  const cycleCount = await prisma.cycleCount.findUnique({
    where: { id: req.params.id },
    include: { lines: true },
  });
  if (!cycleCount) return res.status(404).json({ error: 'Cycle count not found' });
  if (cycleCount.status !== 'OPEN') return res.status(409).json({ error: 'Only open cycle counts can be posted' });
  if (cycleCount.lines.some((line) => line.countedQty === null)) {
    return res.status(400).json({ error: 'All cycle count lines must be counted before posting' });
  }

  const result = await prisma.$transaction(async (tx) => {
    for (const line of cycleCount.lines) {
      if (!line.varianceQty) continue;
      await recordMovement({
        productId: line.productId,
        warehouseId: cycleCount.warehouseId,
        binId: line.binId,
        lotId: line.lotId,
        qty: line.varianceQty,
        reasonCode: 'ADJUSTMENT',
        sourceDocType: 'CYCLE_COUNT',
        sourceDocId: cycleCount.countNumber,
        operatorId: req.user?.id,
        notes: line.notes || `Cycle count variance ${line.varianceQty}`,
      }, tx);
    }

    return tx.cycleCount.update({
      where: { id: cycleCount.id },
      data: { status: 'POSTED', postedAt: new Date(), postedById: req.user?.id },
      include: { lines: true },
    });
  });
  await logEvent({
    eventType: 'CYCLE_COUNT_POSTED',
    entityType: 'CycleCount',
    entityId: result.id,
    actorId: req.user?.id,
    payload: { after: result },
    sourceIp: req.ip,
  });
  res.json(result);
}

async function getAlerts(req, res) {
  const now = new Date();
  const in90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  // Expiry alerts — lots expiring within 90 days (incl. already expired)
  const expiringLots = await prisma.lot.findMany({
    where: {
      expiryDate: { lte: in90Days },
      qtyRemaining: { gt: 0 },
    },
    include: {
      product: { select: { id: true, sku: true, name: true, uom: true } },
      currentBin: { select: { id: true, code: true } },
    },
    orderBy: { expiryDate: 'asc' },
  });

  const expiryAlerts = expiringLots.map((lot) => {
    const daysLeft = Math.ceil((new Date(lot.expiryDate).getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    let severity;
    if (daysLeft < 0) severity = 'EXPIRED';
    else if (daysLeft < 30) severity = 'CRITICAL';
    else if (daysLeft < 60) severity = 'WARNING';
    else severity = 'WATCH';
    return { type: 'EXPIRY', severity, daysLeft, lot, product: lot.product };
  });

  // Zero-stock alerts — active products with at least one warehouse at 0 on-hand
  const zeroStockLevels = await prisma.stockLevel.findMany({
    where: { onHand: { lte: 0 } },
    include: {
      product: { select: { id: true, sku: true, name: true, uom: true, reorderPoint: true, isActive: true } },
      warehouse: { select: { id: true, code: true, name: true } },
    },
  });

  const zeroStockAlerts = zeroStockLevels
    .filter((sl) => sl.product?.isActive)
    .map((sl) => ({ type: 'ZERO_STOCK', severity: 'CRITICAL', stockLevel: sl, product: sl.product, warehouse: sl.warehouse }));

  res.json({ expiryAlerts, zeroStockAlerts, summary: { expiry: expiryAlerts.length, zeroStock: zeroStockAlerts.length } });
}

/**
 * Persist alerts to the Alert model idempotently.
 * Strategy: for each detected condition, upsert by (type, productId, [supplierId], status=OPEN).
 * Closes (RESOLVED) alerts whose underlying condition no longer holds.
 */
async function scanAlerts(req, res) {
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const in60 = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  const in90 = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const openAlerts = await prisma.alert.findMany({ where: { status: 'OPEN' } });
  const openByKey = new Map(openAlerts.map((a) => [`${a.type}:${a.productId ?? ''}:${(a.payload && a.payload.lotId) || ''}`, a]));
  const stillActive = new Set();

  async function upsertAlert({ type, severity, productId, payload, reasoning }) {
    const key = `${type}:${productId ?? ''}:${payload.lotId || ''}`;
    stillActive.add(key);
    if (openByKey.has(key)) {
      // Update severity / payload / reasoning if changed
      const existing = openByKey.get(key);
      if (existing.severity !== severity || JSON.stringify(existing.payload) !== JSON.stringify(payload)) {
        await prisma.alert.update({ where: { id: existing.id }, data: { severity, payload, reasoning } });
      }
      return;
    }
    await prisma.alert.create({ data: { type, severity, productId: productId ?? null, payload, reasoning, status: 'OPEN' } });
  }

  // 1. Expiry alerts
  const lots = await prisma.lot.findMany({
    where: { expiryDate: { lte: in90 }, qtyRemaining: { gt: 0 } },
    include: { product: { select: { id: true, sku: true, name: true } } },
  });
  for (const lot of lots) {
    const daysLeft = Math.ceil((new Date(lot.expiryDate).getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    let severity, type;
    if (daysLeft < 0) { severity = 'CRITICAL'; type = 'EXPIRY'; }
    else if (daysLeft < 30) { severity = 'HIGH'; type = 'EXPIRY'; }
    else if (daysLeft < 60) { severity = 'MEDIUM'; type = 'EXPIRY'; }
    else { severity = 'LOW'; type = 'EXPIRY'; }
    await upsertAlert({
      type,
      severity,
      productId: lot.productId,
      payload: { lotId: lot.id, lotNumber: lot.lotNumber, qtyRemaining: lot.qtyRemaining, expiryDate: lot.expiryDate, daysLeft },
      reasoning: daysLeft < 0
        ? `Lot ${lot.lotNumber} expired ${Math.abs(daysLeft)} days ago (${lot.qtyRemaining} units remain).`
        : `Lot ${lot.lotNumber} expires in ${daysLeft} days (${lot.qtyRemaining} units).`,
    });
  }

  // 2. Low stock — onHand <= reorderPoint
  const stockLevels = await prisma.stockLevel.findMany({
    include: { product: { select: { id: true, sku: true, name: true, reorderPoint: true, isActive: true } }, warehouse: { select: { code: true } } },
  });
  for (const sl of stockLevels) {
    if (!sl.product?.isActive || sl.product.reorderPoint == null) continue;
    if (sl.onHand > sl.product.reorderPoint) continue;
    const severity = sl.onHand <= 0 ? 'CRITICAL' : sl.onHand < sl.product.reorderPoint / 2 ? 'HIGH' : 'MEDIUM';
    await upsertAlert({
      type: 'STOCKOUT_RISK',
      severity,
      productId: sl.productId,
      payload: { warehouseCode: sl.warehouse.code, onHand: sl.onHand, reorderPoint: sl.product.reorderPoint, lotId: `wh-${sl.warehouseId}` },
      reasoning: `${sl.product.sku} at ${sl.warehouse.code}: ${sl.onHand} on hand vs reorder point ${sl.product.reorderPoint}.`,
    });
  }

  // 3. QA quarantine
  const quarantined = await prisma.lot.findMany({
    where: { qaStatus: 'QUARANTINED', qtyRemaining: { gt: 0 } },
    include: { product: { select: { id: true, sku: true, name: true } } },
  });
  for (const lot of quarantined) {
    await upsertAlert({
      type: 'DEAD_STOCK',
      severity: 'MEDIUM',
      productId: lot.productId,
      payload: { lotId: lot.id, lotNumber: lot.lotNumber, qtyRemaining: lot.qtyRemaining, reason: 'QA_QUARANTINE' },
      reasoning: `Lot ${lot.lotNumber} (${lot.qtyRemaining} units of ${lot.product.sku}) is on QA quarantine.`,
    });
  }

  // 4. Auto-resolve alerts whose condition no longer holds
  for (const [key, alert] of openByKey.entries()) {
    if (!stillActive.has(key) && ['EXPIRY', 'STOCKOUT_RISK', 'DEAD_STOCK'].includes(alert.type)) {
      await prisma.alert.update({ where: { id: alert.id }, data: { status: 'RESOLVED' } });
    }
  }

  const total = await prisma.alert.count({ where: { status: 'OPEN' } });
  await logEvent({ eventType: 'ALERTS_SCANNED', entityType: 'Alert', actorId: req?.user?.id, payload: { openCount: total }, sourceIp: req?.ip });
  if (res) res.json({ ok: true, openCount: total });
  return total;
}

async function listOpenAlerts(req, res) {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const alerts = await prisma.alert.findMany({
    where: { status: 'OPEN' },
    take: limit,
    orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
  });
  const productIds = [...new Set(alerts.map((alert) => alert.productId).filter(Boolean))];
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, sku: true, name: true },
      })
    : [];
  const productById = new Map(products.map((product) => [product.id, product]));
  const alertsWithProducts = alerts.map((alert) => ({
    ...alert,
    product: alert.productId ? productById.get(alert.productId) ?? null : null,
  }));
  const counts = await prisma.alert.groupBy({ by: ['severity'], where: { status: 'OPEN' }, _count: { _all: true } });
  res.json({ alerts: alertsWithProducts, counts: Object.fromEntries(counts.map((c) => [c.severity, c._count._all])), total: alerts.length });
}

async function acknowledgeAlert(req, res) {
  const alert = await prisma.alert.findUnique({ where: { id: req.params.id } });
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  const updated = await prisma.alert.update({
    where: { id: alert.id },
    data: { status: 'ACKNOWLEDGED', acknowledgedById: req.user?.id, acknowledgedAt: new Date() },
  });
  res.json(updated);
}

async function getReorderRecommendations(req, res) {
  // Find all StockLevel rows where onHand <= product.reorderPoint
  // Join to product to get reorderPoint, reorderQty, sku, name, and preferred supplier
  const rows = await prisma.stockLevel.findMany({
    include: {
      product: {
        include: {
          supplierProducts: {
            orderBy: { priority: 'asc' },
            take: 1,
            include: { supplier: { select: { id: true, code: true, name: true } } },
          },
          category: { select: { id: true, name: true } },
        },
      },
      warehouse: { select: { id: true, code: true, name: true, country: true, currency: true } },
    },
    orderBy: [{ onHand: 'asc' }],
  });

  // Filter to only those at or below reorder point
  const recommendations = rows.filter((row) => {
    const rp = row.product?.reorderPoint;
    return rp !== null && rp !== undefined && row.onHand <= rp;
  }).map((row) => ({
    productId: row.productId,
    warehouseId: row.warehouseId,
    product: row.product,
    warehouse: row.warehouse,
    onHand: row.onHand,
    reorderPoint: row.product?.reorderPoint,
    reorderQty: row.product?.reorderQty,
    suggestedSupplier: row.product?.supplierProducts?.[0]?.supplier ?? null,
    suggestedSupplierProduct: row.product?.supplierProducts?.[0] ?? null,
    shortfall: (row.product?.reorderPoint ?? 0) - row.onHand,
  }));

  res.json(recommendations);
}

/**
 * Persist reorder recommendations to the ReorderRecommendation model.
 * Idempotent: avoids duplicating PENDING rows for same productId.
 */
async function generateReorderRecommendations(req, res) {
  const stockLevels = await prisma.stockLevel.findMany({
    include: {
      product: {
        include: {
          supplierProducts: { orderBy: { priority: 'asc' }, take: 1, include: { supplier: true } },
        },
      },
    },
  });

  // Aggregate per product (sum on-hand across warehouses)
  const byProduct = new Map();
  for (const sl of stockLevels) {
    if (!sl.product?.isActive || sl.product.reorderPoint == null) continue;
    const cur = byProduct.get(sl.productId) || { product: sl.product, totalOnHand: 0 };
    cur.totalOnHand += sl.onHand;
    byProduct.set(sl.productId, cur);
  }

  const existingPending = await prisma.reorderRecommendation.findMany({ where: { status: 'PENDING' } });
  const pendingByProduct = new Set(existingPending.map((r) => r.productId));

  let created = 0;
  for (const [productId, { product, totalOnHand }] of byProduct.entries()) {
    if (totalOnHand > product.reorderPoint) continue;
    if (pendingByProduct.has(productId)) continue;

    const supplierLink = product.supplierProducts?.[0];
    const shortfall = product.reorderPoint - totalOnHand;
    let urgency = 'LOW';
    if (totalOnHand <= 0) urgency = 'CRITICAL';
    else if (totalOnHand < product.reorderPoint / 4) urgency = 'HIGH';
    else if (totalOnHand < product.reorderPoint / 2) urgency = 'MEDIUM';

    await prisma.reorderRecommendation.create({
      data: {
        productId,
        suggestedQty: product.reorderQty || shortfall,
        targetSupplierId: supplierLink?.supplierId || null,
        urgency,
        reasoning: {
          totalOnHand,
          reorderPoint: product.reorderPoint,
          shortfall,
          supplierName: supplierLink?.supplier?.name || null,
          leadTimeDays: supplierLink?.supplier?.leadTimeDays || null,
        },
        status: 'PENDING',
      },
    });
    created++;
  }

  await logEvent({ eventType: 'REORDER_GENERATED', entityType: 'ReorderRecommendation', actorId: req.user?.id, payload: { created }, sourceIp: req.ip });
  res.json({ created, totalPending: existingPending.length + created });
}

async function listSavedReorderRecommendations(req, res) {
  const { status = 'PENDING' } = req.query;
  const rows = await prisma.reorderRecommendation.findMany({
    where: { status },
    orderBy: [{ urgency: 'desc' }, { createdAt: 'desc' }],
    include: { product: { select: { id: true, sku: true, name: true, uom: true, reorderPoint: true } } },
  });
  res.json(rows);
}

async function dismissReorderRecommendation(req, res) {
  const rec = await prisma.reorderRecommendation.findUnique({ where: { id: req.params.id } });
  if (!rec) return res.status(404).json({ error: 'Recommendation not found' });
  const updated = await prisma.reorderRecommendation.update({ where: { id: rec.id }, data: { status: 'DISMISSED' } });
  await logEvent({ eventType: 'REORDER_DISMISSED', entityType: 'ReorderRecommendation', entityId: rec.id, actorId: req.user?.id, sourceIp: req.ip });
  res.json(updated);
}

async function cancelCycleCount(req, res) {
  const count = await prisma.cycleCount.findUnique({ where: { id: req.params.id } });
  if (!count) return res.status(404).json({ error: 'Cycle count not found' });
  if (count.status !== 'OPEN') return res.status(409).json({ error: 'Only OPEN cycle counts can be cancelled' });

  const updated = await prisma.cycleCount.update({
    where: { id: count.id },
    data: { status: 'CANCELLED' },
  });
  await logEvent({
    eventType: 'CYCLE_COUNT_CANCELLED',
    entityType: 'CycleCount',
    entityId: updated.id,
    actorId: req.user?.id,
    payload: { after: updated },
    sourceIp: req.ip,
  });
  res.json(updated);
}

module.exports = {
  listWarehouses,
  getWarehouse,
  createWarehouse,
  updateWarehouse,
  deactivateWarehouse,
  listZones,
  createZone,
  updateZone,
  listBins,
  createBin,
  updateBin,
  deactivateBin,
  listStockLevels,
  listBinStock,
  listLots,
  updateLotQaStatus,
  getValuation,
  listMovements,
  adjustStock,
  moveBetweenBins,
  lookupBarcode,
  listTransfers,
  createTransfer,
  shipTransfer,
  receiveTransfer,
  listCycleCounts,
  createCycleCount,
  updateCycleCountLine,
  postCycleCount,
  cancelCycleCount,
  getReorderRecommendations,
  getAlerts,
  reportStockSnapshot,
  reportMovementHistory,
  reportValuationSummary,
  getSummary,
  scanAlerts,
  listOpenAlerts,
  acknowledgeAlert,
  generateReorderRecommendations,
  listSavedReorderRecommendations,
  dismissReorderRecommendation,
};

async function getSummary(req, res) {
  const now = new Date();
  const in90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const [totalSkus, valuation, stockLevels, expiringLots, quarantinedLots, openTransfers, openCounts] = await Promise.all([
    prisma.product.count({ where: { isActive: true } }),
    getInventoryValuation({}),
    prisma.stockLevel.findMany({ include: { product: { select: { reorderPoint: true, isActive: true } } } }),
    prisma.lot.count({ where: { expiryDate: { lte: in90Days, gte: now }, qtyRemaining: { gt: 0 } } }),
    prisma.lot.aggregate({ where: { qaStatus: 'QUARANTINED' }, _sum: { qtyRemaining: true } }),
    prisma.stockTransfer.count({ where: { status: { in: ['DRAFT', 'IN_TRANSIT', 'PARTIALLY_RECEIVED'] } } }),
    prisma.cycleCount.count({ where: { status: 'OPEN' } }),
  ]);

  const lowStockCount = stockLevels.filter((s) => s.product?.isActive && s.product.reorderPoint != null && s.onHand <= s.product.reorderPoint).length;

  res.json({
    totalSkus,
    totalValue: valuation.totalValue,
    lowStockCount,
    expiringSoonCount: expiringLots,
    quarantinedQty: quarantinedLots._sum.qtyRemaining || 0,
    openTransfers,
    openCycleCounts: openCounts,
  });
}

// ---------------------------------------------------------------------------
// Report helpers
// ---------------------------------------------------------------------------

function toCsvRow(values) {
  return values
    .map((v) => {
      const s = v == null ? '' : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(',');
}

async function reportStockSnapshot(req, res) {
  const { warehouseId, format = 'json' } = req.query;
  const where = {};
  if (warehouseId) where.warehouseId = warehouseId;

  const rows = await prisma.stockLevel.findMany({
    where,
    include: {
      product: { select: { id: true, sku: true, name: true, uom: true, reorderPoint: true } },
      warehouse: { select: { id: true, code: true, name: true } },
    },
    orderBy: [{ warehouse: { code: 'asc' } }, { product: { sku: 'asc' } }],
  });

  if (format === 'csv') {
    const header = toCsvRow(['Warehouse Code', 'Warehouse Name', 'SKU', 'Product Name', 'UOM', 'On Hand', 'Reserved', 'Available', 'Reorder Point']);
    const lines = rows.map((r) =>
      toCsvRow([r.warehouse.code, r.warehouse.name, r.product.sku, r.product.name, r.product.uom, r.onHand, r.reserved, r.onHand - r.reserved, r.product.reorderPoint ?? '']),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="stock-snapshot.csv"');
    return res.send([header, ...lines].join('\r\n'));
  }

  res.json(rows.map((r) => ({
    warehouseCode: r.warehouse.code,
    warehouseName: r.warehouse.name,
    sku: r.product.sku,
    productName: r.product.name,
    uom: r.product.uom,
    onHand: r.onHand,
    reserved: r.reserved,
    available: r.onHand - r.reserved,
    reorderPoint: r.product.reorderPoint,
  })));
}

async function reportMovementHistory(req, res) {
  const { warehouseId, productId, from, to, format = 'json' } = req.query;
  const where = {};
  if (warehouseId) where.warehouseId = warehouseId;
  if (productId) where.productId = productId;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      where.createdAt.lte = toDate;
    }
  }

  const movements = await prisma.stockMovement.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 5000,
    include: {
      product: { select: { sku: true, name: true, uom: true } },
      warehouse: { select: { code: true, name: true } },
      lot: { select: { lotNumber: true } },
    },
  });

  if (format === 'csv') {
    const header = toCsvRow(['Date', 'SKU', 'Product Name', 'Warehouse', 'Qty', 'UOM', 'Reason Code', 'Lot', 'Source Doc', 'Notes']);
    const lines = movements.map((m) =>
      toCsvRow([
        new Date(m.createdAt).toISOString(),
        m.product.sku,
        m.product.name,
        m.warehouse.code,
        m.qty,
        m.product.uom,
        m.reasonCode,
        m.lot?.lotNumber ?? '',
        m.sourceDocId ?? '',
        m.notes ?? '',
      ]),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="movement-history.csv"');
    return res.send([header, ...lines].join('\r\n'));
  }

  res.json(movements.map((m) => ({
    date: m.createdAt,
    sku: m.product.sku,
    productName: m.product.name,
    warehouse: m.warehouse.code,
    qty: m.qty,
    uom: m.product.uom,
    reasonCode: m.reasonCode,
    lot: m.lot?.lotNumber ?? null,
    sourceDoc: m.sourceDocId ?? null,
    notes: m.notes ?? null,
  })));
}

async function reportValuationSummary(req, res) {
  const { warehouseId, productId, format = 'json' } = req.query;
  const where = {};
  if (warehouseId) where.warehouseId = warehouseId;
  if (productId) where.productId = productId;

  // For each StockLevel, compute the value from live FIFO cost layers
  const levels = await prisma.stockLevel.findMany({
    where,
    include: {
      product: { select: { sku: true, name: true, uom: true } },
      warehouse: { select: { code: true, name: true } },
    },
    orderBy: [{ warehouse: { code: 'asc' } }, { product: { sku: 'asc' } }],
  });

  // Aggregate cost layers per product+warehouse
  const layerWhere = { status: 'ACTIVE', qtyRemaining: { gt: 0 } };
  if (warehouseId) layerWhere.warehouseId = warehouseId;
  if (productId) layerWhere.productId = productId;
  const layers = await prisma.costLayer.findMany({ where: layerWhere });

  const costMap = {};
  for (const l of layers) {
    const key = `${l.productId}:${l.warehouseId}`;
    if (!costMap[key]) costMap[key] = { totalQty: 0, totalCost: 0 };
    costMap[key].totalQty += l.qtyRemaining;
    costMap[key].totalCost += l.qtyRemaining * Number(l.functionalUnitCost);
  }

  const rows = levels.map((r) => {
    const key = `${r.productId}:${r.warehouseId}`;
    const c = costMap[key] || { totalQty: 0, totalCost: 0 };
    const avgUnitCost = c.totalQty > 0 ? c.totalCost / c.totalQty : 0;
    const totalValue = avgUnitCost * r.onHand;
    return {
      sku: r.product.sku,
      productName: r.product.name,
      uom: r.product.uom,
      warehouseCode: r.warehouse.code,
      warehouseName: r.warehouse.name,
      onHand: r.onHand,
      avgUnitCost: Math.round(avgUnitCost * 10000) / 10000,
      totalValue: Math.round(totalValue * 100) / 100,
    };
  });

  if (format === 'csv') {
    const header = toCsvRow(['SKU', 'Product Name', 'UOM', 'Warehouse', 'On Hand', 'Avg Unit Cost', 'Total Value']);
    const lines = rows.map((r) =>
      toCsvRow([r.sku, r.productName, r.uom, r.warehouseCode, r.onHand, r.avgUnitCost, r.totalValue]),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="valuation-summary.csv"');
    return res.send([header, ...lines].join('\r\n'));
  }

  res.json(rows);
}
