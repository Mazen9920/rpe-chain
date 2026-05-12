---
description: Instructions for the agent working on the RPE Chain backend (Developer 1 — schema, FIFO engine, controllers).
applyTo: "backend/**"
---

# Backend Agent — RPE Chain Supply OS

You are Developer 1. You own `backend/`. Stack: **Node.js + Express 4 + Prisma 5 + PostgreSQL 16 + JWT**.

## Architecture

```
src/
├── index.js              ← entry, listens on PORT
├── app.js                ← express app, routes mounted at /api/*
├── controllers/          ← request handlers (thin — delegate to services)
├── services/             ← business logic (FIFO, stock, audit)
├── routes/               ← express routers + auth middleware
├── middleware/auth.middleware.js   ← authenticate + authorize(roles)
└── lib/prisma.js         ← single PrismaClient instance
```

## Master Plan Data Model (key entities)

- **User** — `email`, `passwordHash`, `role` (enum, 6 values)
- **Warehouse** — `code`, `name`, `country`, `currency`
- **Product** — sku, name, categoryId, uom, reorderPoint, **NO stock fields** (stock is in StockLevel)
- **StockLevel** — per (productId, warehouseId): `onHand`, `reserved`, `version` (optimistic lock)
- **Lot** — productId, lotNumber, expiry, `qtyOnHand`, certifications
- **CostLayer** — append-only FIFO inventory layer: `productId`, `warehouseId`, `lotId`, `qty`, **`qtyRemaining`** (mutable), `unitCost`, `landedCostPerUnit`, `functionalUnitCost`, currency, fxRate
- **StockMovement** — append-only: `direction` (IN/OUT), `reasonCode` (RECEIPT/SHIPMENT/SCRAP/RETURN/QA_HOLD/QA_RELEASE/ADJUSTMENT), `qty`, `sourceDocType`, `sourceDocId`
- **CogsPosting** — append-only: which cost layer was depleted, qty, cogsAmount
- **PurchaseOrder** + **PurchaseOrderLine** + **GoodsReceipt** + **GoodsReceiptLine**
- **SupplierInvoice** + **ApLedgerEntry** + **Payment**
- **SalesOrder** + **SalesOrderLine** + **Shipment** + **ShipmentLine** + **TrackingEvent**
- **Forecast**, **ReorderRecommendation**, **Alert**
- **EventLog** — append-only audit trail

## The Three Core Services

### `fifoService` (`src/services/fifo.service.js`)
- `createCostLayer({ productId, warehouseId, lotId, qty, unitCost, landedCostPerUnit, currency, fxRate, poLineId })` — call on every inbound receipt
- `depleteFifo({ productId, warehouseId, qty, shipmentId, salesOrderId })` — atomic, FIFO, returns `{ totalCogs, postings, layersConsumed }`. Throws if insufficient stock.
- `reverseFifo({ ... })` — for returns; creates new layer + negative COGS posting
- `getInventoryValuation({ warehouseId?, productId? })` — sums `qtyRemaining × functionalUnitCost`

### `stockService` (`src/services/stock.service.js`)
- `recordMovement({ productId, warehouseId, lotId, qty, reasonCode, sourceDocType, sourceDocId, operatorId, notes })` — writes `StockMovement` AND updates `StockLevel` snapshot atomically. Direction is derived from reasonCode.

### `auditService` (`src/services/audit.service.js`)
- `logEvent({ eventType, entityType, entityId, actorId, payload, sourceIp })`

## Endpoint Catalog

```
POST   /api/auth/register
POST   /api/auth/login
GET    /api/auth/me

GET    /api/products
GET    /api/products/low-stock
GET    /api/products/:id
POST   /api/products
PUT    /api/products/:id
DELETE /api/products/:id

GET    /api/suppliers
GET    /api/suppliers/:id
POST   /api/suppliers
PUT    /api/suppliers/:id
DELETE /api/suppliers/:id

GET    /api/purchase-orders
GET    /api/purchase-orders/:id
POST   /api/purchase-orders
PUT    /api/purchase-orders/:id
POST   /api/purchase-orders/:id/receive   ← creates Lot + CostLayer + StockMovement

GET    /api/shipments
GET    /api/shipments/:id
POST   /api/shipments                     ← triggers fifoService.depleteFifo

GET    /api/inventory/warehouses
GET    /api/inventory/stock-levels
GET    /api/inventory/lots?expiringInDays=30
GET    /api/inventory/valuation
GET    /api/inventory/movements

GET    /api/dashboard/summary
```

## Rules

1. **Never bypass services.** Controllers call services. Services contain transactions.
2. **All money is `Decimal`.** Use `new Prisma.Decimal(x)` for inputs; call `.toNumber()` only at the JSON boundary.
3. **Wrap multi-row writes in `prisma.$transaction`.** Especially: PO receive (Lot + CostLayer + StockMovement + GoodsReceiptLine), shipment (deplete + movement + posting).
4. **Filter `deletedAt: null`** on Product/Supplier/Warehouse/Lot list queries.
5. **`authorize([...roles])`** middleware guards mutating routes. Reads can be open to authenticated users.
6. **Log audit events** for: PO receive, shipment dispatch, payment, user role change, supplier/product delete.
7. **Schema changes** → `npx prisma migrate dev --name <change>` (never edit applied SQL).
8. **Never seed via API** — use `prisma/seed.js`.

## What This Agent Does NOT Touch
- `frontend/**` (Developer 2's domain — coordinate at the API contract)
- `.github/copilot/frontend-agent.instructions.md`

## Useful Commands
```bash
npx prisma studio                      # browse DB
npx prisma migrate dev --name <name>   # new migration
npx prisma migrate reset --force       # nuke DB
node prisma/seed.js                    # reseed
npm run dev                            # nodemon
```
