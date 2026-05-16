"""Inventory service: receive / ship / transfer / adjust / reserve / release.

All writes go through StockLevel + StockMovement atomically. Optimistic locking via
`StockLevel.version`. FIFO layers live alongside; `consume_layers` returns the
weighted-avg cost for COGS fallback.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.errors import (
    InsufficientStockError,
    NotFoundError,
    StockConcurrencyError,
)
from app.models.inventory import (
    CostLayer,
    CostLayerStatus,
    MovementType,
    Reservation,
    ReservationStatus,
    StockLevel,
    StockMovement,
    Warehouse,
)
from app.models.product import Product

log = get_logger("inventory")

ZERO = Decimal("0")


async def _get_or_create_level(
    session: AsyncSession, product_id: uuid.UUID, warehouse_id: uuid.UUID
) -> StockLevel:
    stmt = select(StockLevel).where(
        StockLevel.product_id == product_id, StockLevel.warehouse_id == warehouse_id
    )
    level = (await session.execute(stmt)).scalar_one_or_none()
    if level is None:
        level = StockLevel(
            product_id=product_id,
            warehouse_id=warehouse_id,
            on_hand=ZERO,
            reserved=ZERO,
            version=0,
        )
        session.add(level)
        await session.flush()
    return level


async def _bump(level: StockLevel, expected_version: int) -> None:
    if level.version != expected_version:
        raise StockConcurrencyError(
            f"Stock level changed concurrently for {level.product_id}@{level.warehouse_id}"
        )
    level.version = expected_version + 1


def _record_movement(
    session: AsyncSession,
    *,
    product_id: uuid.UUID,
    warehouse_id: uuid.UUID,
    movement_type: MovementType,
    qty: Decimal,
    unit_cost: Decimal | None = None,
    lot_id: uuid.UUID | None = None,
    ref_type: str | None = None,
    ref_id: uuid.UUID | None = None,
    note: str | None = None,
) -> StockMovement:
    mvt = StockMovement(
        product_id=product_id,
        warehouse_id=warehouse_id,
        lot_id=lot_id,
        movement_type=movement_type,
        qty=qty,
        unit_cost=unit_cost,
        ref_type=ref_type,
        ref_id=ref_id,
        note=note,
    )
    session.add(mvt)
    return mvt


# ---------- public API ----------


async def receive(
    session: AsyncSession,
    *,
    product_id: uuid.UUID,
    warehouse_id: uuid.UUID,
    qty: Decimal,
    unit_cost: Decimal,
    landed_cost_per_unit: Decimal = ZERO,
    currency: str = "EGP",
    lot_id: uuid.UUID | None = None,
    ref_type: str | None = None,
    ref_id: uuid.UUID | None = None,
) -> CostLayer:
    if qty <= 0:
        raise ValueError("receive qty must be positive")
    level = await _get_or_create_level(session, product_id, warehouse_id)
    v = level.version
    level.on_hand = Decimal(level.on_hand) + qty
    await _bump(level, v)

    layer = CostLayer(
        product_id=product_id,
        warehouse_id=warehouse_id,
        lot_id=lot_id,
        qty_received=qty,
        qty_remaining=qty,
        unit_cost=unit_cost,
        landed_cost_per_unit=landed_cost_per_unit,
        currency=currency,
        status=CostLayerStatus.ACTIVE,
    )
    session.add(layer)
    _record_movement(
        session,
        product_id=product_id,
        warehouse_id=warehouse_id,
        movement_type=MovementType.RECEIVE,
        qty=qty,
        unit_cost=unit_cost,
        lot_id=lot_id,
        ref_type=ref_type,
        ref_id=ref_id,
    )
    await session.flush()
    return layer


async def consume_layers(
    session: AsyncSession,
    *,
    product_id: uuid.UUID,
    warehouse_id: uuid.UUID,
    qty: Decimal,
) -> tuple[Decimal, list[tuple[uuid.UUID, Decimal, Decimal]]]:
    """Deplete FIFO ACTIVE layers; return (weighted_avg_cost, [(layer_id, qty, layer_unit_cost)]).

    Raises InsufficientStockError if layers are exhausted before qty.
    `weighted_avg_cost` includes landed_cost_per_unit.
    """
    if qty <= 0:
        raise ValueError("consume qty must be positive")
    stmt = (
        select(CostLayer)
        .where(
            CostLayer.product_id == product_id,
            CostLayer.warehouse_id == warehouse_id,
            CostLayer.status == CostLayerStatus.ACTIVE,
            CostLayer.qty_remaining > 0,
        )
        .order_by(CostLayer.received_at, CostLayer.id)
    )
    layers = list((await session.execute(stmt)).scalars().all())
    remaining = qty
    total_cost = ZERO
    consumed: list[tuple[uuid.UUID, Decimal, Decimal]] = []
    for layer in layers:
        if remaining <= 0:
            break
        avail = Decimal(layer.qty_remaining)
        take = min(avail, remaining)
        layer_cost = Decimal(layer.unit_cost) + Decimal(layer.landed_cost_per_unit)
        total_cost += take * layer_cost
        layer.qty_remaining = avail - take
        if layer.qty_remaining == 0:
            layer.status = CostLayerStatus.DEPLETED
        consumed.append((layer.id, take, layer_cost))
        remaining -= take

    if remaining > 0:
        raise InsufficientStockError(
            f"Insufficient FIFO layers for product {product_id}@{warehouse_id}",
            details={"requested": str(qty), "short": str(remaining)},
        )
    avg = (total_cost / qty) if qty > 0 else ZERO
    return avg, consumed


async def ship(
    session: AsyncSession,
    *,
    product_id: uuid.UUID,
    warehouse_id: uuid.UUID,
    qty: Decimal,
    unit_cost: Decimal,
    consume_layers_qty: Decimal | None = None,
    lot_id: uuid.UUID | None = None,
    ref_type: str | None = None,
    ref_id: uuid.UUID | None = None,
) -> StockMovement:
    """Ship `qty`. Always depletes FIFO layers (by `consume_layers_qty` if given else qty)
    so layer balances stay consistent regardless of which `unit_cost` is stamped.
    """
    if qty <= 0:
        raise ValueError("ship qty must be positive")
    level = await _get_or_create_level(session, product_id, warehouse_id)
    if Decimal(level.on_hand) < qty:
        raise InsufficientStockError(
            f"Insufficient on-hand for {product_id}@{warehouse_id}",
            details={"requested": str(qty), "available": str(level.on_hand)},
        )
    v = level.version
    level.on_hand = Decimal(level.on_hand) - qty
    # Released reservations should bring `reserved` down; ship callers do that explicitly.
    await _bump(level, v)

    await consume_layers(
        session,
        product_id=product_id,
        warehouse_id=warehouse_id,
        qty=consume_layers_qty if consume_layers_qty is not None else qty,
    )

    return _record_movement(
        session,
        product_id=product_id,
        warehouse_id=warehouse_id,
        movement_type=MovementType.SHIP,
        qty=-qty,
        unit_cost=unit_cost,
        lot_id=lot_id,
        ref_type=ref_type,
        ref_id=ref_id,
    )


async def transfer(
    session: AsyncSession,
    *,
    product_id: uuid.UUID,
    from_warehouse_id: uuid.UUID,
    to_warehouse_id: uuid.UUID,
    qty: Decimal,
    note: str | None = None,
) -> None:
    if from_warehouse_id == to_warehouse_id:
        raise ValueError("transfer requires distinct warehouses")
    if qty <= 0:
        raise ValueError("transfer qty must be positive")
    src = await _get_or_create_level(session, product_id, from_warehouse_id)
    if Decimal(src.on_hand) < qty:
        raise InsufficientStockError("Insufficient on-hand for transfer")
    vs = src.version
    src.on_hand = Decimal(src.on_hand) - qty
    await _bump(src, vs)

    dst = await _get_or_create_level(session, product_id, to_warehouse_id)
    vd = dst.version
    dst.on_hand = Decimal(dst.on_hand) + qty
    await _bump(dst, vd)

    # Layer move: deplete FIFO from source, open mirror layers at dest at same cost.
    _, consumed = await consume_layers(
        session,
        product_id=product_id,
        warehouse_id=from_warehouse_id,
        qty=qty,
    )
    for _layer_id, take, layer_cost in consumed:
        session.add(
            CostLayer(
                product_id=product_id,
                warehouse_id=to_warehouse_id,
                qty_received=take,
                qty_remaining=take,
                unit_cost=layer_cost,
                landed_cost_per_unit=ZERO,
                status=CostLayerStatus.ACTIVE,
            )
        )

    _record_movement(
        session,
        product_id=product_id,
        warehouse_id=from_warehouse_id,
        movement_type=MovementType.TRANSFER_OUT,
        qty=-qty,
        note=note,
    )
    _record_movement(
        session,
        product_id=product_id,
        warehouse_id=to_warehouse_id,
        movement_type=MovementType.TRANSFER_IN,
        qty=qty,
        note=note,
    )
    await session.flush()


async def adjust(
    session: AsyncSession,
    *,
    product_id: uuid.UUID,
    warehouse_id: uuid.UUID,
    delta: Decimal,
    unit_cost: Decimal | None = None,
    note: str | None = None,
) -> None:
    if delta == 0:
        return
    level = await _get_or_create_level(session, product_id, warehouse_id)
    new_on_hand = Decimal(level.on_hand) + delta
    if new_on_hand < 0:
        raise InsufficientStockError("Adjustment would drive on_hand negative")
    v = level.version
    level.on_hand = new_on_hand
    await _bump(level, v)
    if delta > 0:
        # treat as a free receipt at given unit_cost (0 default) — opens a layer
        session.add(
            CostLayer(
                product_id=product_id,
                warehouse_id=warehouse_id,
                qty_received=delta,
                qty_remaining=delta,
                unit_cost=unit_cost if unit_cost is not None else ZERO,
                status=CostLayerStatus.ACTIVE,
            )
        )
    else:
        await consume_layers(
            session,
            product_id=product_id,
            warehouse_id=warehouse_id,
            qty=-delta,
        )
    _record_movement(
        session,
        product_id=product_id,
        warehouse_id=warehouse_id,
        movement_type=MovementType.ADJUST,
        qty=delta,
        unit_cost=unit_cost,
        note=note,
    )
    await session.flush()


async def reserve(
    session: AsyncSession,
    *,
    product_id: uuid.UUID,
    warehouse_id: uuid.UUID,
    qty: Decimal,
    ref_type: str,
    ref_id: uuid.UUID,
) -> Reservation:
    if qty <= 0:
        raise ValueError("reserve qty must be positive")
    level = await _get_or_create_level(session, product_id, warehouse_id)
    available = Decimal(level.on_hand) - Decimal(level.reserved)
    if available < qty:
        raise InsufficientStockError(
            f"Insufficient availability for {product_id}@{warehouse_id}",
            details={"available": str(available), "requested": str(qty)},
        )
    v = level.version
    level.reserved = Decimal(level.reserved) + qty
    await _bump(level, v)

    res = Reservation(
        product_id=product_id,
        warehouse_id=warehouse_id,
        qty=qty,
        ref_type=ref_type,
        ref_id=ref_id,
        status=ReservationStatus.ACTIVE,
    )
    session.add(res)
    _record_movement(
        session,
        product_id=product_id,
        warehouse_id=warehouse_id,
        movement_type=MovementType.RESERVE,
        qty=qty,
        ref_type=ref_type,
        ref_id=ref_id,
    )
    await session.flush()
    return res


async def release(
    session: AsyncSession,
    *,
    reservation_id: uuid.UUID,
    consume: bool = False,
) -> None:
    res = await session.get(Reservation, reservation_id)
    if res is None:
        raise NotFoundError(f"Reservation {reservation_id} not found")
    if res.status != ReservationStatus.ACTIVE:
        return
    level = await _get_or_create_level(session, res.product_id, res.warehouse_id)
    v = level.version
    level.reserved = Decimal(level.reserved) - Decimal(res.qty)
    await _bump(level, v)
    res.status = ReservationStatus.CONSUMED if consume else ReservationStatus.RELEASED
    res.released_at = datetime.utcnow()
    _record_movement(
        session,
        product_id=res.product_id,
        warehouse_id=res.warehouse_id,
        movement_type=MovementType.RELEASE,
        qty=-Decimal(res.qty),
        ref_type=res.ref_type,
        ref_id=res.ref_id,
    )
    await session.flush()


async def release_for_ref(
    session: AsyncSession, *, ref_type: str, ref_id: uuid.UUID, consume: bool = False
) -> int:
    stmt = select(Reservation).where(
        Reservation.ref_type == ref_type,
        Reservation.ref_id == ref_id,
        Reservation.status == ReservationStatus.ACTIVE,
    )
    rows = list((await session.execute(stmt)).scalars().all())
    for r in rows:
        await release(session, reservation_id=r.id, consume=consume)
    return len(rows)


async def get_warehouse(session: AsyncSession, warehouse_id: uuid.UUID) -> Warehouse:
    wh = await session.get(Warehouse, warehouse_id)
    if wh is None:
        raise NotFoundError(f"Warehouse {warehouse_id} not found")
    return wh


async def get_product(session: AsyncSession, product_id: uuid.UUID) -> Product:
    p = await session.get(Product, product_id)
    if p is None:
        raise NotFoundError(f"Product {product_id} not found")
    return p


async def levels_for_product(session: AsyncSession, product_id: uuid.UUID) -> list[StockLevel]:
    stmt = select(StockLevel).where(StockLevel.product_id == product_id)
    return list((await session.execute(stmt)).scalars().all())


async def list_levels(session: AsyncSession) -> list[StockLevel]:
    return list((await session.execute(select(StockLevel))).scalars().all())


__all__: list[str] = [
    "adjust",
    "consume_layers",
    "get_product",
    "get_warehouse",
    "levels_for_product",
    "list_levels",
    "receive",
    "release",
    "release_for_ref",
    "reserve",
    "ship",
    "transfer",
]


def _noop_for_type_checker() -> Any:  # pragma: no cover
    return None
