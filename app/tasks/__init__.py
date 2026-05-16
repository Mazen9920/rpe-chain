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


# ---------------------------------------------------------------------------
# v0.4.0 cash-in reconciliation tasks
# ---------------------------------------------------------------------------


@celery_app.task(name="rpe_gear.paymob.recon_daily")  # type: ignore[untyped-decorator]
def paymob_recon_daily_task() -> dict[str, Any]:
    """Pull recent Paymob transactions and post settlement journals."""
    from decimal import Decimal

    from app.integrations.paymob.client import PaymobClient
    from app.integrations.paymob.settlement_csv import PaymobSettlementRow
    from app.services.paymob_recon import ingest_settlement_rows

    async def _run() -> dict[str, Any]:
        client = PaymobClient()
        if not client.api_key:
            return {"skipped": True, "reason": "no_api_key"}
        raw = await client.list_transactions(page=1, page_size=200)
        from datetime import datetime

        rows: list[PaymobSettlementRow] = []
        for r in raw:
            try:
                external_id = str(r.get("id") or r.get("transaction_id") or "")
                if not external_id:
                    continue
                amt = Decimal(str(r.get("amount_cents", 0))) / Decimal("100")
                fees = Decimal(str(r.get("fees_cents", 0))) / Decimal("100")
                rows.append(
                    PaymobSettlementRow(
                        external_id=external_id,
                        order_external_id=str(r.get("order", {}).get("id", "")) or None,
                        amount_gross=amt,
                        fees=fees,
                        amount_net=amt - fees,
                        currency=str(r.get("currency", "EGP")),
                        captured_at=datetime.fromisoformat(
                            str(r.get("created_at", datetime.utcnow().isoformat())).replace(
                                "Z", "+00:00"
                            )
                        ),
                        settled_at=None,
                        settlement_ref=None,
                        payment_method=str(r.get("source_data", {}).get("type", "")),
                        status="SETTLED" if r.get("is_settled") else "CAPTURED",
                        raw=r,
                    )
                )
            except (ValueError, KeyError, TypeError):
                continue

        async with SessionLocal() as session:
            report = await ingest_settlement_rows(session, rows)
            await session.commit()
            return report

    return asyncio.run(_run())


@celery_app.task(name="rpe_gear.bosta.sync_status")  # type: ignore[untyped-decorator]
def bosta_sync_status_task() -> dict[str, Any]:
    """Sync Bosta delivery statuses to local COD ledger."""
    from sqlalchemy import select

    from app.integrations.bosta.client import BostaClient
    from app.models.payments import CODLedgerEntry, CODStatus
    from app.services.cod_ledger import mark_delivered, mark_returned

    async def _run() -> dict[str, Any]:
        client = BostaClient()
        if not client.api_key:
            return {"skipped": True, "reason": "no_api_key"}

        async with SessionLocal() as session:
            in_flight = list(
                (
                    await session.execute(
                        select(CODLedgerEntry).where(
                            CODLedgerEntry.status.in_([CODStatus.IN_TRANSIT, CODStatus.PENDING])
                        )
                    )
                )
                .scalars()
                .all()
            )
            delivered = 0
            returned = 0
            for entry in in_flight:
                try:
                    payload = await client.get_delivery(entry.tracking_id)
                except Exception:  # noqa: S112
                    continue
                state = str(payload.get("state", {}).get("value", "")).upper()
                if state in ("DELIVERED", "RECEIVED"):
                    await mark_delivered(session, tracking_id=entry.tracking_id)
                    delivered += 1
                elif state in ("RETURNED", "CANCELLED", "TERMINATED"):
                    try:
                        await mark_returned(session, tracking_id=entry.tracking_id)
                        returned += 1
                    except Exception:  # noqa: S110
                        pass
            await session.commit()
            return {"scanned": len(in_flight), "delivered": delivered, "returned": returned}

    return asyncio.run(_run())


@celery_app.task(name="rpe_gear.bosta.void_rate_check")  # type: ignore[untyped-decorator]
def bosta_void_rate_check_task(threshold: str = "0.10") -> dict[str, Any]:
    """Alert if COD void rate over last 30 days exceeds threshold."""
    from decimal import Decimal

    from app.services.cod_ledger import void_rate

    async def _run() -> dict[str, Any]:
        async with SessionLocal() as session:
            rate = await void_rate(session, window_days=30)
            t = Decimal(threshold)
            return {
                "void_rate": str(rate),
                "threshold": str(t),
                "alert": rate > t,
            }

    return asyncio.run(_run())


@celery_app.task(name="rpe_gear.bank.auto_match")  # type: ignore[untyped-decorator]
def bank_auto_match_task() -> dict[str, Any]:
    """Auto-match unmatched bank statement lines to Paymob/Bosta sub-ledgers."""
    from app.services.bank_recon import auto_match_unmatched

    async def _run() -> dict[str, Any]:
        async with SessionLocal() as session:
            report = await auto_match_unmatched(session)
            await session.commit()
            return report

    return asyncio.run(_run())


# v0.4.1 manufacturing monitoring task
@celery_app.task(name="rpe_gear.production.daily_summary")  # type: ignore[untyped-decorator]
def production_daily_summary_task() -> dict[str, Any]:
    """Daily WIP balance + open MO counts (read-only monitoring)."""
    from app.services.production import open_mo_summary, wip_balance

    async def _run() -> dict[str, Any]:
        async with SessionLocal() as session:
            counts = await open_mo_summary(session)
            wip = await wip_balance(session)
            return {"counts": counts, "wip_balance": str(wip)}

    return asyncio.run(_run())
