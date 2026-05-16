"""Sales service: order creation, allocation, shipment, state transitions.

State machine:
    RECEIVED -> CONFIRMED -> ALLOCATED -> PICKED -> PACKED -> SHIPPED -> DELIVERED
                                                                       -> CANCELLED
    (CANCELLED allowed from RECEIVED|CONFIRMED|ALLOCATED|PICKED|PACKED)
"""

from __future__ import annotations

import secrets
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.errors import InvalidStateError, NotFoundError
from app.models.product import Product, ProductType
from app.models.sales import (
    Customer,
    SalesOrder,
    SalesOrderLine,
    SalesOrderSource,
    SalesOrderStatus,
    Shipment,
    ShipmentLine,
    ShipmentStatus,
)
from app.services import bundle as bundle_svc
from app.services import cogs as cogs_svc
from app.services import inventory as inv_svc

log = get_logger("sales")
ZERO = Decimal("0")

_ALLOWED: dict[SalesOrderStatus, set[SalesOrderStatus]] = {
    SalesOrderStatus.RECEIVED: {SalesOrderStatus.CONFIRMED, SalesOrderStatus.CANCELLED},
    SalesOrderStatus.CONFIRMED: {SalesOrderStatus.ALLOCATED, SalesOrderStatus.CANCELLED},
    SalesOrderStatus.ALLOCATED: {SalesOrderStatus.PICKED, SalesOrderStatus.CANCELLED},
    SalesOrderStatus.PICKED: {SalesOrderStatus.PACKED, SalesOrderStatus.CANCELLED},
    SalesOrderStatus.PACKED: {SalesOrderStatus.SHIPPED, SalesOrderStatus.CANCELLED},
    SalesOrderStatus.SHIPPED: {SalesOrderStatus.DELIVERED},
    SalesOrderStatus.DELIVERED: set(),
    SalesOrderStatus.CANCELLED: set(),
}


def _next_order_number() -> str:
    return f"SO-{datetime.utcnow().strftime('%Y%m%d')}-{secrets.token_hex(3).upper()}"


def _next_shipment_number() -> str:
    return f"SH-{datetime.utcnow().strftime('%Y%m%d')}-{secrets.token_hex(3).upper()}"


async def _get_order(session: AsyncSession, order_id: uuid.UUID) -> SalesOrder:
    order = await session.get(SalesOrder, order_id)
    if order is None:
        raise NotFoundError(f"SalesOrder {order_id} not found")
    return order


async def _get_lines(session: AsyncSession, order_id: uuid.UUID) -> list[SalesOrderLine]:
    stmt = (
        select(SalesOrderLine)
        .where(SalesOrderLine.order_id == order_id)
        .order_by(SalesOrderLine.position)
    )
    return list((await session.execute(stmt)).scalars().all())


def _transition(order: SalesOrder, target: SalesOrderStatus) -> None:
    allowed = _ALLOWED[order.status]
    if target not in allowed:
        raise InvalidStateError(
            f"Bad state transition for {order.order_number}: {order.status.value}->{target.value}",
            details={"from": order.status.value, "to": target.value},
        )
    order.status = target


# ---------- public API ----------


async def create_order(
    session: AsyncSession,
    *,
    customer_id: uuid.UUID,
    warehouse_id: uuid.UUID | None,
    lines: list[dict[str, Any]],
    source: SalesOrderSource = SalesOrderSource.MANUAL,
    external_id: str | None = None,
    order_date: date | None = None,
    currency: str = "EGP",
    order_number: str | None = None,
) -> SalesOrder:
    """Create an order + raw lines. Bundle expansion is a separate step (`expand_bundles`)."""
    customer = await session.get(Customer, customer_id)
    if customer is None:
        raise NotFoundError(f"Customer {customer_id} not found")

    order = SalesOrder(
        order_number=order_number or _next_order_number(),
        customer_id=customer_id,
        warehouse_id=warehouse_id,
        source=source,
        external_id=external_id,
        status=SalesOrderStatus.RECEIVED,
        currency=currency,
        order_date=order_date or date.today(),
    )
    session.add(order)
    await session.flush()

    for i, item in enumerate(lines):
        product_id = uuid.UUID(str(item["product_id"]))
        qty = Decimal(str(item["qty"]))
        unit_price = Decimal(str(item.get("unit_price", "0")))
        line_total = Decimal(str(item.get("line_total", str(unit_price * qty))))
        session.add(
            SalesOrderLine(
                order_id=order.id,
                position=int(item.get("position", i)),
                product_id=product_id,
                qty=qty,
                unit_price=unit_price,
                line_total=line_total,
            )
        )
    await session.flush()
    return order


async def expand_bundles(session: AsyncSession, order_id: uuid.UUID) -> int:
    """Walk top-level lines; expand BUNDLE products into component children. Returns child count."""
    lines = await _get_lines(session, order_id)
    total_children = 0
    for line in lines:
        if line.parent_line_id is not None or line.is_bundle_component:
            continue
        product = await session.get(Product, line.product_id)
        if product is None or product.product_type != ProductType.BUNDLE:
            continue
        children = await bundle_svc.expand_bundle_lines(session, line)
        total_children += len(children)
    await session.flush()
    return total_children


async def confirm(session: AsyncSession, order_id: uuid.UUID) -> SalesOrder:
    order = await _get_order(session, order_id)
    _transition(order, SalesOrderStatus.CONFIRMED)
    await session.flush()
    return order


async def allocate(session: AsyncSession, order_id: uuid.UUID) -> SalesOrder:
    """Reserve stock for every fulfillable line (component lines + non-bundle parents)."""
    order = await _get_order(session, order_id)
    if order.status not in (SalesOrderStatus.CONFIRMED, SalesOrderStatus.RECEIVED):
        raise InvalidStateError(
            f"Cannot allocate order in status {order.status.value}",
            details={"status": order.status.value},
        )
    if order.warehouse_id is None:
        raise InvalidStateError("Order has no warehouse to allocate from")

    lines = await _get_lines(session, order_id)
    for line in lines:
        if line.is_bundle_parent:
            # Parent line is not stockable; its components carry the inventory hit.
            continue
        await inv_svc.reserve(
            session,
            product_id=line.product_id,
            warehouse_id=order.warehouse_id,
            qty=Decimal(line.qty),
            ref_type="sales_order_line",
            ref_id=line.id,
        )
        line.qty_allocated = Decimal(line.qty)
    order.status = SalesOrderStatus.ALLOCATED
    await session.flush()
    return order


async def cancel(session: AsyncSession, order_id: uuid.UUID) -> SalesOrder:
    order = await _get_order(session, order_id)
    if order.status in (SalesOrderStatus.SHIPPED, SalesOrderStatus.DELIVERED):
        raise InvalidStateError("Cannot cancel a shipped/delivered order")
    lines = await _get_lines(session, order_id)
    for line in lines:
        if line.is_bundle_parent:
            continue
        await inv_svc.release_for_ref(
            session, ref_type="sales_order_line", ref_id=line.id, consume=False
        )
        line.qty_allocated = ZERO
    order.status = SalesOrderStatus.CANCELLED
    await session.flush()
    return order


async def ship(
    session: AsyncSession,
    order_id: uuid.UUID,
    *,
    carrier: str | None = None,
    tracking_number: str | None = None,
) -> Shipment:
    """Fully ship the order. Creates Shipment + ShipmentLines, depletes stock + FIFO layers,
    consumes reservations, writes one balanced PendingJournalEntry."""
    order = await _get_order(session, order_id)
    if order.status not in (
        SalesOrderStatus.ALLOCATED,
        SalesOrderStatus.PICKED,
        SalesOrderStatus.PACKED,
    ):
        raise InvalidStateError(
            f"Order status {order.status.value} not shippable",
            details={"status": order.status.value},
        )
    if order.warehouse_id is None:
        raise InvalidStateError("Order has no warehouse")

    lines = await _get_lines(session, order_id)
    shippable = [ln for ln in lines if not ln.is_bundle_parent]
    shipment = Shipment(
        shipment_number=_next_shipment_number(),
        order_id=order.id,
        warehouse_id=order.warehouse_id,
        status=ShipmentStatus.DRAFT,
    )
    session.add(shipment)
    await session.flush()

    products_by_id: dict[uuid.UUID, Product] = {}
    ship_lines: list[ShipmentLine] = []
    today = date.today()
    for line in shippable:
        product = await session.get(Product, line.product_id)
        if product is None:
            raise NotFoundError(f"Product {line.product_id} missing during ship")
        products_by_id[product.id] = product

        unit_cost, src = await cogs_svc.unit_cost_for_line(
            session,
            product=product,
            warehouse_id=order.warehouse_id,
            when=today,
        )
        sl = ShipmentLine(
            shipment_id=shipment.id,
            order_line_id=line.id,
            product_id=product.id,
            qty=Decimal(line.qty),
            unit_cost=unit_cost,
            cost_source=src,
        )
        session.add(sl)
        ship_lines.append(sl)

        # consume reservation + deplete on-hand + FIFO
        await inv_svc.release_for_ref(
            session, ref_type="sales_order_line", ref_id=line.id, consume=True
        )
        await inv_svc.ship(
            session,
            product_id=product.id,
            warehouse_id=order.warehouse_id,
            qty=Decimal(line.qty),
            unit_cost=unit_cost,
            ref_type="shipment_line",
            ref_id=sl.id,
        )
        line.qty_shipped = Decimal(line.qty)
        line.qty_picked = Decimal(line.qty)

    shipment.status = ShipmentStatus.DISPATCHED
    shipment.dispatched_at = datetime.utcnow()
    order.status = SalesOrderStatus.SHIPPED
    await session.flush()

    await cogs_svc.post_for_shipment(
        session,
        shipment=shipment,
        lines=ship_lines,
        products_by_id=products_by_id,
        event_date=today,
        currency=order.currency,
    )
    # Auto-post AR invoice on dispatch (DR AR / CR Revenue). If the chart of
    # accounts isn't seeded (older test fixtures), skip silently — same pattern
    # as cogs.post_for_shipment.
    from app.services import ar as ar_svc
    from app.services.gl import AccountNotFoundError

    try:
        await ar_svc.post_invoice_for_shipment(session, shipment=shipment, invoice_date=today)
    except AccountNotFoundError:
        pass
    # Outbox: shipment.dispatched → fulfillments.create for Shopify-sourced orders
    if order.source == SalesOrderSource.SHOPIFY:
        from app.services import shopify_outbound

        await shopify_outbound.enqueue_fulfillment_create(
            session, shipment=shipment, order=order, lines=ship_lines
        )
    await session.flush()
    return shipment


async def deliver(session: AsyncSession, order_id: uuid.UUID) -> SalesOrder:
    order = await _get_order(session, order_id)
    _transition(order, SalesOrderStatus.DELIVERED)
    await session.flush()
    return order


__all__ = [
    "allocate",
    "cancel",
    "confirm",
    "create_order",
    "deliver",
    "expand_bundles",
    "ship",
]
