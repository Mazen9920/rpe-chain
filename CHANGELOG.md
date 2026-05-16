# Changelog

All notable changes documented per release. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), SemVer.

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
