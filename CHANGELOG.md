# Changelog

All notable changes documented per release. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), SemVer.

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
