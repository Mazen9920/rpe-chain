"""RMA lifecycle tests (v0.4.1)."""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.errors import InvalidStateError
from app.models.inventory import StockLevel, Warehouse
from app.models.product import Product, ProductType
from app.models.rma import RMALineDisposition, RMARefundMethod, RMAStatus
from app.models.sales import Customer
from app.services import rma as rma_svc

pytestmark = pytest.mark.asyncio


async def _seed(db) -> dict:
    cust = Customer(code="ACME", name="Acme", email="a@b.com")
    fg = Product(sku="FG-X", name="Product X", product_type=ProductType.FINISHED)
    wh = Warehouse(code="W1", name="Main")
    db.add_all([cust, fg, wh])
    await db.flush()
    return {"cust": cust, "fg": fg, "wh": wh}


def _line(product_id, qty=Decimal("2"), price=Decimal("100"), cost=Decimal("40")):
    return rma_svc.RMALineInput(
        product_id=product_id,
        qty_requested=qty,
        original_unit_price=price,
        original_unit_cost=cost,
        disposition=RMALineDisposition.RESTOCK,
    )


async def test_create_rma_sets_total_refund_and_account(db_session):
    s = await _seed(db_session)
    rma = await rma_svc.create_rma(
        db_session,
        customer_id=s["cust"].id,
        warehouse_id=s["wh"].id,
        lines=[_line(s["fg"].id, qty=Decimal("3"), price=Decimal("50"))],
        refund_method=RMARefundMethod.CASH,
    )
    assert rma.status == RMAStatus.REQUESTED
    assert rma.rma_number.startswith("RMA")
    assert Decimal(rma.total_refund_amount) == Decimal("150.0000")
    assert rma.refund_account_code == rma_svc.CASH_ACCOUNT


async def test_authorize_only_from_requested(db_session):
    s = await _seed(db_session)
    rma = await rma_svc.create_rma(
        db_session,
        customer_id=s["cust"].id,
        warehouse_id=s["wh"].id,
        lines=[_line(s["fg"].id)],
    )
    await rma_svc.authorize_rma(db_session, rma.id)
    assert rma.status == RMAStatus.AUTHORIZED
    with pytest.raises(InvalidStateError):
        await rma_svc.authorize_rma(db_session, rma.id)


async def test_receive_with_default_disposition_restocks_all(db_session):
    s = await _seed(db_session)
    rma = await rma_svc.create_rma(
        db_session,
        customer_id=s["cust"].id,
        warehouse_id=s["wh"].id,
        lines=[_line(s["fg"].id, qty=Decimal("4"))],
    )
    await rma_svc.authorize_rma(db_session, rma.id)
    await rma_svc.receive_rma(db_session, rma.id)
    assert rma.status == RMAStatus.RECEIVED
    lines = await rma_svc._lines(db_session, rma.id)
    assert lines[0].qty_received == Decimal("4.0000")
    assert lines[0].qty_restocked == Decimal("4.0000")
    assert lines[0].qty_scrapped == Decimal("0.0000")


async def test_receive_with_split_disposition(db_session):
    s = await _seed(db_session)
    rma = await rma_svc.create_rma(
        db_session,
        customer_id=s["cust"].id,
        warehouse_id=s["wh"].id,
        lines=[_line(s["fg"].id, qty=Decimal("10"))],
    )
    await rma_svc.authorize_rma(db_session, rma.id)
    lines = await rma_svc._lines(db_session, rma.id)
    await rma_svc.receive_rma(
        db_session,
        rma.id,
        dispositions={lines[0].id: (Decimal("7"), Decimal("3"))},
    )
    lines = await rma_svc._lines(db_session, rma.id)
    assert lines[0].qty_restocked == Decimal("7.0000")
    assert lines[0].qty_scrapped == Decimal("3.0000")
    assert lines[0].qty_received == Decimal("10.0000")


async def test_receive_rejects_overage(db_session):
    s = await _seed(db_session)
    rma = await rma_svc.create_rma(
        db_session,
        customer_id=s["cust"].id,
        warehouse_id=s["wh"].id,
        lines=[_line(s["fg"].id, qty=Decimal("5"))],
    )
    await rma_svc.authorize_rma(db_session, rma.id)
    lines = await rma_svc._lines(db_session, rma.id)
    with pytest.raises(InvalidStateError):
        await rma_svc.receive_rma(
            db_session,
            rma.id,
            dispositions={lines[0].id: (Decimal("5"), Decimal("1"))},
        )


async def test_close_rma_restocks_inventory(db_session):
    s = await _seed(db_session)
    rma = await rma_svc.create_rma(
        db_session,
        customer_id=s["cust"].id,
        warehouse_id=s["wh"].id,
        lines=[_line(s["fg"].id, qty=Decimal("5"), price=Decimal("100"), cost=Decimal("40"))],
    )
    await rma_svc.authorize_rma(db_session, rma.id)
    await rma_svc.receive_rma(db_session, rma.id)
    await rma_svc.close_rma(db_session, rma.id)
    assert rma.status == RMAStatus.CLOSED
    from sqlalchemy import select

    lvl = (
        await db_session.execute(select(StockLevel).where(StockLevel.product_id == s["fg"].id))
    ).scalar_one()
    assert lvl.on_hand == Decimal("5.0000")


async def test_cancel_rma_from_requested(db_session):
    s = await _seed(db_session)
    rma = await rma_svc.create_rma(
        db_session,
        customer_id=s["cust"].id,
        warehouse_id=s["wh"].id,
        lines=[_line(s["fg"].id)],
    )
    await rma_svc.cancel_rma(db_session, rma.id)
    assert rma.status == RMAStatus.CANCELLED


async def test_cancel_rma_after_receive_fails(db_session):
    s = await _seed(db_session)
    rma = await rma_svc.create_rma(
        db_session,
        customer_id=s["cust"].id,
        warehouse_id=s["wh"].id,
        lines=[_line(s["fg"].id)],
    )
    await rma_svc.authorize_rma(db_session, rma.id)
    await rma_svc.receive_rma(db_session, rma.id)
    with pytest.raises(InvalidStateError):
        await rma_svc.cancel_rma(db_session, rma.id)


async def test_summary_counts(db_session):
    s = await _seed(db_session)
    await rma_svc.create_rma(
        db_session,
        customer_id=s["cust"].id,
        warehouse_id=s["wh"].id,
        lines=[_line(s["fg"].id)],
    )
    counts = await rma_svc.open_rma_summary(db_session)
    assert counts["REQUESTED"] == 1
