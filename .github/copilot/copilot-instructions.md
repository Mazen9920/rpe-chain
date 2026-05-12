---
description: Shared project conventions and architecture for all contributors to RPE Chain Supply OS.
applyTo: "**"
---

# RPE Chain — Supply OS

A supply chain management system for **RPE Gear** (Respiratory Protective Equipment), built around an **event-sourced FIFO cost ledger** per the *RPE Chain Supply OS Master Plan v1.0*.

- **Frontend**: React 18 + Vite 5 + TypeScript + Tailwind CSS → `http://localhost:8080`
- **Backend**: Node.js + Express + Prisma + PostgreSQL → `http://localhost:3000`
- **6-role RBAC**: `ADMIN`, `PROCUREMENT`, `WAREHOUSE`, `FINANCE`, `SALES`, `READ_ONLY`
- **Append-only ledgers**: `StockMovement`, `CostLayer`, `CogsPosting`, `EventLog`

## Repository Layout
```
RPE supply/
├── backend/
│   ├── prisma/schema.prisma
│   ├── src/services/
│   │   ├── fifo.service.js    ← FIFO engine (never bypass)
│   │   ├── stock.service.js   ← recordMovement (append-only)
│   │   └── audit.service.js   ← EventLog writer
│   └── src/controllers/, routes/, middleware/
├── frontend/
│   └── src/pages/, components/, services/, stores/
└── .github/copilot/
    ├── copilot-instructions.md   ← this file (shared)
    ├── dev-a.instructions.md     ← Dev A's sections
    └── dev-b.instructions.md     ← Dev B's sections
```

---

## Development Model — Section-by-Section

Each developer owns **full vertical slices** — both the backend API and the frontend page for their assigned section. Sections are built one at a time in phases; both devs work in parallel on their section within the same phase.

```
Phase 1 — DONE ✅
  Foundation: Auth, FIFO engine, schema, Dashboard

Section 1 — IN PROGRESS (current)
  Dev A → Inventory module
  Dev B → Suppliers module

Section 2 — next
  Dev A → Procurement (Purchase Orders + Goods Receipt)
  Dev B → AP Ledger (Invoices + Payments)

Section 3
  Dev A → Fulfillment (Sales Orders + Shipments)
  Dev B → Alerts + Reorder Recommendations

Section 4
  Dev A → Reporting (Valuation, COGS, Margin)
  Dev B → Forecasting (Demand forecast view)
```

### Section ownership rules
- Each dev builds both the **Express controller/route** AND the **React page** for their section.
- Schema changes that affect another dev's section → discuss before migrating.
- Shared services (`fifo.service`, `stock.service`, `audit.service`) → do not modify without coordinating. Open a PR and tag the other dev.
- One section must be **merged to `main` before the next section begins** — keeps the base stable.

---

## Core Invariants — DO NOT VIOLATE
- **Append-only ledgers**: never `UPDATE`/`DELETE` rows in `StockMovement`, `CogsPosting`, `EventLog`. `CostLayer.qtyRemaining` is the *only* mutable field on cost layers.
- **FIFO depletion is atomic**: always use `fifoService.depleteFifo()`. Never decrement layers manually.
- **StockLevel is a snapshot**: only `stockService.recordMovement()` may write to it.
- **Soft-deletes via `deletedAt`** on Product, Supplier, Warehouse, Lot — always filter `deletedAt: null`.
- **Decimal money**: `Decimal` in Prisma, `.toNumber()` only at JSON boundary.
- **Audit**: write `EventLog` on PO receive, shipment, payment, role change, delete.

## Shared Conventions
- UUIDs for all PKs
- ISO 8601 strings for dates in API
- API errors: `{ "error": "message" }` with correct HTTP status
- `.env` never committed — use `.env.example`
- JWT: `Authorization: Bearer <token>`
- Frontend calls go through `src/services/index.ts` only — no inline axios in components

## Database (PostgreSQL — Homebrew)
```bash
brew services start postgresql@16
# user: rpe_user / pass: rpe_pass / db: rpe_supply
```

## Quick Start
```bash
# Backend (Terminal 1)
cd backend && npm install && cp .env.example .env
npx prisma migrate dev && node prisma/seed.js
npm run dev             # → http://localhost:3000

# Frontend (Terminal 2)
cd frontend && npm install
npm run dev             # → http://localhost:8080
```

## Seed Logins
| Email | Password | Role |
|-------|----------|------|
| admin@rpechain.com | Admin@123 | ADMIN |
| procurement@rpechain.com | Admin@123 | PROCUREMENT |
| warehouse@rpechain.com | Admin@123 | WAREHOUSE |
| finance@rpechain.com | Admin@123 | FINANCE |

## Git Workflow
```bash
git pull origin main
git checkout -b section/inventory    # or section/suppliers etc.
# build your section
git push origin section/inventory
# open PR → merge to main → next section begins
```
