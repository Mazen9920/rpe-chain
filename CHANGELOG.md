# Changelog

All notable changes to RPE Chain Supply OS are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/) and SemVer.

## [1.7.0] — 2026-05-14 — Tier 4 #17 GL Export (QuickBooks / Xero)

Generate balanced double-entry GL journals from AP + AR ledger entries and push
them to QuickBooks Online or Xero via the existing outbox pattern. CSV export is
always available; live push is stubbed (simulated externalId) until real OAuth2
wiring lands in v1.7.1, while preserving the idempotency contract via
`GlJournal.externalId` + `GlJournal.exportProvider`.

### Added
- **Prisma models** (`backend/prisma/schema.prisma` — migration `20260514120230_gl_export_v1`):
  - `GlAccount` (code, name, `GlAccountType` enum [ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE], parent, isActive).
  - `GlAccountMapping` (eventType → debitAccountId + creditAccountId, unique on eventType).
  - `GlJournal` (journalNumber `GL-YYYYMM-NNNN`, sourceLedger, sourceEntryId UNIQUE for idempotency, sourceEntryType, postedAt, currency, totalAmount, exportedAt, exportProvider, externalId).
  - `GlJournalLine` (debit/credit decimal, account FK, cascade-on-journal-delete).
  - `GlIntegrationCredential` (provider, encrypted access/refresh tokens, expiresAt). For v1.7.1 OAuth.
- **`gl.service.js`** — accounts CRUD with in-use protection, mappings upsert/delete with allow-listed eventType validation, `generateForRange({from,to})` which:
  - Pulls AP+AR ledger entries in range, skips ones already journaled (via `sourceEntryId` UNIQUE),
  - Resolves mapping by `<LEDGER>_<ENTRY_TYPE>` (e.g. `AR_PAYMENT_RECEIVED`),
  - Creates balanced 2-line journals (Math.abs(amount) on each side),
  - Reports `created/skipped/errors[]` with reason codes (`MAPPING_REQUIRED`, `already_exported`, `zero_amount`),
  - Verifies `sum(debits) === sum(credits)` per journal before returning.
- **Routes** (`/api/gl/*`) — accounts, mappings, journals list/get/generate, `/journals/export.csv`, `/journals/:id/push/:provider`.
- **Outbox handlers** — `quickbooks` and `xero` targets, both action `journal.push`. Currently simulate a successful push (record `externalId` `QBO-SIM-...` / `XERO-SIM-...`) when `QUICKBOOKS_CLIENT_ID` / `XERO_CLIENT_ID` env vars are absent. Real OAuth2 + `JournalEntry` / `ManualJournals` API calls reserved for v1.7.1.
- **AES-256-GCM encryption helper** (`backend/src/lib/crypto.js`) — keyed off `JWT_SECRET`, ciphertext format `v1:<iv-b64>:<tag-b64>:<ct-b64>`. Earmarked for v1.7.1 OAuth token storage in `GlIntegrationCredential`.
- **Frontend `GlExportPage`** (`/gl-export`) — three tabs:
  - *Journals*: date range filter, **Generate journals** action, **Export CSV** download, row-level **QB** / **Xero** push buttons, drilldown drawer showing per-line debits/credits with running totals.
  - *Chart of Accounts*: list + inline create form + delete with in-use guard surfacing 409.
  - *Mappings*: dropdown per allowed eventType, debit/credit account pickers, upsert + delete.
- **Service typings** in `frontend/src/services/index.ts` — `glService` + `GlAccount`/`GlAccountMapping`/`GlJournal`/`GlJournalLine` interfaces.
- **Nav** — "GL Export" link added to `Layout` sidebar.

### RBAC
- **ADMIN**: full access to accounts, mappings, journals, push, CSV.
- **FINANCE**: read accounts/mappings, generate journals, list/CSV export, push.
- **All other roles**: 403 on `/api/gl/*` (verified by test).

### Idempotency
- `GlJournal.sourceEntryId` is UNIQUE — re-running `generate` over the same range produces 0 new journals (`skipped:'already_exported'`).
- `pushJournal` enqueues an outbox row with `idempotencyKey=gl:<provider>:<journalId>`. The handler short-circuits if `externalId` is already set for the same provider.

### Smoke matrix
`backend/scripts/test-gl.sh` — 15 assertion groups covering: anon 401, SALES 403, account CRUD + validation, mapping upsert + invalid eventType, journal generation over 90-day range, balance check (debits=credits), CSV export shape, simulated QuickBooks push via `outbox.processBatch`, invalid provider 400, idempotent re-generation (0 new on second run), unmapped event-type detection, in-use account delete 409. Wired into `run-all-tests.sh`.

### Out of scope (v1.7.1)
- Real OAuth2 connect flow (`/api/integrations/quickbooks/connect`, `/xero/connect`) and live API calls.
- Inventory GL journals (only AP + AR ledger today).
- Reversal entries for `INVOICE_VOIDED` / `PAYMENT_VOIDED` (entries are recorded but their reversal accounting depends on customer policy).

Tags: `gl-v1.0`, `v1.7.0`.

## [1.6.0] — 2026-05-14 — Tier 4 #16 Mobile Pick/Pack + Barcode

Touch-first mobile picking and packing screens with camera barcode scanning,
delivered as new `/m/*` routes on top of a responsive `Layout` shell. Builds
entirely on existing pick/pack endpoints and `/inventory/lookup`.

### Added
- **`useBarcodeScanner` hook** (`frontend/src/hooks/useBarcodeScanner.ts`) —
  wraps `@zxing/browser` `BrowserMultiFormatReader`, prefers the rear camera
  (`facingMode: 'environment'`), debounces identical scans (default 1.5 s),
  exposes `{videoRef, start, stop, scanning, error}`. Falls back transparently
  to keyboard-input `BarcodeInput` for hardware scanners.
- **`MobileLayout`** (`frontend/src/components/MobileLayout.tsx`) — full-screen
  shell with a sticky top bar (back, title, sign-out). Skips the desktop
  sidebar entirely for mobile flows.
- **`/m` mobile worklist** (`pages/mobile/MobileWorklistPage.tsx`) — buckets
  sales orders by status: `ALLOCATED` → "Ready to pick", `PICKED` → "Ready
  to pack". Large tap targets.
- **`/m/pick/:soId`** (`MobilePickPage.tsx`) — per-line pick UI with camera
  scanner, `BarcodeInput`, manual ±/numeric entry, line-level done indicator,
  sticky "Confirm pick" button. Scans resolve via `/inventory/lookup`; matching
  by `productId` increments that line's `qtyPicked` (capped at `qtyAllocated`).
- **`/m/pack/:soId`** (`MobilePackPage.tsx`) — per-line "verify" toggles with
  camera + keyboard scanning, sticky "Confirm pack" (calls existing pack
  endpoint which has no per-line body).
- **Desktop nav entry**: "Mobile Pick/Pack" link added to `Layout` sidebar.

### Changed
- **`Layout.tsx`** is now responsive — sidebar collapses to a hamburger drawer
  below the `md` breakpoint with focus-trap-like backdrop overlay; nav links
  auto-close the drawer on tap.
- **`PickPayload` field correction**: `linePicks[].salesOrderLineId` →
  `linePicks[].lineId` to match what `salesOrder.service.pickOrder` actually
  reads. Fixed in `frontend/src/types/fulfillment.ts` and the call site in
  `SalesOrderDetailPage.tsx`. Before this fix the backend silently fell back
  to `qtyAllocated`; pick quantities now propagate correctly.
- **`ShipPayload.lines[]`**: same `salesOrderLineId` → `lineId` correction for
  type consistency (no current call sites use this field).

### Dependencies
- Added `@zxing/browser` (~80 KB minified) to `frontend/`.

### RBAC
Mobile UI uses existing endpoints. `/inventory/lookup` allows any authenticated
role (incl. WAREHOUSE); `/sales-orders/:id/pick` & `/pack` require ADMIN,
SALES, or WAREHOUSE.

### Smoke matrix
`backend/scripts/test-mobile.sh` — 6 assertions covering 401 on anonymous
lookup, SKU lookup returns `type=PRODUCT`, unknown code returns 404,
WAREHOUSE role allowed, and end-to-end pick with explicit
`linePicks:[{lineId,qtyPicked}]` advances the SO to `PICKED` with the
correct `qtyPicked` value on each line. Wired into `run-all-tests.sh`.

### Out of scope
- PWA manifest / install prompt.
- Bin-level pick UI (no bin reference on `SalesOrderLine`).
- Offline mode.

Tags: `mobile-v1.0`, `v1.6.0`.

## [1.5.0] — 2026-05-14 — Tier 4 #15 Custom Reports + Scheduled Exports

Saved report definitions, multi-format rendering (CSV / XLSX / PDF), and
recurring cron-driven email delivery via the outbox.

### Added
- **Data model**: `ReportDefinition` (id, name, description, reportKey, params
  JSON, isShared, ownerId, soft-delete) and `ReportSchedule` (cron, format,
  recipients[], isActive, lastRunAt, nextRunAt) with cascading FK.
- **Report registry** (`reports.service.js`) — four built-in builders:
  `ap-aging`, `ar-aging`, `supplier-scorecards`, `sales-fulfillment`. Each
  returns a normalised envelope `{title, columns, rows, summary}` with column
  format hints (`date`, `datetime`, `money`, `pct`).
- **Renderer** (`reportRenderer.service.js`) — CSV (escaped), XLSX (ExcelJS,
  auto-width + `numFmt` per format), PDF (PDFKit A4 landscape, 5000-row safety
  cap, paginated). Returns `{contentType, filename, buffer}`.
- **Definition CRUD** (`reportDefinition.service.js`) — visibility-aware list,
  `isShared` publishing restricted to ADMIN/FINANCE, soft delete via
  `deletedAt`, owner / role-based access checks.
- **Schedule CRUD + dispatch** (`reportSchedule.service.js`) — cron validation
  via `cron-parser`, recipient email validation, `dispatchDue()` claims up to
  50 due active schedules per tick and enqueues outbox rows
  (`target='SCHEDULED_REPORT', action='RENDER_AND_EMAIL'`), advances
  `nextRunAt`. `runNow` enqueues immediately. `handleScheduledReport` builds
  + renders + enqueues email row with base64 attachment.
- **Outbox integration**: new handler `scheduledReport/handler.js` registered
  for `SCHEDULED_REPORT`. Email handler now forwards `attachments[]` to mailer.
- **Mailer attachments**: `mailer.sendEmail` accepts `attachments:
  [{filename, content_b64}]`; SendGrid path emits `disposition:'attachment'`,
  SMTP path uses Buffer attachments, noop path logs `[{filename, bytes}]`.
- **Scheduler hook**: `runReportScheduleDispatch()` registered on `*/5 * * * *`
  alongside existing jobs.
- **REST API** (mounted at `/api/reports`):
  - `GET  /definitions/available` — list registered report keys.
  - `GET  /definitions`, `GET /definitions/:id`,
    `POST /definitions`, `PATCH /definitions/:id`, `DELETE /definitions/:id`.
  - `GET  /schedules`, `GET /schedules/:id`,
    `POST /schedules`, `PATCH /schedules/:id`, `DELETE /schedules/:id`,
    `POST /schedules/:id/run-now`.
  - `GET  /render?reportKey=&format=` and
    `GET  /render/definition/:id?format=` — ad-hoc / saved-def rendering with
    `Content-Disposition: inline` (or `attachment` when `?download=1`).
- **Frontend**:
  - `reportDefinitionService` / `reportScheduleService` with TS types and a
    `download(id, format, filenameHint?)` helper that parses
    `Content-Disposition` and triggers a real `<a download>` click.
  - New **Saved Reports** tab inside `ReportsPage.tsx`
    (`SavedReportsTab.tsx`): saved-definition list with CSV/XLSX/PDF
    download menu, definition drawer (name, description, report key, params
    JSON, shared toggle), schedule drawer (cron presets + raw editor,
    format buttons, recipients textarea), per-schedule run-now and delete.

### Changed
- `mailer.sendEmail` signature now accepts `attachments` and forwards through
  all three modes (sendgrid / smtp / noop).
- `email` outbox handler forwards `p.attachments` when present.

### Migrations
- `20260514113129_add_report_definitions` — creates `ReportDefinition`,
  `ReportSchedule`, and two reverse relations on `User`
  (`ReportDefinitionCreatedBy`, `ReportScheduleCreatedBy`).

### RBAC
| Endpoint                              | Roles                                                         |
| ------------------------------------- | ------------------------------------------------------------- |
| `GET  /reports/definitions*`          | ADMIN, PROCUREMENT, WAREHOUSE, SALES, FINANCE, AUDITOR, READ_ONLY (visibility-filtered) |
| `POST/PATCH/DELETE /reports/definitions` | ADMIN, FINANCE, PROCUREMENT, SALES (publishing `isShared=true` restricted to ADMIN/FINANCE) |
| `POST/PATCH/DELETE /reports/schedules`, `POST /reports/schedules/:id/run-now` | ADMIN, FINANCE |
| `GET  /reports/render*`               | All 7 roles                                                   |

### Dependencies
- Added `pdfkit`, `exceljs`, `cron-parser` to `backend/`.

### Smoke matrix
`backend/scripts/test-reports.sh` — 23 assertions covering RBAC, all three
renderers (CSV/XLSX/PDF), definition CRUD + visibility (private vs shared,
SHARED_FORBIDDEN), schedule CRUD with cron / format / recipient validation,
run-now, and end-to-end outbox dispatch (`SCHEDULED_REPORT` row →
synthesised email outbox row with PDF attachment → both reach `SENT`).
Wired into `run-all-tests.sh` under the Tier 4 section.

Tags: `reports-v1.0`, `v1.5.0`.

## [1.4.0] — 2026-05-14 — Tier 4 #14 Accounts Receivable

End-to-end customer billing on top of v1.3.0. Mirrors the v1.0 AP module
(invoices, payments with multi-invoice application, aging buckets, credit
notes, alerts) but specialised for outbound billing — including automatic
invoice generation when a shipment is marked `DELIVERED`.

### Added
- **AR data model**: `CustomerInvoice` (DRAFT/POSTED/PARTIALLY_PAID/PAID/VOID),
  `CustomerInvoiceLine`, `CustomerPayment` (POSTED/VOIDED), `CustomerPaymentApplication`,
  `ArLedgerEntry`. `shipmentId` is `UNIQUE` on `CustomerInvoice` so re-running
  billing for a shipment is naturally idempotent; `@@unique([customerId, invoiceNumber])`
  prevents duplicates per customer.
- **`/api/ar/invoices`**: list (filters by customer/SO/shipment/status), KPIs,
  create POSTED with auto `CIV-YYYYMM-NNNN` numbering, fetch by id, void
  (admin-only, blocked when `paidAmount > 0` → `INVOICE_HAS_PAYMENTS`).
- **`/api/ar/invoices/generate-from-shipment`**: builds a `CustomerInvoice`
  from a `Shipment` + its `SalesOrder` lines; idempotent (returns existing
  invoice with `created:false` on re-run).
- **`/api/ar/payments`**: record customer payments with multi-invoice
  applications, cross-currency FX (`FX_RATE_REQUIRED` when missing),
  over-application guard (`OVER_APPLICATION`), admin-only void that
  reverts invoice state and blocks if a later payment touched the same
  invoice (`PAYMENT_LOCKED`).
- **`/api/ar/aging`** + `/summary` + `/:customerId/statement`: open-balance
  aging in 5 buckets (CURRENT, 1–30, 31–60, 61–90, OVER_90) with
  reporting-currency conversion (re-using the v1.3.0 FX engine) and a
  per-customer ledger statement.
- **`/api/ar/credit-notes`**: negative-amount credit notes linked to an
  original invoice (`creditedInvoiceId`).
- **Auto-billing on delivery**: `shipment.service.markDelivered()` now calls
  `arBilling.generateFromShipment()` in a try/catch after `SHIPMENT_DELIVERED`
  is logged; failures are surfaced as console errors but do not roll back
  the delivery transaction.
- **Alerts (Section 11 extension)**: new `CUSTOMER_INVOICE_DUE` (severity by
  days-to-due) and `CUSTOMER_OVERDUE` (severity by days-past-due) channels,
  audited under the FINANCE/SALES audiences. Wired into `scanArAlerts()` and
  `runAllScans()` (`ar.active` in `/alerts/scan` response).
- **Frontend**: new `/ar` workspace with Invoices, Payments, Aging, and
  Credit Notes tabs; detail pages at `/ar/invoices/:id` and
  `/ar/payments/:id` (status pill, line items, applications, void actions);
  AR Invoices section on the Sales Order detail; AR Aging report tab on
  Reports. Sidebar nav entry "Accounts Receivable".

### Changed
- `shipment.service.markDelivered()` — adds AR auto-billing hook after the
  delivery event is logged; the AR call is best-effort and isolated from
  the delivery transaction.
- `alerts.service.AUDIENCE` map extended with the two new AR keys.
- `alerts.service.runAllScans()` summary now reports an `ar` section.

### Migrations
- `20260514104811_add_ar_models` — adds `CustomerInvoice`,
  `CustomerInvoiceLine`, `CustomerPayment`, `CustomerPaymentApplication`,
  `ArLedgerEntry`, plus `CustomerInvoiceStatus` and `CustomerPaymentMethod`
  enums. Unique constraints on `(customerId, invoiceNumber)` and on
  `shipmentId` for idempotency.

### RBAC
- `AR_READ = [ADMIN, FINANCE, SALES]` (lists, KPIs, aging, statements).
- `AR_WRITE` for invoices = `[ADMIN, FINANCE, SALES]` (SALES can post their
  own invoices); `AR_WRITE` for payments + credit notes = `[ADMIN, FINANCE]`.
- `AR_ADMIN = [ADMIN]` for void operations on invoices and payments.

### Smoke matrix
13 backend smoke scripts pass end-to-end (adds `test-ar.sh`, 25 assertions).
`test-fulfillment.sh` extended with two new assertions (22a/22b) that the
delivery flow auto-creates the AR invoice and that
`generate-from-shipment` is idempotent. Frontend `tsc --noEmit` clean.

## [1.3.0] — 2026-05-14 — Tier 3 intelligence (Sections 11–14)

Intelligence sprint on top of v1.2.0. Closes the operational loop with
anomaly-driven alerts, ABC/XYZ classification + dynamic reorder points,
tolerance-banded 3-way match with EXCEPTION workflow, and a multi-currency
hardening pass that turns FX into a first-class concern.

### Added
- **Phase A — Anomaly alerts (Section 11)**: rolling-window detector emits
  `MARGIN_EROSION`, `PRICE_SPIKE`, `STOCKOUT_RISK`, `OVERSTOCK`, and
  `DEMAND_SPIKE` alerts with severity scoring. New `AlertRule` registry with
  per-type `enabled`/`params` toggles (admin-only). `POST /alerts/scan`
  triggers a manual sweep; scheduler runs hourly. Dashboard alerts trend
  chart over 30 days.
- **Phase B — ABC/XYZ + dynamic ROP (Section 12)**: monthly classification
  job tags every product with `abcClass ∈ {A,B,C}` (revenue Pareto) and
  `xyzClass ∈ {X,Y,Z}` (demand-variability via coefficient of variation).
  Dynamic reorder point computed from rolling demand × lead-time + safety
  stock z-score scaled by XYZ class. Manual recompute via
  `POST /classification/recompute`. Inventory list surfaces ABC/XYZ badges
  and the dynamic vs. static ROP delta.
- **Phase C — 3-way-match tolerance bands (Section 13)**: per-supplier
  `qtyPct`/`pricePct` overrides on top of admin-managed globals (default
  2%/1%, bounds 0–20%). Match engine honours band on PO line vs. GRN qty
  and PO unit price vs. invoice price; out-of-band match flips invoice to
  `EXCEPTION` and emits a `MATCH_EXCEPTION` alert (severity by deviation).
  Settings UI under `/settings` (admin-only edit, finance read-only).
  `POST /alerts/scan` extended to report match-exception counts.
- **Phase D — Multi-currency hardening (Section 14)**: FxRate registry
  (manual entry today, source field forward-compatible with live feeds)
  with history-aware lookup (direct → inverse → USD pivot). Dashboard
  summary + sales-trend + AP-aging summary accept `?reportingCurrency`
  and convert on-the-fly using the FX engine; AP aging additionally
  exposes a `byCurrency` breakdown of native balances. Silent
  `|| 'USD'` fallbacks stripped at money-document creation
  (PO/Invoice/CreditNote/Payment): missing currency now returns
  `400 CURRENCY_REQUIRED`. Cross-currency payment application without
  `fxRate` returns `400 FX_RATE_REQUIRED`. New admin page
  `/settings/fx` for rate management and a `formatMoney/Number/Percent`
  utility that replaces five ad-hoc formatters across the frontend.

### Changed
- Dashboard StatCards and trend charts now render values in the selected
  reporting currency; the dropdown persists in `localStorage`.
- AP Aging summary response shape extended (`reportingCurrency`,
  `byCurrency`) — additive, existing fields preserved.
- AlertRule rows seeded for the five new anomaly types and the
  `MATCH_EXCEPTION` channel.

### Migrations
- `20260514_anomaly_alert_rules` — AlertRule seed for anomaly types.
- `20260514_abc_xyz` — `Product.abcClass`/`xyzClass`/`dynamicROP`.
- `20260514_match_tolerances` — `Supplier.matchQtyPct`/`matchPricePct`
  + Settings row for globals.
- `20260514101959_fx_rates` — FxRate table + index
  `(baseCurrency, quoteCurrency, effectiveAt)`.

### Smoke matrix
12 backend smoke scripts pass end-to-end:
`test-foundations.sh`, `test-auth-hardening.sh`, `test-suppliers.sh`,
`test-procurement.sh`, `test-manufacturing.sh`, `test-fulfillment.sh`,
`test-ap.sh`, `test-shopify.sh`, `test-bosta.sh`,
`test-anomaly-alerts.sh`, `test-classification.sh`,
`test-match-tolerances.sh`, `test-fx.sh`. Frontend `tsc --noEmit` and
`vite build` both clean.

## [1.2.0] — 2026-05-13 — Tier 2 integrations (Section 9)

External-system connectivity sprint on top of v1.1.0. Adds the integration
foundations (HMAC signing, outbox pattern, storage abstraction, mailer), a
multi-channel notification layer, lot-recall compliance workflow, Shopify
inbound order sync, and Bosta outbound shipment sync.

### Added
- **Phase A — Foundations**: durable Outbox model + worker
  (`SKIP LOCKED` claim, exponential backoff `[1, 5, 30, 120, 720, 1440]` min,
  `MAX_ATTEMPTS=6`, terminal `DEAD` state, unique `idempotencyKey`);
  `registerHandler(target, fn)`, `enqueue(...)`, `processBatch()`. HMAC
  webhook-signature middleware factory `verifyHmac({headerName, secretEnv,
  algo, encoding})` that reads the raw body before `express.json()` and is
  bypassed via `WEBHOOK_SIGNATURE_DISABLED=true` for local dev. Storage
  abstraction (`STORAGE_DRIVER=s3|local`) with `putObject/getObject/
  getSignedUrl/deleteObject`. Mailer pipeline (SendGrid → SMTP → noop).
  Outbox scheduler tick every minute.
- **Phase B — Notifications**: in-app + email notifications keyed off
  `eventType`; user subscription preferences; daily digest at 07:00 UTC.
  Email handler is an outbox target → idempotent retries.
- **Phase C — Compliance**: lot-recall workflow with `LOT_RECALLED` audit
  event, downstream `CRITICAL` alert emission, and automatic blocking of
  recalled lots in fulfillment allocation.
- **Phase D — Shopify**: inbound `orders/create` webhook (raw body + HMAC
  via `X-Shopify-Hmac-Sha256`), idempotent mapper (`source=SHOPIFY`,
  `externalId`), unknown-SKU skip with `SHOPIFY_ORDER_SKIPPED` audit,
  outbound `inventory.set` + `fulfillment.create` outbox actions triggered
  on `shipOrder`, registration script for webhooks, product-level external
  ID mapping (Shopify modal in inventory), source filter on Sales Orders.
- **Phase E — Bosta**: outbound `delivery.create` outbox action on
  shipment creation when `carrier='BOSTA'`, label PDF stored under
  `bosta-labels/<shipmentId>.pdf`, `GET /api/shipments/:id/label`
  returning a 5-minute signed URL, Download Label button on the
  shipment detail page. Inbound `POST /api/webhooks/bosta/tracking`
  HMAC-verified, idempotent (uses `Shipment.lastTrackingEventId`),
  persists `TrackingEvent` rows, maps Bosta state codes to
  `ShipmentStatus`, propagates `DELIVERED` to `SalesOrder.deliveredAt`,
  and auto-resolves open `SHIPMENT_DELAY` alerts on delivery.

### Schema
- `Outbox` model (target, action, payload, status, attempts, nextAttemptAt,
  idempotencyKey).
- `SalesOrder.source` + `SalesOrder.externalId` for inbound ingestion.
- `Product.externalIds` (Json) for per-channel mappings.
- `Shipment.labelKey` + `Shipment.lastTrackingEventId` for label storage
  and idempotent tracking webhooks.
- `TrackingEvent` model.
- Notification + NotificationSubscription models.

### Smoke tests (all green)
- 7 core suites (inventory, manufacturing, suppliers, procurement,
  ap-ledger, fulfillment, alerts-reporting, auth-hardening).
- Section 9 suites: `test-foundations.sh`, `test-notifications.sh`,
  `test-compliance.sh`, `test-shopify.sh`, `test-bosta.sh` (incl. HTTP
  webhook path with `WEBHOOK_SIGNATURE_DISABLED=true`).
- Frontend `npx tsc --noEmit` clean; production build succeeds.
- `npx prisma validate` clean.

## [1.1.0] — 2026-05-13 — Tier 1 hardening (Section 8)

Production-readiness sprint on top of v1.0.0. No new business features — pure
hardening of deployment, observability, durability, and auth.

### Added
- **Docker**: multi-stage Dockerfiles for backend (node:24-alpine, non-root) and
  frontend (build + nginx serve), full-stack `docker-compose.yml` with postgres
  healthcheck, backend healthcheck on `/api/ready`, and optional pgadmin profile.
  `.env.example` documents all configuration knobs.
- **CI** (`.github/workflows/ci.yml`): validate, full smoke test suite against a
  postgres:16 service container, and docker image build jobs.
- **Observability**: pino structured JSON logs with redact paths for auth/secret
  fields, request-id middleware, `/api/health` (always 200) and `/api/ready`
  (DB ping → 503 on failure), graceful SIGTERM/SIGINT shutdown, optional Sentry
  (backend + frontend, no-op when DSN unset), frontend `ErrorBoundary`.
- **Backups**: `backend/scripts/backup.sh` (pg_dump custom format + retention),
  `backend/scripts/restore.sh` with confirmation, runbook + restore-drill record
  (RPO 24h / RTO 1h baseline).
- **Auth hardening (Section 8)**:
  - 15-minute access JWT + 30-day DB-backed refresh tokens (SHA-256 hashed).
  - Refresh-token rotation on every use; reuse-detection revokes the entire
    user's refresh family.
  - 5-failure account lockout for 30 minutes (HTTP 423).
  - Optional TOTP MFA via speakeasy with 5-min mfa-challenge JWT between the
    password step and the code step.
  - `express-rate-limit` on `/auth/login` (IP + email) and `/auth/refresh`;
    bypassed via `RATE_LIMIT_DISABLED=true` for tests.
  - Frontend: persisted refresh token, axios `401 → /auth/refresh → retry`
    interceptor with single-flight de-dupe, MFA challenge UI in `LoginPage`.
  - `backend/scripts/test-auth-hardening.sh` — 14/14 cases passing.
- **Smoke aggregator**: `backend/scripts/run-all-tests.sh` runs all 7 suites and
  reports a single pass/fail; wired as `npm run test:smoke`.

### Changed
- `backend/src/app.js`: replaced morgan with pino-http; trust proxy enabled.
- `backend/src/index.js`: Sentry must load first; logger replaces console.
- Refresh response shape standardized to `{ token, refreshToken, user }`.

### Migrations
- `20260513153609_section8_auth_hardening`: adds `failedLoginCount`,
  `lockedUntil`, `totpSecret`, `totpEnabled`, `lastLoginAt` to `User`, plus the
  new `RefreshToken` model with cascade-on-delete and indexed `userId` /
  `expiresAt`.

### Verified
- All 7 smoke suites green (inventory, manufacturing, suppliers, procurement,
  ap-ledger, fulfillment, alerts-reporting, auth-hardening).
- Backup taken + real restore drill into a sidecar DB → row counts match.

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
