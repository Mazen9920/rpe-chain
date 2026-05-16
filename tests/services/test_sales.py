"""Sales lifecycle test: create → confirm → allocate → ship → COGS + Shopify outbox."""

from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models.accounting import PendingJournalEntry, PendingJournalLine
from app.models.integrations import IntegrationOutbox, OutboxStatus
from app.models.inventory import Warehouse
from app.models.product import Product, ProductType
from app.models.sales import Customer, SalesOrderSource, SalesOrderStatus, Shipment
from app.services import inventory as inv
from app.services import sales as sales_svc

pytestmark = pytest.mark.asyncio


async def _seed(db):
    cust = Customer(code="C1", name="Acme", currency="EGP")
    wh = Warehouse(code="WH", name="Main")
    a = Product(
        sku="A1", name="A", product_type=ProductType.FINISHED, uom="EA", selling_price=Decimal("10")
    )
    b = Product(
        sku="B1", name="B", product_type=ProductType.FINISHED, uom="EA", selling_price=Decimal("20")
    )
    db.add_all([cust, wh, a, b])
    await db.flush()
    await inv.receive(
        db, product_id=a.id, warehouse_id=wh.id, qty=Decimal("100"), unit_cost=Decimal("3")
    )
    await inv.receive(
        db, product_id=b.id, warehouse_id=wh.id, qty=Decimal("100"), unit_cost=Decimal("5")
    )
    await db.flush()
    return cust, wh, a, b


async def test_full_order_to_cash(db_session):
    cust, wh, a, b = await _seed(db_session)
    order = await sales_svc.create_order(
        db_session,
        customer_id=cust.id,
        warehouse_id=wh.id,
        lines=[
            {"product_id": a.id, "qty": Decimal("5"), "unit_price": Decimal("10")},
            {"product_id": b.id, "qty": Decimal("3"), "unit_price": Decimal("20")},
        ],
    )
    await db_session.flush()
    assert order.status == SalesOrderStatus.RECEIVED
    await sales_svc.confirm(db_session, order.id)
    assert order.status == SalesOrderStatus.CONFIRMED
    await sales_svc.allocate(db_session, order.id)
    assert order.status == SalesOrderStatus.ALLOCATED
    shipment = await sales_svc.ship(db_session, order.id, carrier="DHL", tracking_number="X1")
    await db_session.flush()
    assert shipment.status.value in ("DISPATCHED", "DRAFT")
    await db_session.refresh(order)
    assert order.status == SalesOrderStatus.SHIPPED
    # COGS posted
    pjs = list((await db_session.execute(select(PendingJournalEntry))).scalars().all())
    assert len(pjs) == 1
    pj_lines = list(
        (
            await db_session.execute(
                select(PendingJournalLine).where(PendingJournalLine.entry_id == pjs[0].id)
            )
        )
        .scalars()
        .all()
    )
    debit = sum(line.debit for line in pj_lines)
    credit = sum(line.credit for line in pj_lines)
    assert debit == credit and debit > 0


async def test_shopify_order_triggers_outbox(db_session):
    cust, wh, a, _ = await _seed(db_session)
    order = await sales_svc.create_order(
        db_session,
        customer_id=cust.id,
        warehouse_id=wh.id,
        lines=[{"product_id": a.id, "qty": Decimal("2"), "unit_price": Decimal("10")}],
        source=SalesOrderSource.SHOPIFY,
        external_id="SHP-123",
    )
    await sales_svc.confirm(db_session, order.id)
    await sales_svc.allocate(db_session, order.id)
    await sales_svc.ship(db_session, order.id, carrier="DHL", tracking_number="T1")
    await db_session.flush()
    rows = list((await db_session.execute(select(IntegrationOutbox))).scalars().all())
    fulfill = [r for r in rows if r.action == "fulfillments.create"]
    assert len(fulfill) == 1
    assert fulfill[0].status == OutboxStatus.PENDING
    _ = Shipment
