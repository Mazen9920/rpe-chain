"""Period close orchestrator.

`close(year, month, locked_by=...)`:
  1. Get-or-create AccountingPeriod
  2. Flip status → CLOSING (if currently OPEN)
  3. Run all 27 audit checks
  4. If any BLOCKER check fails → raise AuditFailedError with details (period stays CLOSING)
  5. Otherwise → flip to LOCKED + record locked_at/locked_by

`reopen(year, month, reopened_by=...)`: LOCKED → REOPENED → OPEN.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import AuditFailedError, InvalidStateError
from app.models.close import AccountingPeriod, AuditSeverity, PeriodStatus
from app.services import audit as audit_svc


async def _get_or_create(session: AsyncSession, *, year: int, month: int) -> AccountingPeriod:
    period = (
        await session.execute(
            select(AccountingPeriod).where(
                AccountingPeriod.year == year, AccountingPeriod.month == month
            )
        )
    ).scalar_one_or_none()
    if period is None:
        period = AccountingPeriod(year=year, month=month, status=PeriodStatus.OPEN)
        session.add(period)
        await session.flush()
    return period


async def close(
    session: AsyncSession,
    *,
    year: int,
    month: int,
    locked_by: str | None = None,
) -> dict[str, Any]:
    period = await _get_or_create(session, year=year, month=month)
    if period.status == PeriodStatus.LOCKED:
        return {
            "period_id": str(period.id),
            "status": period.status.value,
            "locked_at": period.locked_at.isoformat() if period.locked_at else None,
            "already_locked": True,
            "checks": [],
        }
    period.status = PeriodStatus.CLOSING
    await session.flush()

    results = await audit_svc.run_audits(session, period=period)

    failures = [
        {
            "check": r.check_name,
            "severity": r.severity.value,
            "message": r.message,
            "refs": r.refs,
        }
        for r in results
        if not r.ok and r.severity == AuditSeverity.BLOCKER
    ]
    if failures:
        # leave period in CLOSING so user can fix + retry
        raise AuditFailedError(
            f"{len(failures)} blocker check(s) failed",
            details={"period": f"{year}-{month:02d}", "failures": failures},
        )

    period.status = PeriodStatus.LOCKED
    period.locked_at = datetime.utcnow()
    period.locked_by = locked_by
    await session.flush()
    return {
        "period_id": str(period.id),
        "status": period.status.value,
        "locked_at": period.locked_at.isoformat(),
        "locked_by": period.locked_by,
        "checks": [
            {
                "name": r.check_name,
                "severity": r.severity.value,
                "ok": r.ok,
                "message": r.message,
            }
            for r in results
        ],
    }


async def reopen(
    session: AsyncSession,
    *,
    year: int,
    month: int,
    reopened_by: str | None = None,
) -> AccountingPeriod:
    period = (
        await session.execute(
            select(AccountingPeriod).where(
                AccountingPeriod.year == year, AccountingPeriod.month == month
            )
        )
    ).scalar_one_or_none()
    if period is None:
        raise InvalidStateError(f"Period {year}-{month:02d} does not exist")
    if period.status != PeriodStatus.LOCKED:
        raise InvalidStateError(
            f"Cannot reopen period in status {period.status.value}",
        )
    period.status = PeriodStatus.REOPENED
    period.notes = (
        period.notes or ""
    ) + f"\nReopened {datetime.utcnow().isoformat()} by {reopened_by}"
    await session.flush()
    period.status = PeriodStatus.OPEN
    await session.flush()
    return period


__all__ = ["close", "reopen"]
