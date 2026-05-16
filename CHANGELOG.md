# Changelog

All notable changes documented per release. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), SemVer.

## [0.4.0] — Cash-in Reconciliation: Paymob · Bosta COD · Bank · Chargebacks (Phase A of v0.4.0 split)

> This is **Phase A** of the original v0.4.0 master-plan ticket. Phase B (production-order MRP + RMA/returns) is now scheduled for v0.4.1. The split keeps each release small enough to ship + verify in isolation while preserving the cash-side automation theme.

### Added
- **Models** (`app.models.payments`): `paymob_transactions` (external_id UNIQUE, status CAPTURED/SETTLED/REFUNDED/CHARGEBACK/VOIDED, payment_method CARD/WALLET/INSTALLMENTS/KIOSK/OTHER, gross/fees/net Numeric(18,4), settlement_ref + posted_journal_id traceability, raw_payload JSON); `cod_ledger` (tracking_id UNIQUE, status PENDING/IN_TRANSIT/DELIVERED_UNREMITTED/DELIVERED_REMITTED/RETURNED/VOIDED, shipped_at/delivered_at/remitted_at, remittance_ref); `bank_accounts` + `bank_transactions` (status UNMATCHED/MATCHED/IGNORED, signed amount, UNIQUE(bank_account_id, external_ref), matched_type AP_PAYMENT/AR_PAYMENT/PAYMOB_SETTLEMENT/BOSTA_REMITTANCE/MANUAL); `chargebacks` (status OPEN/WON/LOST/CANCELLED, FK paymob_transactions RESTRICT, raised_journal_id + resolved_journal_id).
- **Integrations**:
  - `app.integrations.paymob.client.PaymobClient` (httpx.AsyncClient, JWT auth via `/auth/tokens`, `list_transactions`, `get_transaction`).
  - `app.integrations.paymob.settlement_csv.parse_settlement_csv` — Paymob CSV statement parser with header aliases (transaction_id/txn_id, amount/amount_egp, fees/processing_fee, net auto-computed if absent, captured_at/settled_at multi-format datetime).
  - `app.integrations.bosta.client.BostaClient` (raw API-key header per Bosta convention, `list_deliveries`, `get_delivery`).
  - `app.integrations.bosta.remittance_csv.parse_remittance_csv` — Bosta remittance CSV parser (tracking_number/awb/awb aliases, cod/cod_amount, batch/statement_ref).
- **Services**:
  - `app.services.paymob_recon.ingest_settlement_rows` — upsert by external_id; on SETTLED transition posts **DR 1020 Bank (net) + DR 7010 Gateway Fees (fees) / CR 1110 AR-Paymob (gross)**; idempotent via `posted_journal_id`. `ar_paymob_outstanding` for acceptance test.
  - `app.services.cod_ledger.record_shipment` — DR 1120 AR-Bosta / CR 1100 AR (sub-ledger transfer). `apply_remittance_rows` — DR 1020 Bank / CR 1120 AR-Bosta per delivered tracking_id (delivery fees DR 6140). `mark_delivered`, `mark_returned`, `mark_voided`, `void_rate(window_days)` for COD health monitoring.
  - `app.services.bank_recon.import_statement` (dedupes by `(bank_account_id, external_ref)`). `auto_match_unmatched` — matches Paymob settlement batches (settlement_ref substring + Σnet equality) and Bosta remittances (remittance_ref substring + Σcod equality) without posting duplicate GL.
  - `app.services.chargebacks.raise_chargeback` — DR 1130 AR-Chargeback / CR Bank-or-AR-Paymob (depending on settled state); flips PaymobTransaction.status → CHARGEBACK. `resolve_chargeback` — WON: DR Bank / CR 1130; LOST: DR 7010 Gateway Fees / CR 1130; CANCELLED: reverse the raise.
- **Celery Beat automation** (extends v0.3.1 theme):
  - `daily-paymob-recon` — `crontab(minute=0, hour=6)` pulls Paymob `/acceptance/transactions` and posts settlement journals.
  - `daily-bosta-status-sync` — `crontab(minute=0, hour=7)` syncs delivery state into COD ledger (transient API errors swallowed per record).
  - `daily-cod-void-rate-check` — `crontab(minute=30, hour=7)` alerts when COD void rate exceeds 10% over last 30 days.
  - `daily-bank-auto-match` — `crontab(minute=0, hour=8)` runs `auto_match_unmatched`.
- **API endpoints** (under `/api/v1`):
  - `POST /paymob/settlements/import` (multipart CSV), `GET /paymob/transactions`.
  - `POST /cod/shipments`, `POST /cod/shipments/{tracking_id}/deliver`, `POST /cod/remittances/import`, `GET /cod/entries`, `GET /cod/void-rate`.
  - `POST /banking/accounts`, `GET /banking/accounts`, `POST /banking/statements/import`, `GET /banking/accounts/{id}/transactions`, `POST /banking/auto-match`.
  - `POST /chargebacks`, `POST /chargebacks/{id}/resolve`, `GET /chargebacks`.
- **Schemas** (`app.schemas.v4`): `_CamelBase` (alias_generator=to_camel, populate_by_name, from_attributes) for all new request/response types.
- **Config**: `paymob_api_key`, `bosta_api_key` (env-driven, empty default; clients return `{skipped: true, reason: "no_api_key"}` when absent so dev/staging don't fail).
- **Errors**: `ReconciliationError`, `ChargebackError`, `CODVoidRateAlert` (all 409).
- **Tests**: 20 new tests across `test_paymob_recon.py`, `test_cod_ledger.py`, `test_bank_recon.py`, `test_chargebacks.py`. Includes the master-plan **§223 acceptance test**: 100 Paymob captures → settle → reconcile → assert `1110 AR-Paymob` outstanding == 0.

### Migrations
- `0006_paymob_bosta_bank_chargebacks` — 5 new tables with full FK/CHECK/UNIQUE/indexes.

### Quality gates
- 90/90 tests pass (70 from v0.3.x + 20 new).
- `ruff check`, `ruff format`, `mypy --strict` all clean.

### Deferred to v0.4.1 (Phase B)
- Production orders (BOM explosion, work centers, capacity, MO statuses, WIP accounting).
- RMA / returns processing.

---

## [0.3.1] — AR · Recognition · Period Close · Financial Reports · 27 Audit Checks · Automation

### Added
- **Accounts Receivable**: `customer_invoices` + `customer_invoice_lines` (AR# `AR{YYYYMM}{seq:04d}`, type STANDARD/CREDIT_NOTE, status DRAFT/POSTED/PARTIALLY_PAID/PAID/VOID, `posted_journal_id` traceability), `ar_payments` + `ar_payment_applications` (RC# `RC{YYYYMM}{seq:04d}`, method CASH/BANK/PAYMOB/BOSTA_COD/CHEQUE/EFT).
- **AR service** (`app.services.ar`): `post_invoice` (DR 1100 AR / CR 4010 Revenue + 2050 VAT + 4020 Shipping); `post_invoice_for_shipment` (idempotent via shipment_id; called automatically from `sales.ship` wrapped in `try/except AccountNotFoundError` to remain backwards-compatible with un-seeded test fixtures); `register_payment` (oldest-first auto-application, posts DR cash / CR AR, updates invoice status); `aging_buckets(as_of)` → {current, 1_30, 31_60, 61_90, 90_plus}; `outstanding_total`.
- **Period Close**: `accounting_periods` (year, month, status OPEN/CLOSING/LOCKED/REOPENED, locked_at, locked_by). `period_close.close(year, month, locked_by)` flips OPEN→CLOSING, runs all 27 audit checks, requires every BLOCKER to pass before flipping to LOCKED; on failure raises `AuditFailedError(409, period_locked stays CLOSING for retry)` with failure details. `period_close.reopen` returns LOCKED→REOPENED→OPEN. `gl.post_journal` calls `_ensure_period_open(event_date)` so a posting into a LOCKED period raises `PeriodLockedError(409)`.
- **Revenue/Expense Recognition**: `expense_contracts` (ONE_OFF/MONTHLY/PREPAID/ACCRUED, start_date/end_date, total_amount/monthly_amount, debit & credit account codes), `recognition_entries` (UNIQUE (contract_id, period_id), `posted_journal_id`). `recognition.schedule_contract` computes monthly_amount = total/period_months. `recognition.recognize_for_period` is idempotent (returns existing entry if exists; catches IntegrityError on race; skips LOCKED periods; auto-marks COMPLETED at end_date). `recognition.run_monthly_recognition(year, month)` iterates all ACTIVE contracts whose window covers the period.
- **Financial Reports** (`app.services.reports`): driven entirely off `GLAccount.account_type`, `bs_tag`, `cf_tag` so new accounts update reports automatically.
  - `pnl(period_start, period_end)` — revenue, COGS, gross_profit, opex, operating_income, net_income.
  - `balance_sheet(as_of)` — assets, liabilities, equity (incl. computed `retained_earnings` = cumulative REV − EXP), `balanced` flag (Assets == Liabilities + Equity within 0.01).
  - `cash_flow(period_start, period_end)` — direct-method: finds all journals touching cash accounts (`bs_tag='cash'`), classifies each counter row by `cf_tag` (operating/investing/financing), proportionally allocates cash delta across counter rows.
- **27 Audit Checks** (`app.services.audit`): registered as `AuditCheck(name, severity, fn)` in `CHECKS` list with `assert len(CHECKS) == 27`. Severities BLOCKER/WARN/INFO. Includes: trial balance balanced, no draft/future/zero-amount/duplicate-numbered journals, AP+AR subledger ties to GL, no negative inventory, no orphan journals, shipments have revenue, supplier/customer invoices posted, recognition complete + balanced, payments not over-applied, cash positive, CoA intact, currency consistency. `run_audits(session, period)` persists `audit_check_results` rows. `list_checks()` exposes the registry via `GET /audits`.
- **Celery Beat automation** (per master plan: "everything automated as much as we can"):
  - `monthly-recognition` — `crontab(minute=0, hour=2, day_of_month=1)` runs `run_monthly_recognition_task` for the current month.
  - `monthly-close-attempt` — `crontab(minute=0, hour=3, day_of_month=5)` runs `attempt_close_previous_month_task` (catches `AuditFailedError` → returns `ok=False` with failure details for ops dashboard).
  - `daily-audit-snapshot` — `crontab(minute=0, hour=4)` runs `run_audit_snapshot_task` (auto-creates the current month period if missing, runs all 27 checks, persists results — turns "did this break today?" into a queryable timeseries).
- **API endpoints** (all under `/api/v1`):
  - `POST /customer-invoices`, `GET /customer-invoices`, `GET /customer-invoices/{id}`
  - `POST /ar-payments`, `GET /ar-payments`
  - `GET /ar-aging?as_of=YYYY-MM-DD`
  - `POST /periods`, `GET /periods`, `GET /periods/{year}/{month}`
  - `POST /periods/close`, `POST /periods/reopen`
  - `POST /expense-contracts`, `GET /expense-contracts`
  - `POST /recognition/run` (per-contract or all-ACTIVE)
  - `GET /reports/pnl?period_start=…&period_end=…`
  - `GET /reports/balance-sheet?as_of=…`
  - `GET /reports/cash-flow?period_start=…&period_end=…`
  - `GET /audits` (registry), `GET /audits/results?year=&month=`
- **Schemas** (`app.schemas.v3_1`): Pydantic v2 camelCase via `_Camel` base; AR aging exposes `current`, `1_30`, `31_60`, `61_90`, `90_plus` as Field aliases.
- **Migration `0005_recognition_close_ar`**: 7 new tables (accounting_periods, expense_contracts, recognition_entries, audit_check_results, customer_invoices, customer_invoice_lines, ar_payments, ar_payment_applications) with FKs/UNIQUE/CHECK constraints.
- **Tests**: +8 — `test_close_v031.py` covers period creation, blocked posting into locked period, AR invoice post + payment auto-application, aging buckets, recognition idempotency, audit registry size = 27, deliberate broken state → `AuditFailedError(409)`, balance sheet balanced flag. **70/70 tests pass.**

### Acceptance (master plan §199-202)
- `GET /audits` returns all 27 named checks with severity. ✓
- Deliberately broken state (future-dated journal) makes `POST /periods/close` raise `AuditFailedError(409, code="audit_failed")` with full failure list; period stays in CLOSING so user can fix and retry. ✓
- P&L/BS/CF reports run off `bs_tag`/`cf_tag` (zero hard-coded account codes in reports.py). ✓
- Posting into a LOCKED period raises `PeriodLockedError(409, code="period_locked")`. ✓
- Celery Beat schedule wired (monthly recognition day 1 / monthly close attempt day 5 / daily audit snapshot). ✓

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
