---
mode: agent
description: Dev B onboarding — read the Master Plan, understand your role, audit, and execute Section 1 (Suppliers + AP foundation)
---

# Dev B — Full Role Briefing & Section 1 Execution

You are the **Copilot agent for Dev B** on the **RPE Chain Supply OS** project. Read this document fully before writing any code. Then execute the steps in order.

---

## 1. Project Context — Read These First

You have access to the **Master Plan v1.0** PDF (`Supply Chain Management System — Master Plan`). Read it. Specifically you must internalise:

- **Section 02** — Strategic objectives (eliminate manual reconciliation, every cost traceable, FIFO backbone, compliance by design)
- **Section 03 / Modules 02 & 03** — Supplier management & Supplier financial ledger (AP) — **these are your modules**
- **Section 06 — Forecasting** — yours later
- **Section 07 — Intelligent alerts** — yours later
- **Section 08** — Data schema, especially `suppliers`, `supplier_skus`, `supplier_performance`, `supplier_invoices`, `ap_ledger`, `payments`, `alerts`, `forecasts`
- **Section 10** — RBAC matrix (you mostly serve PROCUREMENT and FINANCE roles)
- **Section 11** — Implementation roadmap (Phases 1–4 — you own pieces in every phase)
- **Section 12** — Engineering doctrine (event-sourced, soft delete, idempotent, explainable, multi-currency from day one)

Also read these repo files:
- `.github/copilot/copilot-instructions.md` — shared invariants
- `.github/copilot/dev-b.instructions.md` — your Windows setup + section assignments
- `backend/prisma/schema.prisma` — the full data model already exists

---

## 2. Your Exact Role on This Team

**Team structure:** 2 developers working in parallel using Copilot agents.
- **Dev A (Mac)** owns: Inventory, Fulfillment, Reporting, FIFO-touching code
- **Dev B (you, Windows)** owns: **Suppliers, AP Ledger, Alerts, Forecasting**

You build **full vertical slices** for your sections: **Prisma queries → backend controller → Express route → frontend service → React page → commit**. You are not "the backend dev" or "the frontend dev". You own your modules end-to-end.

### What you OWN (you write all code here)
| Section | Backend | Frontend | Phase |
|---|---|---|---|
| **Suppliers (M02)** | `supplier.controller.js`, `supplier.routes.js` | `SuppliersPage.tsx`, supplier detail panel, performance UI | **Phase 1 — NOW** |
| **AP Ledger (M03)** | `invoice.controller.js`, `payment.controller.js`, three-way match logic | `APLedgerPage.tsx`, aging buckets, payment runs | Phase 3 |
| **Alerts (M07)** | `alert.controller.js`, alert scanners (cron jobs) | `AlertsPage.tsx`, alert cards with explanations | Phase 4 |
| **Forecasting (M06)** | `forecast.controller.js`, statistical models | `ForecastPage.tsx`, MAPE/bias charts | Phase 4 |

### What you NEVER touch directly (call only)
- `backend/src/services/fifo.service.js` — Dev A owns FIFO depletion / cost layers
- `backend/src/services/stock.service.js` — Dev A owns stock movements
- `backend/src/services/audit.service.js` — shared; you **call** `auditService.logEvent(...)` but do not modify it
- `backend/prisma/schema.prisma` — if you need schema changes, propose them in your PR description; Dev A reviews and applies the migration

### What you SHARE (coordinate before changing)
- `frontend/src/components/Layout.tsx` — sidebar navigation
- `frontend/src/App.tsx` — route registration
- `frontend/src/services/index.ts` — add your service objects, don't touch others
- `frontend/src/stores/authStore.ts` — auth, leave alone

---

## 3. Non-Negotiable Engineering Rules (from Master Plan §12)

When writing any code on this project, you **must** honour these. They are checked in PR review:

1. **Append-only ledgers** — `ApLedgerEntry`, `EventLog`, `StockMovement`, `CogsPosting` are never UPDATEd. Corrections = compensating insert.
2. **Soft delete only** — set `deletedAt = new Date()`. Never `prisma.x.delete()`. Always filter `deletedAt: null` on lists.
3. **Idempotent** — every external webhook/API handler must dedupe by external ID.
4. **Explainable** — every alert, every forecast, every reorder recommendation stores its inputs in a `reasoning` or `payload` JSON column so the user can answer "why?".
5. **Multi-currency** — every money field has a currency + FX rate. Use Prisma `Decimal`, never `Float`.
6. **API-first** — UI calls the same REST endpoints a third party would. No privileged client-only logic.
7. **Audit log every state change** — call `auditService.logEvent({ eventType, entityType, entityId, actorId: req.user.id, payload, sourceIp: req.ip })` on create / update / delete / status-change.
8. **RBAC guard every write route** — use `authorize(['ADMIN', 'PROCUREMENT'])` etc. Match Master Plan §10.
9. **UTC timestamps** in DB, format on display.
10. **No production DB edits** — all changes via Prisma migrations.

---

## 4. Step 1 — Audit Current State (before writing code)

Open and read these files, then **report back** what exists and what is missing. Do not write code yet.

**Backend audit:**
- [ ] `backend/src/controllers/supplier.controller.js` — list every exported function
- [ ] `backend/src/routes/supplier.routes.js` — list every route, method, and authorize guard
- [ ] `backend/prisma/schema.prisma` — confirm `Supplier`, `SupplierProduct`, `SupplierPerformance` models exist with the fields needed for M02

**Frontend audit:**
- [ ] `frontend/src/services/index.ts` — does `supplierService` exist? what methods?
- [ ] `frontend/src/pages/SuppliersPage.tsx` — what columns? interactive? has detail view?
- [ ] `frontend/src/components/Layout.tsx` — is "Suppliers" in the sidebar?

**Output a short audit table:**

| Item | Present? | Notes |
|---|---|---|
| `GET /api/suppliers` | ✅/❌ | |
| `POST /api/suppliers` | ✅/❌ | |
| `PUT /api/suppliers/:id` | ✅/❌ | |
| `DELETE /api/suppliers/:id` (soft) | ✅/❌ | |
| `GET /api/suppliers/:id` | ✅/❌ | includes products + performance? |
| `POST /api/suppliers/:id/performance` | ✅/❌ | |
| `GET /api/suppliers/:id/performance` | ✅/❌ | |
| `supplierService.list` | ✅/❌ | |
| `supplierService.recordPerformance` | ✅/❌ | |
| Supplier list page | ✅/❌ | |
| Supplier detail panel | ✅/❌ | |
| Add/Edit supplier form | ✅/❌ | |

---

## 5. Step 2 — Implement Missing Pieces for Section 1 (Suppliers MVP)

Section 1's Definition of Done — **everything below must work** before you open a PR:

### Backend
- [ ] `GET /api/suppliers` — paginated, filters by `country`, `currency`, `search` (name/code), excludes soft-deleted
- [ ] `GET /api/suppliers/:id` — includes `supplierProducts` (with product info) and last 10 `performanceRecords` ordered by `period desc`
- [ ] `POST /api/suppliers` — body: `code, name, legalName, taxId, country, currency, paymentTermsDays, leadTimeDays, primaryContact (json), riskRating`. Validate uniqueness on `code`. Log `SUPPLIER_CREATED` audit event.
- [ ] `PUT /api/suppliers/:id` — partial update, log `SUPPLIER_UPDATED` with before/after in payload
- [ ] `DELETE /api/suppliers/:id` — soft delete (set `deletedAt`), log `SUPPLIER_DELETED`
- [ ] `POST /api/suppliers/:id/performance` — body: `period (YYYY-MM), onTimeRate, fillRate, defectRate, leadTimeMean, leadTimeStd`. Creates `SupplierPerformance` row. Log `SUPPLIER_PERFORMANCE_RECORDED`.
- [ ] `GET /api/suppliers/:id/performance?from&to` — returns performance history sorted by period
- [ ] All write routes guarded with `authorize(['ADMIN', 'PROCUREMENT'])`
- [ ] All list/get routes guarded with `authorize(['ADMIN', 'PROCUREMENT', 'FINANCE', 'READ_ONLY'])`

### Frontend
- [ ] `supplierService` in `frontend/src/services/index.ts` has: `list`, `get`, `create`, `update`, `remove`, `recordPerformance`, `getPerformance`
- [ ] `SuppliersPage.tsx`:
  - Toolbar with search input + country filter + "+ Add Supplier" button
  - Table: Code · Name · Country · Currency · Lead Time · Payment Terms · Risk · Actions
  - Click row → opens right-side detail panel (use Tailwind slide-over pattern)
  - Detail panel tabs: **Overview** (info) · **Products** (linked SKUs) · **Performance** (table of last 12 records with mini sparkline if possible)
  - "Record Performance" button inside detail → modal with period, onTimeRate, fillRate, defectRate, leadTimeMean, leadTimeStd
- [ ] Add/Edit Supplier form (modal or slide-over): all fields listed in POST endpoint above, validation on required + uniqueness errors from API
- [ ] React Query: invalidate `['suppliers']` and `['supplier', id]` keys on mutations
- [ ] Empty state, loading skeleton, error toast — not just blank pages

### Quality gates (run before commit)
- [ ] `cd frontend && npx tsc --noEmit` → 0 errors
- [ ] Backend: hit `POST /api/suppliers/:id/performance` with curl/REST client, see the row in DB
- [ ] Browser test: log in as `admin@rpechain.com` / `Admin@123`, create a supplier, record performance, verify detail panel shows it

---

## 6. Step 3 — Git Workflow

```powershell
git fetch origin
git checkout -b section/suppliers origin/main
# ... do the work ...
git add .
git commit -m "feat(suppliers): complete M02 — CRUD, performance tracking, detail panel"
git push -u origin section/suppliers
```

Open a PR on GitHub with this template in the description:

```
## Section: Suppliers (M02 — Phase 1)

### Endpoints added
- GET/POST/PUT/DELETE /api/suppliers
- GET /api/suppliers/:id
- POST/GET /api/suppliers/:id/performance

### Frontend
- SuppliersPage with table + slide-over detail panel
- Add/Edit supplier form
- Performance recording modal

### Master Plan alignment
- §03 M02 capabilities: supplier master ✅, commercial terms ✅, performance scorecards ✅
- §12 doctrine: soft delete ✅, audit log ✅, multi-currency ✅, RBAC ✅

### Tested
- [x] tsc clean
- [x] All endpoints curl-tested
- [x] Manual browser test with admin login
```

---

## 7. After Section 1 — What's Next

Do NOT start these until Section 1 is merged. They are listed so you understand the trajectory:

- **Section 2 (Phase 3): AP Ledger** — supplier invoices, three-way match against POs, payment scheduling, aging buckets
- **Section 3 (Phase 4): Alerts engine** — implement the alert catalogue from Master Plan §05, hourly scanner cron
- **Section 4 (Phase 4): Forecasting** — start with exponential smoothing per Master Plan §16 question 8

---

## 8. If You Get Stuck

- Schema change needed? Add it to your PR description as a "Schema change request" section and ping Dev A — do not run `prisma migrate dev` on a schema change that affects shared models (Product, StockLevel, etc.)
- FIFO question? Read `fifo.service.js` to understand the contract, then call it; never reimplement.
- Conflict with Dev A on a shared file (`Layout.tsx`, `App.tsx`, `services/index.ts`)? Rebase on `main` after Dev A merges; resolve by keeping both additions.
- Auth confused? `req.user` is populated by the JWT middleware in `backend/src/middleware/auth.js`. Use `req.user.id` and `req.user.role`.

---

## 9. Begin Now

1. Read the Master Plan PDF sections listed in §1 above.
2. Read `.github/copilot/copilot-instructions.md` and `.github/copilot/dev-b.instructions.md`.
3. Run the audit in §4 and post the table.
4. Implement everything missing in §5.
5. Run quality gates.
6. Open the PR per §6.

Do not skip the audit. Do not invent new patterns — match what already exists in `product.controller.js` for backend style and `InventoryPage.tsx` for frontend style.
