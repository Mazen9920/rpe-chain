"""FX service: rate lookup with fallback to most-recent prior date."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import NotFoundError
from app.models.gl import FxRate


class FxRateNotFoundError(NotFoundError):
    code = "fx_rate_not_found"


async def upsert_rate(
    session: AsyncSession,
    *,
    from_ccy: str,
    to_ccy: str,
    as_of: date,
    rate: Decimal,
    source: str | None = None,
) -> FxRate:
    existing = (
        await session.execute(
            select(FxRate).where(
                FxRate.from_ccy == from_ccy,
                FxRate.to_ccy == to_ccy,
                FxRate.as_of_date == as_of,
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.rate = rate
        existing.source = source
        await session.flush()
        return existing
    row = FxRate(from_ccy=from_ccy, to_ccy=to_ccy, as_of_date=as_of, rate=rate, source=source)
    session.add(row)
    await session.flush()
    return row


async def get_rate(session: AsyncSession, *, from_ccy: str, to_ccy: str, when: date) -> Decimal:
    """Return rate; identity if same currency. Falls back to most-recent prior date."""
    if from_ccy == to_ccy:
        return Decimal("1")
    stmt = (
        select(FxRate.rate)
        .where(
            FxRate.from_ccy == from_ccy,
            FxRate.to_ccy == to_ccy,
            FxRate.as_of_date <= when,
        )
        .order_by(FxRate.as_of_date.desc())
        .limit(1)
    )
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise FxRateNotFoundError(
            f"No FX rate for {from_ccy}->{to_ccy} on/before {when}",
            details={"from": from_ccy, "to": to_ccy, "when": when.isoformat()},
        )
    return Decimal(row)


__all__ = ["FxRateNotFoundError", "get_rate", "upsert_rate"]
