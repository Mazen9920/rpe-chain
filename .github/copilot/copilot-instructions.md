---
description: Shared project conventions and architecture for all contributors to RPE Chain Supply OS.
applyTo: "**"
---

# RPE Chain — Supply OS

A supply chain management system for **RPE Gear** (Respiratory Protective Equipment), built around an **event-sourced FIFO cost ledger** per the *RPE Chain Supply OS Master Plan v1.0*.

- Mobile-first React Native (Expo) frontend
- Node.js + Express + Prisma + PostgreSQL backend
- 6-role RBAC: `ADMIN`, `PROCUREMENT`, `WAREHOUSE`, `FINANCE`, `SALES`, `READ_ONLY`
- Append-only `StockMovement`, `CostLayer`, `CogsPosting`, `EventLog`

## Repository Layout
```
RPE supply/
├── backend/                  ← Node.js + Express + Prisma (Developer 1)
│   ├── prisma/schema.prisma
│   ├── src/services/
│   │   ├── fifo.service.js   ← createCostLayer, depleteFifo, reverseFifo, getInventoryValuation
│   │   ├── stock.service.js  ← recordMovement (append-only + snapshot)
│   │   └── audit.service.js  ← EventLog writer
│   └── src/controllers/, routes/, middleware/
├── frontend/                 ← React Native Expo app (Developer 2)
└── .github/copilot/
```

## 10 Functional Modules (Master Plan)
1. Inventory & Lots (multi-warehouse, expiry, soft-delete)
2. Suppliers (performance, lead-time)
3. Procurement (POs, goods receipts, 3-way match)
4. AP Ledger (invoices, payments, FX)
5. Fulfillment (sales orders, shipments, tracking)
6. FIFO Cost Engine (layers, depletion, landed cost, COGS)
7. Forecasting *(Phase 4 — not built yet)*
8. Alerts (low stock, expiry)
9. Reporting (valuation, COGS, margin)
10. Integrations *(Phase 5)*

## Core Invariants — DO NOT VIOLATE
- **Append-only ledgers**: never `UPDATE`/`DELETE` rows in `StockMovement`, `CogsPosting`, `EventLog`. `CostLayer.qtyRemaining` is the *only* mutable field on cost layers. Corrections = new offsetting rows.
- **FIFO depletion is atomic**: always go through `fifoService.depleteFifo()`. It uses `prisma.$transaction` + `SELECT ... FOR UPDATE` row locks. Never compute COGS or decrement layers ad-hoc.
- **StockLevel is a snapshot**: only `stockService.recordMovement()` may write to it.
- **Soft-deletes via `deletedAt`** on Product, Supplier, Warehouse, Lot. Always filter `deletedAt: null` in list queries.
- **Decimal money**: monetary fields are `Decimal`. Use `.toNumber()` or stay in `Prisma.Decimal`.
- **Audit important events**: write `EventLog` on PO receive, shipment, payment, role change, delete.

## Shared Conventions
- UUIDs for all PKs
- ISO 8601 strings for dates in JSON
- API errors: `{ "error": "message" }` with proper HTTP status
- `.env` never committed
- JWT bearer in `Authorization: Bearer <token>` header

## Database (PostgreSQL — Homebrew local)
```bash
brew services start postgresql@16
# user: rpe_user / pass: rpe_pass / db: rpe_supply  (CREATEDB granted for shadow DB)
```

## Quick Start
```bash
# Backend
cd backend && cp .env.example .env && npm install
npx prisma migrate dev
node prisma/seed.js
npm run dev          # → http://localhost:3000

# Frontend
cd frontend && npm install
npx expo start
```

## Seed Login
- `admin@rpechain.com` / `Admin@123` (ADMIN)
- `procurement@rpechain.com` / `Admin@123` (PROCUREMENT)
- `warehouse@rpechain.com` / `Admin@123` (WAREHOUSE)
- `finance@rpechain.com` / `Admin@123` (FINANCE)

## Two-Developer Split
| | Developer 1 | Developer 2 |
|-|------------|------------|
| **Domain** | `backend/` | `frontend/` |
| **Agent file** | `backend-agent.instructions.md` | `frontend-agent.instructions.md` |
| **Owns** | schema, services, FIFO engine, controllers, migrations, seeds | screens, navigation, state, API client, UI |

Cross-cutting changes (new endpoint + UI consumer) → coordinate via the API contract in `backend-agent.instructions.md`.
