# Changelog

All notable changes to RPE Chain Supply OS are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/) and SemVer.

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
