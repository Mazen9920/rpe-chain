"""Inventory FIFO + reservation + transfer tests."""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.errors import InsufficientStockError, StockConcurrencyError
from app.models.inventory import StockLevel, Warehouse
from app.models.product import Product, ProductType
from app.services import inventory as inv

pytestmark = pytest.mark.asyncio


async def _seed(db):
    p = Product(sku="WIDGET", name="Widget", uom="EA", product_type=ProductType.FINISHED)
    w1 = Warehouse(code="W1", name="Main")
    w2 = Warehouse(code="W2", name="Other")
    db.add_all([p, w1, w2])
    await db.flush()
    return p, w1, w2


async def test_receive_creates_layer_and_level(db_session):
    p, w, _ = await _seed(db_session)
    layer = await inv.receive(
        db_session,
        product_id=p.id,
        warehouse_id=w.id,
        qty=Decimal("10"),
        unit_cost=Decimal("3"),
        landed_cost_per_unit=Decimal("0.5"),
    )
    await db_session.flush()
    assert layer.qty_remaining == Decimal("10.0000")
    lvl = (
        await db_session.execute(
            __import__("sqlalchemy").select(StockLevel).where(StockLevel.product_id == p.id)
        )
    ).scalar_one()
    assert lvl.on_hand == Decimal("10.0000")


async def test_consume_layers_fifo(db_session):
    p, w, _ = await _seed(db_session)
    from datetime import UTC, datetime

    from app.models.inventory import CostLayer

    layer_a = await inv.receive(
        db_session, product_id=p.id, warehouse_id=w.id, qty=Decimal("5"), unit_cost=Decimal("2")
    )
    layer_a.received_at = datetime(2024, 1, 1, 10, 0, 0, tzinfo=UTC)
    layer_b = await inv.receive(
        db_session, product_id=p.id, warehouse_id=w.id, qty=Decimal("5"), unit_cost=Decimal("4")
    )
    layer_b.received_at = datetime(2024, 1, 2, 10, 0, 0, tzinfo=UTC)
    await db_session.flush()
    unit_cost, _consumed = await inv.consume_layers(
        db_session, product_id=p.id, warehouse_id=w.id, qty=Decimal("6")
    )
    # 5@2 + 1@4 = 14 / 6 = 2.3333
    assert unit_cost.quantize(Decimal("0.0001")) == Decimal("2.3333")
    _ = CostLayer  # silence unused


async def test_consume_layers_insufficient_raises(db_session):
    p, w, _ = await _seed(db_session)
    await inv.receive(
        db_session, product_id=p.id, warehouse_id=w.id, qty=Decimal("2"), unit_cost=Decimal("1")
    )
    with pytest.raises(InsufficientStockError):
        await inv.consume_layers(db_session, product_id=p.id, warehouse_id=w.id, qty=Decimal("5"))


async def test_reserve_then_release_consume(db_session):
    p, w, _ = await _seed(db_session)
    await inv.receive(
        db_session, product_id=p.id, warehouse_id=w.id, qty=Decimal("10"), unit_cost=Decimal("1")
    )
    import uuid as _u

    ref = _u.uuid4()
    res = await inv.reserve(
        db_session,
        product_id=p.id,
        warehouse_id=w.id,
        qty=Decimal("3"),
        ref_type="SO",
        ref_id=ref,
    )
    await db_session.flush()
    lvl = (
        await db_session.get(StockLevel, res.id)
        or (
            await db_session.execute(
                __import__("sqlalchemy").select(StockLevel).where(StockLevel.product_id == p.id)
            )
        ).scalar_one()
    )
    assert lvl.reserved == Decimal("3.0000")
    await inv.release_for_ref(db_session, ref_type="SO", ref_id=ref, consume=True)
    await db_session.flush()
    await db_session.refresh(lvl)
    assert lvl.reserved == Decimal("0.0000")


async def test_transfer_moves_stock(db_session):
    p, w1, w2 = await _seed(db_session)
    await inv.receive(
        db_session,
        product_id=p.id,
        warehouse_id=w1.id,
        qty=Decimal("10"),
        unit_cost=Decimal("2"),
    )
    await db_session.flush()
    await inv.transfer(
        db_session,
        product_id=p.id,
        from_warehouse_id=w1.id,
        to_warehouse_id=w2.id,
        qty=Decimal("4"),
    )
    await db_session.flush()
    from sqlalchemy import select

    src = (
        await db_session.execute(select(StockLevel).where(StockLevel.warehouse_id == w1.id))
    ).scalar_one()
    dst = (
        await db_session.execute(select(StockLevel).where(StockLevel.warehouse_id == w2.id))
    ).scalar_one()
    assert src.on_hand == Decimal("6.0000")
    assert dst.on_hand == Decimal("4.0000")


async def test_optimistic_lock_bump(db_session):
    p, w, _ = await _seed(db_session)
    await inv.receive(
        db_session, product_id=p.id, warehouse_id=w.id, qty=Decimal("5"), unit_cost=Decimal("1")
    )
    await db_session.flush()
    from sqlalchemy import select

    lvl = (
        await db_session.execute(select(StockLevel).where(StockLevel.product_id == p.id))
    ).scalar_one()
    with pytest.raises(StockConcurrencyError):
        await inv._bump(lvl, lvl.version + 5)
