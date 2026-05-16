"""Standard-cost engine: deterministic Decimal rollup, status precedence, lock model.

All arithmetic is in `Decimal`. Floats are rejected upstream at Pydantic boundary.
The selector `get_cost_for_cogs()` is consumed by v0.2.0 COGS posting.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_EVEN, Decimal
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.errors import BomCycleError, NotFoundError
from app.models.costing import (
    BillOfMaterials,
    BomLine,
    CostingSettings,
    MfgFeeMonth,
    OtherCostMonth,
    RmCostMonth,
    StandardCost,
    StandardCostStatus,
)
from app.models.product import Product, ProductType

log = get_logger("costing")

Q4 = Decimal("0.0001")
ZERO = Decimal("0")
ONE = Decimal("1")


def quantize_money(value: Decimal) -> Decimal:
    """Round-half-even to 4 decimal places — the engine's canonical money precision."""
    return value.quantize(Q4, rounding=ROUND_HALF_EVEN)


def first_of_month(d: date) -> date:
    return d.replace(day=1)


# ---------- internal helpers ----------


async def _get_product(session: AsyncSession, product_id: uuid.UUID) -> Product:
    product = await session.get(Product, product_id)
    if product is None:
        raise NotFoundError(f"Product {product_id} not found")
    return product


async def _active_bom(session: AsyncSession, product_id: uuid.UUID) -> BillOfMaterials | None:
    stmt = (
        select(BillOfMaterials)
        .where(
            BillOfMaterials.product_id == product_id,
            BillOfMaterials.is_active.is_(True),
            BillOfMaterials.archived_at.is_(None),
        )
        .order_by(BillOfMaterials.version.desc())
        .limit(1)
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def _bom_lines(session: AsyncSession, bom_id: uuid.UUID) -> list[BomLine]:
    stmt = select(BomLine).where(BomLine.bom_id == bom_id).order_by(BomLine.position)
    return list((await session.execute(stmt)).scalars().all())


async def _rm_cost(
    session: AsyncSession, product_id: uuid.UUID, month_start: date
) -> RmCostMonth | None:
    stmt = select(RmCostMonth).where(
        RmCostMonth.product_id == product_id, RmCostMonth.month_start == month_start
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def _mfg_fee(
    session: AsyncSession, product_id: uuid.UUID, month_start: date
) -> MfgFeeMonth | None:
    stmt = select(MfgFeeMonth).where(
        MfgFeeMonth.product_id == product_id, MfgFeeMonth.month_start == month_start
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def _other_costs(
    session: AsyncSession, product_id: uuid.UUID, month_start: date
) -> list[OtherCostMonth]:
    stmt = select(OtherCostMonth).where(
        OtherCostMonth.product_id == product_id,
        OtherCostMonth.month_start == month_start,
    )
    return list((await session.execute(stmt)).scalars().all())


def _rm_cost_in_egp(row: RmCostMonth) -> Decimal:
    if row.currency == "EGP" or row.fx_rate is None:
        return Decimal(row.unit_cost)
    return Decimal(row.unit_cost) * Decimal(row.fx_rate)


# ---------- public API ----------


async def get_costing_settings(session: AsyncSession) -> CostingSettings:
    settings = await session.get(CostingSettings, 1)
    if settings is None:
        settings = CostingSettings(id=1)
        session.add(settings)
        await session.flush()
    return settings


async def _rollup(
    session: AsyncSession,
    product_id: uuid.UUID,
    month_start: date,
    visited: tuple[uuid.UUID, ...],
    missing: list[dict[str, Any]],
) -> tuple[Decimal, dict[str, Any]]:
    """Recursive rollup; returns (unit_cost_egp, breakdown_node).

    On missing RM price for a leaf: records into `missing` and returns Decimal(0)
    plus a breakdown node flagged `missing=True` so the caller can mark status.
    """
    if product_id in visited:
        raise BomCycleError(
            f"BOM cycle detected at product {product_id}",
            details={"cycle": [str(p) for p in visited] + [str(product_id)]},
        )
    visited_next = (*visited, product_id)

    product = await _get_product(session, product_id)
    bom = await _active_bom(session, product_id)

    # Leaf: use RmCostMonth
    if bom is None or product.product_type in (ProductType.RAW, ProductType.PACKAGING):
        rm = await _rm_cost(session, product_id, month_start)
        if rm is None:
            missing.append({"product_id": str(product_id), "sku": product.sku, "kind": "rm_price"})
            return ZERO, {
                "product_id": str(product_id),
                "sku": product.sku,
                "is_leaf": True,
                "unit_cost": None,
                "missing": True,
            }
        unit = quantize_money(_rm_cost_in_egp(rm))
        return unit, {
            "product_id": str(product_id),
            "sku": product.sku,
            "is_leaf": True,
            "unit_cost": str(unit),
            "currency": rm.currency,
        }

    # Assembly: walk lines
    lines_payload: list[dict[str, Any]] = []
    rm_subtotal = ZERO
    for line in await _bom_lines(session, bom.id):
        child_cost, child_node = await _rollup(
            session, line.component_product_id, month_start, visited_next, missing
        )
        effective_qty = Decimal(line.qty_per) * (ONE + Decimal(line.scrap_factor_pct))
        line_cost = effective_qty * child_cost
        rm_subtotal += line_cost
        lines_payload.append(
            {
                "component": child_node,
                "qty_per": str(Decimal(line.qty_per)),
                "scrap_factor_pct": str(Decimal(line.scrap_factor_pct)),
                "effective_qty": str(effective_qty),
                "line_cost": str(quantize_money(line_cost)),
            }
        )
    return quantize_money(rm_subtotal), {
        "product_id": str(product_id),
        "sku": product.sku,
        "is_leaf": False,
        "rm_subtotal": str(quantize_money(rm_subtotal)),
        "lines": lines_payload,
    }


async def compute_standard_cost(
    session: AsyncSession,
    product_id: uuid.UUID,
    month_start: date,
) -> StandardCost:
    """Compute and upsert the standard cost for (product, month). Idempotent.

    Locked rows are returned unchanged. Missing inputs yield status flags, never raise.
    """
    month_start = first_of_month(month_start)
    product = await _get_product(session, product_id)
    await get_costing_settings(session)

    existing_stmt = select(StandardCost).where(
        StandardCost.product_id == product_id, StandardCost.month_start == month_start
    )
    existing = (await session.execute(existing_stmt)).scalar_one_or_none()
    if existing is not None and existing.is_locked:
        return existing

    missing: list[dict[str, Any]] = []
    rm_subtotal_egp, breakdown_root = await _rollup(session, product_id, month_start, (), missing)

    # Mfg fee — only required for assemblies (FINISHED / BUNDLE / manufactured)
    needs_fee = product.product_type in (ProductType.FINISHED, ProductType.BUNDLE) or (
        product.is_manufactured
    )
    fee_row = await _mfg_fee(session, product_id, month_start)
    if fee_row is None and needs_fee:
        missing.append({"product_id": str(product_id), "sku": product.sku, "kind": "mfg_fee"})
        mfg_fee_value: Decimal | None = None
    else:
        mfg_fee_value = quantize_money(Decimal(fee_row.fee_amount)) if fee_row else ZERO

    # Other costs (sum)
    others = await _other_costs(session, product_id, month_start)
    other_subtotal = quantize_money(sum((Decimal(o.amount) for o in others), ZERO))

    # Determine status
    has_missing_rm = any(m["kind"] == "rm_price" for m in missing)
    has_missing_fee = any(m["kind"] == "mfg_fee" for m in missing)

    if has_missing_rm:
        status = StandardCostStatus.MISSING_RM_PRICES
        unit_cost: Decimal | None = None
        rm_subtotal_out: Decimal | None = None
    elif has_missing_fee:
        status = StandardCostStatus.MISSING_MFG_FEE
        unit_cost = None
        rm_subtotal_out = rm_subtotal_egp
    else:
        rm_subtotal_out = rm_subtotal_egp
        unit_cost = quantize_money(rm_subtotal_egp + (mfg_fee_value or ZERO) + other_subtotal)
        status = StandardCostStatus.OK

    now = datetime.now(UTC)

    if existing is None:
        row = StandardCost(
            product_id=product_id,
            month_start=month_start,
            unit_cost=unit_cost,
            rm_subtotal=rm_subtotal_out,
            mfg_fee=mfg_fee_value,
            other_subtotal=other_subtotal,
            status=status,
            is_locked=False,
            computed_at=now,
            missing_inputs=missing or None,
            breakdown=breakdown_root,
        )
        session.add(row)
    else:
        existing.unit_cost = unit_cost
        existing.rm_subtotal = rm_subtotal_out
        existing.mfg_fee = mfg_fee_value
        existing.other_subtotal = other_subtotal
        existing.status = status
        existing.computed_at = now
        existing.missing_inputs = missing or None
        existing.breakdown = breakdown_root
        row = existing

    await session.flush()
    log.info(
        "standard_cost_computed",
        product_id=str(product_id),
        sku=product.sku,
        month=month_start.isoformat(),
        status=status.value,
        unit_cost=str(unit_cost) if unit_cost is not None else None,
    )
    return row


def _topo_order(
    products: list[Product], bom_index: dict[uuid.UUID, list[uuid.UUID]]
) -> list[uuid.UUID]:
    """Leaves-first topological sort by BOM dependency."""
    order: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()
    temp: set[uuid.UUID] = set()
    ids = {p.id for p in products}

    def visit(pid: uuid.UUID) -> None:
        if pid in seen:
            return
        if pid in temp:
            raise BomCycleError(f"Cycle involving {pid}")
        temp.add(pid)
        for child in bom_index.get(pid, []):
            if child in ids:
                visit(child)
        temp.remove(pid)
        seen.add(pid)
        order.append(pid)

    for p in products:
        visit(p.id)
    return order


async def recompute_all_for_month(
    session: AsyncSession,
    month_start: date,
    product_ids: Iterable[uuid.UUID] | None = None,
) -> dict[str, Any]:
    """Recompute std costs for all (or filtered) products for a month. Leaves first."""
    month_start = first_of_month(month_start)
    prod_stmt = select(Product).where(Product.is_active.is_(True))
    if product_ids is not None:
        prod_stmt = prod_stmt.where(Product.id.in_(list(product_ids)))
    products = list((await session.execute(prod_stmt)).scalars().all())

    bom_index: dict[uuid.UUID, list[uuid.UUID]] = {}
    for p in products:
        bom = await _active_bom(session, p.id)
        if bom is None:
            bom_index[p.id] = []
            continue
        lines = await _bom_lines(session, bom.id)
        bom_index[p.id] = [line.component_product_id for line in lines]

    order = _topo_order(products, bom_index)
    summary: dict[str, int] = {s.value: 0 for s in StandardCostStatus}
    for pid in order:
        row = await compute_standard_cost(session, pid, month_start)
        summary[row.status.value] += 1
    await session.commit()
    return {"month_start": month_start.isoformat(), "count": len(order), "by_status": summary}


async def lock_month(session: AsyncSession, month_start: date) -> dict[str, int]:
    """Idempotent lock of all cost inputs and standard costs for a month."""
    month_start = first_of_month(month_start)
    counts: dict[str, int] = {}
    for model in (RmCostMonth, MfgFeeMonth, OtherCostMonth, StandardCost):
        res = await session.execute(
            update(model)
            .where(model.month_start == month_start, model.is_locked.is_(False))
            .values(is_locked=True)
        )
        counts[model.__tablename__] = res.rowcount or 0  # type: ignore[attr-defined]

    # Mark already-computed std costs as LOCKED status when locked
    await session.execute(
        update(StandardCost)
        .where(StandardCost.month_start == month_start, StandardCost.is_locked.is_(True))
        .values(status=StandardCostStatus.LOCKED)
    )
    await session.commit()
    log.info("month_locked", month=month_start.isoformat(), counts=counts)
    return counts


async def unlock_month(
    session: AsyncSession, month_start: date, *, force: bool, actor_id: uuid.UUID
) -> dict[str, int]:
    """Unlock a month. Refuses if past cutover unless force=True."""
    from app.errors import AppError

    month_start = first_of_month(month_start)
    settings = await get_costing_settings(session)
    if settings.cutover_date and month_start < settings.cutover_date and not force:
        raise AppError(
            f"Month {month_start} is before cutover {settings.cutover_date}; pass force=true",
            details={"cutover_date": settings.cutover_date.isoformat()},
        )
    counts: dict[str, int] = {}
    for model in (RmCostMonth, MfgFeeMonth, OtherCostMonth, StandardCost):
        res = await session.execute(
            update(model)
            .where(model.month_start == month_start, model.is_locked.is_(True))
            .values(is_locked=False)
        )
        counts[model.__tablename__] = res.rowcount or 0  # type: ignore[attr-defined]
    await session.commit()
    log.warning(
        "month_unlocked",
        month=month_start.isoformat(),
        actor_id=str(actor_id),
        force=force,
        counts=counts,
    )
    return counts


async def get_cost_for_cogs(
    session: AsyncSession, product_id: uuid.UUID, when: date
) -> Decimal | None:
    """Return std cost for COGS at `when`, walking back up to 12 months for last OK row.

    Used by v0.2.0 COGS posting. Returns None when no usable std cost exists; the
    caller is expected to fall back to FIFO.
    """
    cursor = first_of_month(when)
    for _ in range(13):  # current month + 12 prior
        stmt = (
            select(StandardCost)
            .where(
                StandardCost.product_id == product_id,
                StandardCost.month_start == cursor,
            )
            .limit(1)
        )
        row = (await session.execute(stmt)).scalar_one_or_none()
        if (
            row is not None
            and row.status
            in (
                StandardCostStatus.OK,
                StandardCostStatus.LOCKED,
            )
            and row.unit_cost is not None
        ):
            return Decimal(row.unit_cost)
        # step one month back
        if cursor.month == 1:
            cursor = cursor.replace(year=cursor.year - 1, month=12)
        else:
            cursor = cursor.replace(month=cursor.month - 1)
    return None


async def mark_stale_if_needed(session: AsyncSession) -> int:
    """Mark OK std costs as STALE if computed_at older than settings.stale_after_days."""
    settings = await get_costing_settings(session)
    cutoff = datetime.now(UTC) - timedelta(days=settings.stale_after_days)
    res = await session.execute(
        update(StandardCost)
        .where(
            StandardCost.status == StandardCostStatus.OK,
            StandardCost.is_locked.is_(False),
            StandardCost.computed_at < cutoff,
        )
        .values(status=StandardCostStatus.STALE)
    )
    await session.commit()
    return res.rowcount or 0  # type: ignore[attr-defined]


__all__ = [
    "compute_standard_cost",
    "first_of_month",
    "get_cost_for_cogs",
    "get_costing_settings",
    "lock_month",
    "mark_stale_if_needed",
    "quantize_money",
    "recompute_all_for_month",
    "unlock_month",
]
