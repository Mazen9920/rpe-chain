---
mode: agent
description: Dev B — audit the Suppliers section, find what's missing, and implement it
---

You are Dev B working on the **Suppliers section** of RPE Chain Supply OS.

Read these files first to understand your full scope:
- `.github/copilot/copilot-instructions.md` — shared rules and invariants
- `.github/copilot/dev-b.instructions.md` — your section guide and definition of done

Then do the following **in order**:

## Step 1 — Audit what exists

Check the backend:
- Read `backend/src/controllers/supplier.controller.js` — list every function that exists
- Read `backend/src/routes/supplier.routes.js` — list every route registered
- Check if `backend/src/controllers/supplier.controller.js` has `recordPerformance` and `getPerformance` functions
- Check if the routes `POST /api/suppliers/:id/performance` and `GET /api/suppliers/:id/performance` exist

Check the frontend:
- Read `frontend/src/pages/SuppliersPage.tsx` — describe what it currently shows
- Check if `frontend/src/services/index.ts` has `recordPerformance` and `getPerformance` methods on `supplierService`

Report exactly what is **present** and what is **missing** before writing any code.

## Step 2 — Implement everything missing

Based on your audit, implement all missing pieces from the Section 1 checklist in `dev-b.instructions.md`:

**Backend (if missing):**
- Add `recordPerformance(req, res)` to `supplier.controller.js` — creates a `SupplierPerformance` row, logs audit event
- Add `getPerformance(req, res)` to `supplier.controller.js` — returns performance history for a supplier
- Register both routes in `supplier.routes.js` with `authorize(['ADMIN', 'PROCUREMENT'])` guard on POST
- Add `getById` to include `supplierProducts` and `performanceRecords` in the response if not already there

**Frontend (if missing):**
- Add `recordPerformance` and `getPerformance` to `supplierService` in `frontend/src/services/index.ts`
- Upgrade `SuppliersPage.tsx` to include:
  - Clickable rows that open a right-side detail panel
  - Detail panel shows: supplier info, linked products, performance history table (deliveryScore, qualityScore, period)
  - "Add Supplier" button with a form (code, name, country, leadTimeDays, paymentTermsDays, currency)

## Step 3 — Verify

After implementing:
1. Run `npx tsc --noEmit` in `frontend/` — must be 0 errors
2. Test `POST /api/suppliers/:id/performance` with a curl or REST client
3. Confirm the supplier detail panel renders in the browser

## Step 4 — Commit

```
git add .
git commit -m "feat: section/suppliers — complete supplier CRUD, performance tracking, detail panel"
git push origin section/suppliers
```

## Rules to follow
- Never touch `backend/src/services/fifo.service.js`, `stock.service.js`, or `audit.service.js` directly — only call them
- Soft-delete suppliers via `deletedAt`, never hard delete
- All money fields use `Decimal` in Prisma
- Log audit events using `auditService.logEvent(...)` for create, update, delete, performance record
- Filter `deletedAt: null` on all list queries
