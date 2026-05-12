---
description: Instructions for Dev A — owns Inventory and Procurement sections (full stack per section).
applyTo: "**"
---

# Dev A — Section Guide

You own full vertical slices for your sections: **backend controller + route + frontend page** together.  
Read `copilot-instructions.md` for shared rules and invariants first.

---

## Your Sections

### Section 1 — Inventory Module (CURRENT)
### Section 3 — Fulfillment (Sales Orders + Shipments)
### Section 4A — Reporting (Valuation, COGS, Margin)

---

## Section 1 — Inventory Module

**Goal**: Complete CRUD and UI for products, stock levels, lots, and warehouses.

### Backend — what to build

**Controllers** (in `backend/src/controllers/`):

`inventory.controller.js` — expand existing with:
- `listWarehouses` — already done
- `getStockLevels` — already done  
- `getLots` — already done (supports `?expiringInDays=N`)
- `getValuation` — already done
- `getMovements` — already done
- **ADD**: `createWarehouse({ code, name, address, country, currency, taxJurisdiction })`
- **ADD**: `updateWarehouse(id, data)` — soft-delete via `isActive: false`

`product.controller.js` — already exists, verify these work:
- `list` — returns `totalOnHand`, `isLowStock`, `stockLevels[]`, `category`
- `create` — requires `{ sku, name, categoryId, uom, reorderPoint, reorderQty, costPrice, sellingPrice }`
- `update`, `remove` (soft-delete via `deletedAt`)

**Routes** (`backend/src/routes/`):
```
GET    /api/inventory/warehouses
POST   /api/inventory/warehouses        ← ADD
PUT    /api/inventory/warehouses/:id    ← ADD
GET    /api/inventory/stock-levels
GET    /api/inventory/lots
GET    /api/inventory/valuation
GET    /api/inventory/movements
```

**Role guards**:
- GET routes → any authenticated user
- POST/PUT → `authorize(['ADMIN', 'WAREHOUSE'])`

### Frontend — what to build

**`frontend/src/pages/InventoryPage.tsx`** — replace current simple table with tabbed view:

```
Tabs: [ Products | Stock by Warehouse | Lots | Movements ]
```

- **Products tab**: table with SKU, name, category, on-hand, reorder point, status badge. "+ Add Product" button opens a slide-over form.
- **Stock by Warehouse tab**: table from `GET /inventory/stock-levels` grouped by warehouse.
- **Lots tab**: table from `GET /inventory/lots?expiringInDays=90` — expiry date colored red if < 30 days, orange if < 90 days.
- **Movements tab**: feed from `GET /inventory/movements` — IN (green) / OUT (red) direction badges.

### Definition of Done — Section 1
- [ ] `POST /api/inventory/warehouses` works
- [ ] Product create/edit form on frontend
- [ ] Lots tab shows expiry color coding
- [ ] Movements feed renders
- [ ] `npx tsc --noEmit` → 0 errors
- [ ] Branch `section/inventory` merged to `main`

---

## Section 3 — Fulfillment (after Section 2 is merged)

**Goal**: Sales Orders + Shipments end-to-end, triggering FIFO depletion.

### Backend
- `salesOrder.controller.js`: `list`, `getById`, `create({ customerId?, lines: [{productId, qty, unitPrice}] })`, `confirm(id)`
- `shipment.controller.js`: already has `create` which calls `fifoService.depleteFifo()` — expand with `updateStatus(id, status)`, `addTrackingEvent(id, { status, location, note })`
- New routes: `/api/sales-orders`, `/api/sales-orders/:id/confirm`

### Frontend
- `SalesOrdersPage.tsx` — list + create form
- Expand `ShipmentsPage.tsx` — add tracking timeline per shipment

---

## Section 4A — Reporting (after Section 3 is merged)

### Backend
- `report.controller.js`:
  - `GET /api/reports/valuation` — FIFO valuation by warehouse, breakdown by product
  - `GET /api/reports/cogs?from=&to=` — sum CogsPostings in date range
  - `GET /api/reports/margin?from=&to=` — revenue (from SalesOrderLines) minus COGS

### Frontend
- `ReportingPage.tsx` — three report cards with date range pickers and summary tables

---

## Patterns to Follow

```js
// Backend controller pattern
async function create(req, res) {
  try {
    const { ...fields } = req.body;
    const result = await prisma.modelName.create({ data: { ...fields } });
    await auditService.logEvent({ eventType: 'MODEL_CREATED', entityType: 'ModelName', entityId: result.id, actorId: req.user.id });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
```

```tsx
// Frontend query pattern
const { data = [], isLoading } = useQuery({
  queryKey: ['key'],
  queryFn: service.method,
});
```

## Commands
```bash
# Backend
npm run dev                         # nodemon
npx prisma studio                   # browse DB
npx prisma migrate dev --name <x>   # new migration (only if schema changed)

# Frontend
npm run dev                         # Vite dev server
npx tsc --noEmit                    # type check — must be 0 errors before PR
```
