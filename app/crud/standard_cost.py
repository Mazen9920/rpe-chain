"""Thin async CRUD for cost-input tables. Lock guard lives at the API/service layer."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import MonthLockedError, NotFoundError
from app.models.costing import (
    MfgFeeMonth,
    OtherCostMonth,
    OtherCostType,
    RmCostMonth,
    StandardCost,
)
from app.models.product import Product
from app.services.standard_cost import first_of_month


async def _require_product(session: AsyncSession, product_id: uuid.UUID) -> Product:
    p = await session.get(Product, product_id)
    if p is None:
        raise NotFoundError(f"Product {product_id} not found")
    return p


async def upsert_rm_cost(
    session: AsyncSession,
    product_id: uuid.UUID,
    month_start: date,
    payload: dict[str, Any],
) -> RmCostMonth:
    month_start = first_of_month(month_start)
    await _require_product(session, product_id)
    stmt = select(RmCostMonth).where(
        RmCostMonth.product_id == product_id, RmCostMonth.month_start == month_start
    )
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is not None and row.is_locked:
        raise MonthLockedError(f"RM cost for {month_start} is locked")
    if row is None:
        row = RmCostMonth(product_id=product_id, month_start=month_start, **payload)
        session.add(row)
    else:
        for k, v in payload.items():
            setattr(row, k, v)
    await session.commit()
    await session.refresh(row)
    return row


async def upsert_mfg_fee(
    session: AsyncSession,
    product_id: uuid.UUID,
    month_start: date,
    payload: dict[str, Any],
) -> MfgFeeMonth:
    month_start = first_of_month(month_start)
    await _require_product(session, product_id)
    stmt = select(MfgFeeMonth).where(
        MfgFeeMonth.product_id == product_id, MfgFeeMonth.month_start == month_start
    )
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is not None and row.is_locked:
        raise MonthLockedError(f"Mfg fee for {month_start} is locked")
    if row is None:
        row = MfgFeeMonth(product_id=product_id, month_start=month_start, **payload)
        session.add(row)
    else:
        for k, v in payload.items():
            setattr(row, k, v)
    await session.commit()
    await session.refresh(row)
    return row


async def upsert_other_cost(
    session: AsyncSession,
    product_id: uuid.UUID,
    month_start: date,
    cost_type: OtherCostType,
    payload: dict[str, Any],
) -> OtherCostMonth:
    month_start = first_of_month(month_start)
    await _require_product(session, product_id)
    stmt = select(OtherCostMonth).where(
        OtherCostMonth.product_id == product_id,
        OtherCostMonth.month_start == month_start,
        OtherCostMonth.cost_type == cost_type,
    )
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is not None and row.is_locked:
        raise MonthLockedError(f"Other cost {cost_type.value} for {month_start} is locked")
    if row is None:
        row = OtherCostMonth(
            product_id=product_id,
            month_start=month_start,
            cost_type=cost_type,
            **payload,
        )
        session.add(row)
    else:
        for k, v in payload.items():
            setattr(row, k, v)
    await session.commit()
    await session.refresh(row)
    return row


async def list_rm_costs(
    session: AsyncSession,
    *,
    month_start: date | None = None,
    product_id: uuid.UUID | None = None,
) -> list[RmCostMonth]:
    stmt = select(RmCostMonth)
    if month_start is not None:
        stmt = stmt.where(RmCostMonth.month_start == first_of_month(month_start))
    if product_id is not None:
        stmt = stmt.where(RmCostMonth.product_id == product_id)
    return list((await session.execute(stmt)).scalars().all())


async def list_mfg_fees(
    session: AsyncSession,
    *,
    month_start: date | None = None,
    product_id: uuid.UUID | None = None,
) -> list[MfgFeeMonth]:
    stmt = select(MfgFeeMonth)
    if month_start is not None:
        stmt = stmt.where(MfgFeeMonth.month_start == first_of_month(month_start))
    if product_id is not None:
        stmt = stmt.where(MfgFeeMonth.product_id == product_id)
    return list((await session.execute(stmt)).scalars().all())


async def list_other_costs(
    session: AsyncSession,
    *,
    month_start: date | None = None,
    product_id: uuid.UUID | None = None,
) -> list[OtherCostMonth]:
    stmt = select(OtherCostMonth)
    if month_start is not None:
        stmt = stmt.where(OtherCostMonth.month_start == first_of_month(month_start))
    if product_id is not None:
        stmt = stmt.where(OtherCostMonth.product_id == product_id)
    return list((await session.execute(stmt)).scalars().all())


async def list_standard_costs(
    session: AsyncSession,
    *,
    month_start: date | None = None,
    product_id: uuid.UUID | None = None,
    status: str | None = None,
) -> list[StandardCost]:
    stmt = select(StandardCost)
    if month_start is not None:
        stmt = stmt.where(StandardCost.month_start == first_of_month(month_start))
    if product_id is not None:
        stmt = stmt.where(StandardCost.product_id == product_id)
    if status is not None:
        stmt = stmt.where(StandardCost.status == status)
    return list((await session.execute(stmt)).scalars().all())


async def get_standard_cost(
    session: AsyncSession, product_id: uuid.UUID, month_start: date
) -> StandardCost | None:
    stmt = select(StandardCost).where(
        StandardCost.product_id == product_id,
        StandardCost.month_start == first_of_month(month_start),
    )
    return (await session.execute(stmt)).scalar_one_or_none()


# Re-export Decimal for callers that pass payloads
__all__ = [
    "Decimal",
    "get_standard_cost",
    "list_mfg_fees",
    "list_other_costs",
    "list_rm_costs",
    "list_standard_costs",
    "upsert_mfg_fee",
    "upsert_other_cost",
    "upsert_rm_cost",
]
