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


def _prev_month(today: date | None = None) -> tuple[int, int]:
    today = today or date.today()
    if today.month == 1:
        return today.year - 1, 12
    return today.year, today.month - 1


@celery_app.task(name="rpe_gear.standard_cost.recompute_month")  # type: ignore[untyped-decorator]
def recompute_month_task(month_iso: str) -> dict[str, Any]:
    """Recompute all standard costs for a given month (YYYY-MM-DD, day=1)."""
    from app.services.standard_cost import recompute_all_for_month

    async def _run() -> dict[str, Any]:
        async with SessionLocal() as session:
            return await recompute_all_for_month(session, date.fromisoformat(month_iso))

    return asyncio.run(_run())


@celery_app.task(name="rpe_gear.recognition.run_monthly")  # type: ignore[untyped-decorator]
def run_monthly_recognition_task(
    year: int | None = None, month: int | None = None
) -> dict[str, Any]:
    """Recognize all active expense contracts for (year, month). Defaults to previous month."""
    from app.services.recognition import run_monthly_recognition

    y, m = (year, month) if year is not None and month is not None else _prev_month()

    async def _run() -> dict[str, Any]:
        async with SessionLocal() as session:
            entries = await run_monthly_recognition(session, year=y, month=m)
            await session.commit()
            return {"year": y, "month": m, "recognized": len(entries)}

    return asyncio.run(_run())


@celery_app.task(name="rpe_gear.period_close.attempt_previous_month")  # type: ignore[untyped-decorator]
def attempt_close_previous_month_task() -> dict[str, Any]:
    """Attempt to close the previous month. Audit failures recorded but not raised."""
    from app.errors import AuditFailedError
    from app.services.period_close import close

    y, m = _prev_month()

    async def _run() -> dict[str, Any]:
        async with SessionLocal() as session:
            try:
                result = await close(session, year=y, month=m, locked_by="celery-beat")
                await session.commit()
                return {"ok": True, **result}
            except AuditFailedError as exc:
                await session.commit()
                return {"ok": False, "year": y, "month": m, "details": exc.details}

    return asyncio.run(_run())


@celery_app.task(name="rpe_gear.audit.run_for_current_period")  # type: ignore[untyped-decorator]
def run_audit_snapshot_task() -> dict[str, Any]:
    """Dry-run all 27 audits for the current month and persist results."""
    from sqlalchemy import select

    from app.models.close import AccountingPeriod, PeriodStatus
    from app.services.audit import run_audits

    today = date.today()

    async def _run() -> dict[str, Any]:
        async with SessionLocal() as session:
            period = (
                await session.execute(
                    select(AccountingPeriod).where(
                        AccountingPeriod.year == today.year,
                        AccountingPeriod.month == today.month,
                    )
                )
            ).scalar_one_or_none()
            if period is None:
                period = AccountingPeriod(
                    year=today.year, month=today.month, status=PeriodStatus.OPEN
                )
                session.add(period)
                await session.flush()
            results = await run_audits(session, period=period)
            await session.commit()
            return {
                "year": today.year,
                "month": today.month,
                "checks": len(results),
                "failures": sum(1 for r in results if not r.ok),
            }

    return asyncio.run(_run())
