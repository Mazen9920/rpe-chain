# RPE Gear

Python rewrite of the RPE supply OS per PDF v2.0 spec.

**Status:** v0.1.0 — Platform skeleton (in progress)

See `/memories/repo/rpe-gear-master-plan.md` (Copilot workspace memory) for the full release roadmap.

## Stack

- Python 3.12 · FastAPI · SQLAlchemy 2 async · Alembic
- Celery + Beat · Redis 7 · Postgres 16
- pytest · ruff · mypy strict
- Docker Compose for dev/prod

## Quick start (local dev, no Docker)

```bash
# Prereqs: python@3.12, uv, postgresql@16, redis
brew services start postgresql@16 redis
createuser -s rpe_user 2>/dev/null; createdb -O rpe_user rpe_gear 2>/dev/null

cp .env.example .env
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
# In other terminals:
uv run celery -A app.core.celery_app worker -l info
uv run celery -A app.core.celery_app beat -l info
```

Visit http://localhost:8000/docs

## Test

```bash
uv run pytest -q --cov=app
uv run ruff check . && uv run ruff format --check .
uv run mypy app/
```

## Docker (when available)

```bash
docker compose up --build
```
