---
description: Instructions for Dev B — owns Suppliers and AP Ledger sections (full stack per section).
applyTo: "**"
---

# Dev B — Section Guide (Windows)

You own full vertical slices for your sections: **backend controller + route + frontend page** together.  
Read `copilot-instructions.md` for shared rules and invariants first.

> **Dev B is on Windows.** Use PowerShell or Git Bash for all commands below.

---

## One-Time Setup (Windows)

**1 — Install prerequisites** (skip if already installed):
- [Node.js LTS](https://nodejs.org) — download and run the installer
- [Git for Windows](https://git-scm.com/download/win) — includes Git Bash
- [PostgreSQL 16](https://www.postgresql.org/download/windows/) — use the installer, set password `rpe_pass` during setup, keep default port 5432

**2 — Clone the repo** (PowerShell or Git Bash):
```powershell
git clone https://github.com/Mazen9920/rpe-chain.git "RPE supply"
cd "RPE supply"
```

**3 — Create the database** (open pgAdmin or run in PowerShell):
```powershell
psql -U postgres -c "CREATE USER rpe_user WITH PASSWORD 'rpe_pass';"
psql -U postgres -c "CREATE DATABASE rpe_supply OWNER rpe_user;"
psql -U postgres -c "ALTER USER rpe_user CREATEDB;"
```
> If `psql` is not in PATH, find it at `C:\Program Files\PostgreSQL\16\bin\psql.exe`  
> Or add it to PATH: System → Environment Variables → add `C:\Program Files\PostgreSQL\16\bin`

**4 — Backend setup:**
```powershell
cd "RPE supply\backend"
npm install
copy .env.example .env
npx prisma migrate dev
node prisma/seed.js
```

**5 — Frontend setup:**
```powershell
cd "..\frontend"
npm install
```

**6 — Create your branch:**
```powershell
cd ..
git checkout -b section/suppliers
```

**Every session — start both servers (two separate PowerShell windows):**
```powershell
# Window 1 — Backend
cd "RPE supply\backend"
npm run dev          # → http://localhost:3000

# Window 2 — Frontend
cd "RPE supply\frontend"
npm run dev          # → http://localhost:8080
```

Open **http://localhost:8080** → login: `admin@rpechain.com` / `Admin@123`

---

## Your Sections

### Section 1 — Suppliers Module (CURRENT)
### Section 2B — AP Ledger (Invoices + Payments)
### Section 3B — Alerts + Reorder Recommendations
### Section 4B — Forecasting

---

## Section 1 — Suppliers Module

**Goal**: Complete CRUD and UI for suppliers including performance tracking.

### Backend — what to build

**`supplier.controller.js`** — already exists, verify and expand:
- `list` — returns active suppliers (`deletedAt: null`)
- `getById` — include `supplierProducts[]`, `performanceRecords[]`
- `create({ code, name, country, leadTimeDays, paymentTermsDays, currency, taxId?, bankDetails? })`
- `update(id, data)`
- `remove(id)` — soft-delete via `deletedAt`, log `SUPPLIER_DELETED` event
- **ADD**: `recordPerformance(id, { deliveryScore, qualityScore, period })` → creates `SupplierPerformance` row
- **ADD**: `getPerformance(id)` → returns performance history

**Routes** (`backend/src/routes/supplier.routes.js`):
```
GET    /api/suppliers
GET    /api/suppliers/:id
POST   /api/suppliers
PUT    /api/suppliers/:id
DELETE /api/suppliers/:id
POST   /api/suppliers/:id/performance    ← ADD
GET    /api/suppliers/:id/performance    ← ADD
```

**Role guards**:
- GET → any authenticated user
- POST/PUT/DELETE → `authorize(['ADMIN', 'PROCUREMENT'])`

### Frontend — what to build

**`frontend/src/pages/SuppliersPage.tsx`** — replace current simple table with:

- **Supplier list** — table with code, name, country, lead time, payment terms, currency, status badge
- **Supplier detail panel** — click a row to open a right-side panel showing:
  - Basic info
  - Linked products (`supplierProducts[]`)
  - Performance history — simple bar or table of deliveryScore / qualityScore per period
- **"+ Add Supplier"** button → inline form or modal

**New service calls** to add to `frontend/src/services/index.ts`:
```ts
supplierService.recordPerformance(id, data)
supplierService.getPerformance(id)
```

### Definition of Done — Section 1
- [ ] Supplier create/edit form works
- [ ] Supplier detail panel shows products + performance
- [ ] `POST /api/suppliers/:id/performance` persists a SupplierPerformance row
- [ ] Soft-delete hides supplier from list
- [ ] `npx tsc --noEmit` → 0 errors
- [ ] Branch `section/suppliers` merged to `main`

---

## Section 2B — AP Ledger (after Section 2A Procurement is merged)

**Goal**: Supplier invoices matched to POs + payment recording.

### Backend
- `apLedger.controller.js`:
  - `createInvoice({ supplierId, poId, invoiceNumber, invoiceDate, dueDate, lines: [{description, amount}] })` → creates `SupplierInvoice` + `ApLedgerEntry` rows
  - `listInvoices(params)` — filterable by supplierId, status
  - `recordPayment({ invoiceId, amount, currency, fxRate, paidAt, reference })` → creates `Payment` + `ApLedgerEntry`, marks invoice PAID if fully settled
- Routes: `GET/POST /api/invoices`, `GET /api/invoices/:id`, `POST /api/payments`

### Frontend
- `ApLedgerPage.tsx` — invoice list with OPEN / PARTIALLY_PAID / PAID status badges + record payment button

---

## Section 3B — Alerts + Reorder (after Section 3A Fulfillment is merged)

### Backend
- `alert.controller.js`:
  - `list` — returns open alerts (low stock, expiry, anomaly)
  - `dismiss(id)` — sets `resolvedAt`
  - `createReorderRecommendation` — called internally when stock falls below reorderPoint (trigger from `stockService.recordMovement`)
- Routes: `GET /api/alerts`, `PATCH /api/alerts/:id/dismiss`, `GET /api/reorder-recommendations`

### Frontend
- Alert bell in the Layout header showing count badge
- `AlertsPage.tsx` — list of alerts with dismiss button
- Reorder recommendations table with suggested qty + preferred supplier

---

## Section 4B — Forecasting (after Section 4A Reporting is merged)

### Backend
- `forecast.controller.js`:
  - `GET /api/forecasts/:productId` — returns stored Forecast rows
  - `POST /api/forecasts` — upsert a forecast (manual entry for now; ML is Phase 5)

### Frontend
- `ForecastingPage.tsx` — per-product demand table + simple trend visualization

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

## Commands (Windows PowerShell)
```powershell
# Backend
npm run dev                              # nodemon
npx prisma studio                        # browse DB in browser
npx prisma migrate dev --name <name>     # new migration (only if schema changed)

# Frontend
npm run dev                              # Vite dev server → http://localhost:8080
npx tsc --noEmit                         # type check — must be 0 errors before PR
```
