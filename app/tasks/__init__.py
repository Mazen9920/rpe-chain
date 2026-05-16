"""Celery tasks. Synchronous DB session used here (Celery isn't async-friendly)."""

from __future__ import annotations

import asyncio
from datetime import date
from typing import Any

from app.core.celery_app import celery_app
from app.core.db import SessionLocal


@celery_app.task(name="rpe_gear.ping")  # type: ignore[untyped-decorator]
def ping() -> str:
    """Smoke task — used to verify worker connectivity."""
    return "pong"


@celery_app.task(name="rpe_gear.standard_cost.recompute_month")  # type: ignore[untyped-decorator]
def recompute_month_task(month_iso: str) -> dict[str, Any]:
    """Recompute all standard costs for a given month (YYYY-MM-DD, day=1)."""
    from app.services.standard_cost import recompute_all_for_month

    async def _run() -> dict[str, Any]:
        async with SessionLocal() as session:
            return await recompute_all_for_month(session, date.fromisoformat(month_iso))

    return asyncio.run(_run())
