# Changelog

All notable changes documented per release. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), SemVer.

## [0.3.0] — GL · FX · Procurement · AP

### Added
- **General Ledger**: `gl_accounts` (code unique, account_type ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE, normal_balance DEBIT/CREDIT, parent self-FK, currency, is_postable), `gl_journals` (auto journal_number `J{YYYYMM}{seq:05d}`, source_doc_type/source_doc_id traceability, status DRAFT/POSTED/REVERSED), `gl_journal_lines` (CHECK debit XOR credit; per-currency `base_debit`/`base_credit` computed via FX; JSON `dimensions` for product/warehouse/shipment analytics).
- **GL service** (`app.services.gl`): `post_journal` enforces Σdebit==Σcredit per currency (raises `UnbalancedJournalError`); `post_pending(entry, account_map)` promotes a v0.2.0 `PendingJournalEntry` to a real `GLJournal` and marks the entry POSTED with `posted_journal_id`; `trial_balance(as_of, currency?)` returns sorted `[(code, debit, credit)]`.
- **Egypt Chart of Accounts**: `seed_egypt_coa` (idempotent) — Cash 1010, Bank 1020, AR 1100/1110/1120/1130, Inventory 5000/5010/5015/5020, Adjustment-Exp 5030, AP 2010/2020/2030/2040, Input-VAT 2050, Equity 3010/3020, Revenue 4010/4020, COGS 5400/5410, Marketing 6140/6160/6170/6171/6191, Finance 7010/7020.
- **FX**: `fx_rates` (unique (from_ccy, to_ccy, as_of_date), rate>0, source). `fx.upsert_rate` and `fx.get_rate(when)` — identity for same currency, falls back to most-recent prior rate, raises `FxRateNotFoundError` if none.
- **Procurement**: `suppliers` (vendor_type MANUFACTURER/SERVICE/CONSUMABLE/CAPEX/UTILITY, currency, payment_terms_days, ap_account_code), `purchase_orders` + `po_lines` (PO# `PO{YYYYMM}{seq:04d}`, qty_ordered/received/invoiced w/ CHECK qty>0, status DRAFT→SENT→PARTIAL→RECEIVED→CLOSED), `goods_receipts` + `goods_receipt_lines` (GR# `GR{YYYYMM}{seq:04d}`, cost_layer_id link).
- **Purchasing service** (`app.services.purchasing`): `create_po`, `send_po`, `receive_po` (lands FIFO cost layer via `inv.receive`, allocates `landed_cost_total` proportional to line value, updates PO status PARTIAL/RECEIVED, raises `InvalidStateError` on over-receipt), `three_way_match(po_id, invoice_total, tolerance)`.
- **Accounts Payable**: `supplier_invoices` + `supplier_invoice_lines` (AP# `AP{YYYYMM}{seq:04d}`, unique (supplier_id, invoice_number), `account_code` for direct GL expense routing, optional `po_line_id`), `ap_payments` + `ap_payment_applications` (method CASH/BANK/CHEQUE/EFT).
- **AP service** (`app.services.ap`): `register_invoice` posts balanced journal (DR expense/inventory accounts + DR Input-VAT 2050 + CR supplier AP account, links `posted_journal_id`); `pay_invoice` posts DR AP / CR cash account (default Bank 1020), updates invoice status PARTIALLY_PAID/PAID and supplier `outstanding_balance`; `aging_buckets(as_of)` returns dict {current, 1_30, 31_60, 61_90, 90_plus}.
- **COGS→GL bridge**: `services.cogs.post_for_shipment` now calls `gl.post_pending` after creating the pending entry. Falls back gracefully via `try/except AccountNotFoundError` when Egypt CoA is not yet seeded, preserving v0.2.0 behavior.
- **API routers**: `/gl/accounts`, `/gl/seed-egypt-coa`, `/gl/journals`, `/gl/journals/{id}/lines`, `/gl/trial-balance`, `/fx-rates`, `/fx-rates/lookup`, `/suppliers`, `/purchase-orders`, `/purchase-orders/{id}/send`, `/goods-receipts`, `/supplier-invoices`, `/ap-payments`, `/ap/aging`.
- **Schemas** (`app.schemas.v3`): camelCase JSON with snake-case Python attributes via `_Camel` base (`populate_by_name=True`, `from_attributes=True`).
- **Migration `0004_gl_fx_procurement_ap`**: 12 new tables (gl_accounts, gl_journals, gl_journal_lines, fx_rates, suppliers, purchase_orders, po_lines, goods_receipts, goods_receipt_lines, supplier_invoices, supplier_invoice_lines, ap_payments, ap_payment_applications) with full FKs/indexes/CHECK constraints. Down-migration drops in reverse.
- **Tests**: +12 tests — `test_gl.py` (CoA seed idempotent, post_journal balanced, unbalanced raises, trial balance sums), `test_fx.py` (identity, fallback, missing raises, upsert replaces), `test_procurement_ap.py` (full PO→GR→invoice→payment E2E with TB balanced verification, partial-then-full payment, aging buckets), `test_cogs_gl_wiring.py` (shipment promotes pending to real GL journal when CoA seeded). **62/62 tests pass.**

### Acceptance
- Sample PO → receipt → invoice → payment posts 2 GL journals (GR lands stock w/o GL entry; invoice and payment each post one balanced journal). Trial balance balances per currency. ✓
- 50 prior tests still pass; COGS posting gracefully degrades to PENDING when CoA not seeded. ✓

## [0.2.0] — Catalog · Inventory · Sales · Bundles · Shopify

### Added
- **Catalog**: `categories` (self-FK tree, code unique, ABC class default A/B/C, `default_service_level`), product extensions (`category_id`, `selling_price`, `external_id`), and `bundle_components` (bundle parent → component products with `qty_per`, `position`, optional `allocation_weight`; rejects self-reference and nested bundles).
- **Inventory (multi-warehouse FIFO)**: `warehouses`, `lots`, `stock_levels` with optimistic `version` for concurrency-safe writes, append-only `stock_movements` (signed qty + movement type RECEIVE/SHIP/ADJUST/TRANSFER_OUT/TRANSFER_IN/CONSUME/RETURN), `cost_layers` (FIFO with `qty_remaining`/`unit_cost`/`landed_cost_per_unit`/currency, ACTIVE/DEPLETED/LOCKED), `reservations` (PENDING/RELEASED/CONSUMED keyed by `ref_type`+`ref_id`).
- **Inventory service** (`app.services.inventory`): `receive` (open layer), `consume_layers` (FIFO weighted-avg cost including landed-cost, raises `InsufficientStockError`), `ship`, `transfer` (FIFO out, mirror layer in), `adjust` (delta-aware), `reserve`/`release`/`release_for_ref(consume=True|False)`. Every write bumps `StockLevel.version` (`StockConcurrencyError` on mismatch). Movements recorded for every quantitative change.
- **Sales**: `customers` (currency, payment terms, credit limit), `sales_orders` (state machine RECEIVED→CONFIRMED→ALLOCATED→PICKED→PACKED→SHIPPED→DELIVERED|CANCELLED, `source` SHOPIFY/MANUAL/B2B + conditional unique `external_id`), `sales_order_lines` (bundle parent/child via `parent_line_id` self-FK CASCADE + `is_bundle_parent`/`is_bundle_component`), `shipments` and `shipment_lines` (stamped `unit_cost` + `cost_source`).
- **Bundle service** (`app.services.bundle`): `expand_bundle_lines` (parent marked, children at `position=parent*100+i+1`, last child absorbs rounding drift), `compute_bundle_atp = min(floor((on_hand - reserved) / qty_per))`, list-price allocation weights (`selling_price * qty_per`) with optional `allocation_weight` override and opt-in `relative_cost_weights` using `get_cost_for_cogs`.
- **COGS posting** (`app.services.cogs`): per-shipment `PendingJournalEntry` (DR `COGS_FG`/`COGS_RM` / CR `INV_FG`/`INV_RM`/`INV_PACK`), symbolic account codes resolved by v0.3.0 GL. Unit cost preference: `get_cost_for_cogs` (standard) → FIFO weighted-avg fallback; raises `CogsCostUnavailableError` if neither source available.
- **Shopify integration**: outbound outbox (`IntegrationOutbox` with target/action/payload/idempotency_key/attempts/next_attempt_at, status PENDING/IN_FLIGHT/SUCCEEDED/FAILED), exponential backoff up to 30 min, max 8 attempts; inbound webhook handlers for `orders/create`, `orders/cancelled`, `products/update` with constant-time HMAC SHA-256 verification, `IdempotencyKey` dedupe on `X-Shopify-Webhook-Id`, raw payload archived in `IntegrationEvent`. Shipment of a Shopify-sourced order auto-enqueues a `fulfillments.create` outbox row.
- **Pending journals**: `pending_journal_entries` + `pending_journal_lines` (balanced DR/CR with XOR check, JSON dimensions for product/warehouse/shipment).
- **API surface** (under `/api/v1/`): categories, products, bundle composition + ATP, warehouses, stock levels/movements/cost layers, inventory receive/adjust/transfer, customers, full sales-order lifecycle (`POST /sales-orders`, `confirm`, `allocate`, `cancel`, `ship`), shipments, pending journals (superuser read), and Shopify webhook ingress (`/webhooks/shopify/{orders-create|orders-cancelled|products-update}`).
- **Alembic 0003**: 17 new tables + 3 product columns + FK to categories + 2 indexes. Reversible downgrade.
- **Tests**: inventory FIFO + reservations + transfers + optimistic lock (6), bundles composition + ATP + line expansion + cycle rejection (4), full order-to-cash including Shopify outbox enqueue (2), Shopify inbound HMAC + idempotency (4), API smoke (2) — **50/50 tests pass**.

### Engineering invariants (reinforced)
- Costs and quantities remain `Decimal` end-to-end; ROUND_HALF_EVEN to 4dp.
- All status enums use `enum.StrEnum`; persisted as `SQLEnum(..., native_enum=False)` so in-memory SQLite tests stay green.
- Optimistic locking via integer version counter on stock levels — no row-level pessimistic locks needed.
- Shopify is treated as an external system: webhooks land in raw `IntegrationEvent` first, projections are idempotent, outbox preserves intent during downtime.

## [0.1.1] — Standard-Cost Engine

### Added
- `products` catalog stub with `ProductType` enum (RAW / PACKAGING / FINISHED / BUNDLE) — only fields the costing engine needs; full catalog deferred to v0.2.0.
- Bill of Materials: `bill_of_materials` (versioned, soft-archive via `archived_at`) and `bom_lines` (qty_per `Decimal(12,4)`, scrap_factor_pct `Decimal(5,4)` stored as fraction).
- Monthly cost inputs: `rm_cost_months` (with `fx_rate` and `currency` for non-EGP RMs), `mfg_fee_months`, `other_cost_months` (PACKAGING / LABOR / OVERHEAD / OTHER). Each row is independently lockable via `is_locked`.
- `standard_costs` snapshot table: per-product, per-month `unit_cost`, `rm_subtotal`, `mfg_fee`, `other_subtotal`, `status`, `is_locked`, `computed_at`, `missing_inputs` (JSON), `breakdown` (JSON).
- `costing_settings` singleton (row id=1, check-constrained) with `cutover_date`, `stale_after_days`, `default_currency`.
- **Standard-cost engine** (`app.services.standard_cost`): deterministic `Decimal` rollup with `ROUND_HALF_EVEN` quantisation to 4dp. BOM walk is recursive with cycle detection (`BomCycleError`, 409). Scrap math: `effective_qty = qty_per * (1 + scrap_factor_pct)`. Topo-sorted batch recompute via `recompute_all_for_month`.
- Status precedence: `MISSING_RM_PRICES > MISSING_MFG_FEE > STALE > LOCKED > OK`. `mark_stale_if_needed` flips OK rows older than `stale_after_days` to `STALE`.
- `get_cost_for_cogs(product_id, when)` — selector for v0.2.0 COGS posting; walks back ≤12 months looking for an `OK` or `LOCKED` row, returns `Decimal` or `None`.
- `lock_month` (idempotent, sets `status=LOCKED` on locked std rows) and `unlock_month(force, actor_id)` (refuses before cutover unless `force=True`).
- API routes under `/api/v1/`: `GET/PUT /rm-costs`, `/mfg-fees`, `/other-costs`; `GET /standard-costs`, `GET /standard-costs/{product_id}/{month}`, `POST /standard-costs/recompute`, `POST /standard-costs/lock`, `POST /standard-costs/unlock`; `GET/PUT /costing-settings`. Mutating routes require superuser; PUTs against locked rows return `409 month_locked`.
- Celery task `rpe_gear.standard_cost.recompute_month(month_iso)` for offline batch recompute.
- Idempotent `scripts/seed.py` seeds CostingSettings + F8-V2 demo BOM with Jan-2026 inputs (unit cost = **EGP 88.30**).
- 13 service tests (Decimal math, all 5 statuses, idempotency, lock 409, cycle detection, COGS selector walk-back, scrap math, topo recompute) + 3 API tests (auth, superuser guard, lock 409 round-trip). Engine coverage: **97%**.

### Engineering invariants (reinforced)
- All arithmetic stays in `Decimal`; floats rejected at the Pydantic boundary.
- Cross-DB-compatible model definitions: `sa.Uuid`, `sa.JSON`, `SQLEnum(..., native_enum=False)` — in-memory SQLite tests pass without a Postgres backend.
- Status writes are atomic per-product per-month via unique constraint upserts.

## [0.1.0] — Platform Skeleton (in progress)

### Added
- FastAPI 0.115 application factory (`app.main:create_app`) with structured JSON logging (structlog), request-id correlation middleware, and global error handler.
- SQLAlchemy 2 async engine + declarative `Base`; Alembic configured for async with baseline migration creating the `users` table.
- Pydantic Settings (`app.core.config`) loaded from `.env`; SECRET_KEY length-validated; CORS origins CSV-parseable.
- Security primitives (`app.core.security`): argon2 password hashing, HS256 JWT with `jti`/`exp`, PyOTP TOTP, Fernet AES symmetric encryption for at-rest secrets.
- Auth: fastapi-users wiring with JWT bearer backend, register/login/reset routes mounted under `/api/v1/auth/*`.
- MFA: `/api/v1/mfa/{enroll,verify,disable}` with encrypted TOTP secret + one-time recovery codes.
- Celery 5.4 + Redis broker/backend with empty beat schedule and a `rpe_gear.ping` smoke task.
- Health endpoints: `/api/v1/health` (liveness) + `/api/v1/ready` (DB + Redis checks).
- Dockerfile (python:3.12-slim + uv) and `docker-compose.yml` (api + worker + beat + postgres:16 + redis:7).
- GitHub Actions `ci.yml`: ruff, ruff-format, mypy strict, pytest+coverage, alembic upgrade, docker build.
- Test suite: pytest-asyncio + httpx + aiosqlite + factory-boy; smoke + unit fixtures; ~12 tests covering health, security, config.

### Engineering invariants (locked)
- Money: `Decimal(18,4)` everywhere (never float).
- Time: UTC, tz-aware `datetime`; ISO-8601 on the wire.
- API: snake_case Python ↔ camelCase JSON via Pydantic `alias_generator=to_camel`.
- Lint: ruff + mypy strict; CI fails on any error.

### Known gaps
- Local `docker compose up` acceptance check deferred (Docker Desktop not installed on the dev workstation). Dockerfile + compose are CI-verified.
