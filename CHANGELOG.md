# Changelog

All notable changes to RPE Chain Supply OS are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/) and SemVer.

## [1.0.0] — 2026-05-13 — Sections 1–7 complete

First production-candidate release. Seven vertical sections delivered, each
tagged independently on its `section/*` branch, then merged to `main`.

### Sections
- **Section 1 — Inventory** (`inventory-v1.0`, `inventory-v1.1`): warehouses,
  products, lots, FIFO stock layers, cycle counts, reorder recommendations,
  expiry & stock alerts, reports, CSV exports.
- **Section 2 — Manufacturing** (`manufacturing-v1.0`, `manufacturing-v1.1`):
  BOMs, cost rollup, production orders, kit assembly. Audit fixes: scrap
  absorbed into unit cost, archive resets `isManufactured`, CSV export, negative
  tests.
- **Section 3 — Suppliers** (`suppliers-v1.0`): supplier master, contacts,
  source priorities, scorecards, RBAC routes, detail page with tabs.
- **Section 4 — Procurement** (`procurement-v1.0`): purchase orders, goods
  receipts, QA workflow, landed-cost allocation, GRN reversal.
- **Section 5 — Accounts Payable** (`ap-ledger-v1.0`): AP invoices, three-way
  match, payments, aging buckets.
- **Section 6 — Fulfillment** (`fulfillment-v1.0`): customers, sales orders,
  credit-limit checks, shipments, FIFO allocation.
- **Section 7 — Alerts, Forecasting, Reporting** (`alerts-reporting-v1.0`):
  Alert / AlertRule / Forecast schema; alert services (8 active types); reorder,
  supplier, and sales-order auxiliary services; node-cron scheduler (`*/15` for
  inventory, daily 02:00); CSV-downloadable reports (AP Aging, Supplier
  Scorecards, Sales Fulfillment); rewritten Dashboard with recharts trends and
  30-second Activity Feed; new `/alerts` and `/reports` pages; SO credit-limit
  amber warning banner.

### Fixed
- `frontend/src/pages/GoodsReceiptDetailPage.tsx`: removed reference to
  non-existent `LandedCostAllocation.totalAmount`; corrected GRN status check
  from `'RECEIVED'` to `'POSTED'` to match the `GrnStatus` type.

### Smoke tests
All seven section smoke test scripts under `backend/scripts/test-*.sh` pass
end-to-end against the seeded database.
