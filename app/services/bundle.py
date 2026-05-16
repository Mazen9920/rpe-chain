"""Bundle service: line expansion, ATP, revenue allocation."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import ROUND_HALF_EVEN, Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import NotFoundError
from app.models.catalog import BundleComponent
from app.models.inventory import StockLevel
from app.models.product import Product, ProductType
from app.models.sales import SalesOrderLine
from app.services.standard_cost import get_cost_for_cogs

Q4 = Decimal("0.0001")
ZERO = Decimal("0")


def _q(x: Decimal) -> Decimal:
    return x.quantize(Q4, rounding=ROUND_HALF_EVEN)


async def get_components(
    session: AsyncSession, bundle_product_id: uuid.UUID
) -> list[BundleComponent]:
    stmt = (
        select(BundleComponent)
        .where(BundleComponent.bundle_product_id == bundle_product_id)
        .order_by(BundleComponent.position)
    )
    return list((await session.execute(stmt)).scalars().all())


async def expand_bundle_lines(
    session: AsyncSession, parent_line: SalesOrderLine
) -> list[SalesOrderLine]:
    """Mark parent as bundle_parent and append child component lines.

    Caller must commit. Returns the newly created child lines.
    """
    product = await session.get(Product, parent_line.product_id)
    if product is None:
        raise NotFoundError(f"Product {parent_line.product_id} not found")
    if product.product_type != ProductType.BUNDLE:
        return []

    components = await get_components(session, product.id)
    parent_line.is_bundle_parent = True
    children: list[SalesOrderLine] = []
    parent_qty = Decimal(parent_line.qty)

    # Compute allocation weights for revenue split
    parent_total = Decimal(parent_line.line_total or 0)
    parent_unit_price = Decimal(parent_line.unit_price or 0)
    if parent_total == 0:
        parent_total = parent_unit_price * parent_qty

    weights = await _allocation_weights(session, product.id, components)
    sum_w = sum(weights, ZERO)

    # Allocate; last child absorbs rounding drift so sum exactly equals parent_total
    running = ZERO
    for i, comp in enumerate(components):
        child_qty = _q(Decimal(comp.qty_per) * parent_qty)
        if sum_w == 0:
            child_total = ZERO
        elif i == len(components) - 1:
            child_total = _q(parent_total - running)
        else:
            child_total = _q(parent_total * weights[i] / sum_w)
            running += child_total
        child_unit_price = _q(child_total / child_qty) if child_qty > 0 else ZERO
        child = SalesOrderLine(
            order_id=parent_line.order_id,
            parent_line_id=parent_line.id,
            position=parent_line.position * 100 + i + 1,
            product_id=comp.component_product_id,
            is_bundle_parent=False,
            is_bundle_component=True,
            qty=child_qty,
            unit_price=child_unit_price,
            line_total=child_total,
        )
        session.add(child)
        children.append(child)
    await session.flush()
    return children


async def _allocation_weights(
    session: AsyncSession,
    bundle_id: uuid.UUID,
    components: list[BundleComponent],
) -> list[Decimal]:
    """Default LIST_PRICE: weight = selling_price * qty_per.

    If any component has an explicit `allocation_weight` set, use those weights * qty_per.
    Falls back to qty_per if no list price available.
    """
    explicit = any(c.allocation_weight is not None for c in components)
    weights: list[Decimal] = []
    for c in components:
        qty_per = Decimal(c.qty_per)
        if explicit and c.allocation_weight is not None:
            weights.append(Decimal(c.allocation_weight) * qty_per)
            continue
        comp = await session.get(Product, c.component_product_id)
        sp = Decimal(comp.selling_price) if comp and comp.selling_price is not None else ZERO
        weights.append(sp * qty_per if sp > 0 else qty_per)
    return weights


async def compute_bundle_atp(
    session: AsyncSession, bundle_product_id: uuid.UUID, warehouse_id: uuid.UUID
) -> int:
    """ATP = min over components of floor((on_hand - reserved) / qty_per)."""
    components = await get_components(session, bundle_product_id)
    if not components:
        return 0
    atp = None
    for c in components:
        stmt = select(StockLevel).where(
            StockLevel.product_id == c.component_product_id,
            StockLevel.warehouse_id == warehouse_id,
        )
        level = (await session.execute(stmt)).scalar_one_or_none()
        avail = ZERO if level is None else (Decimal(level.on_hand) - Decimal(level.reserved))
        per = Decimal(c.qty_per)
        unit = int(avail // per) if per > 0 else 0
        atp = unit if atp is None else min(atp, unit)
    return atp or 0


async def relative_cost_weights(
    session: AsyncSession,
    components: list[BundleComponent],
    when: date,
) -> list[Decimal]:
    """RELATIVE_COST opt-in weights: std_cost(component) * qty_per. None → 0."""
    weights: list[Decimal] = []
    for c in components:
        cost = await get_cost_for_cogs(session, c.component_product_id, when)
        w = (cost or ZERO) * Decimal(c.qty_per)
        weights.append(w)
    return weights


__all__ = [
    "compute_bundle_atp",
    "expand_bundle_lines",
    "get_components",
    "relative_cost_weights",
]
