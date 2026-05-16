"""Verify COGS pending entry promotes to real GL journal when CoA is seeded."""

from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models.accounting import PendingJournalEntry, PendingJournalStatus
from app.models.gl import GLJournal, GLJournalLine
from app.models.inventory import Warehouse
from app.models.product import Product, ProductType
from app.models.sales import Customer
from app.services import gl as gl_svc
from app.services import inventory as inv
from app.services import sales as sales_svc

pytestmark = pytest.mark.asyncio


async def test_ship_posts_real_gl_journal_when_coa_seeded(db_session):
    await gl_svc.seed_egypt_coa(db_session)
    cust = Customer(code="C", name="X", currency="EGP")
    wh = Warehouse(code="WH", name="Main")
    p = Product(
        sku="FG1",
        name="FG",
        uom="EA",
        product_type=ProductType.FINISHED,
        selling_price=Decimal("10"),
    )
    db_session.add_all([cust, wh, p])
    await db_session.flush()
    await inv.receive(
        db_session,
        product_id=p.id,
        warehouse_id=wh.id,
        qty=Decimal("10"),
        unit_cost=Decimal("3"),
    )
    order = await sales_svc.create_order(
        db_session,
        customer_id=cust.id,
        warehouse_id=wh.id,
        lines=[{"product_id": p.id, "qty": Decimal("2"), "unit_price": Decimal("10")}],
    )
    await sales_svc.confirm(db_session, order.id)
    await sales_svc.allocate(db_session, order.id)
    await sales_svc.ship(db_session, order.id)
    await db_session.flush()

    # PendingJournalEntry promoted to POSTED
    pe = (await db_session.execute(select(PendingJournalEntry))).scalar_one()
    assert pe.status == PendingJournalStatus.POSTED
    assert pe.posted_journal_id is not None

    # Real GL journal exists w/ COGS_FG → 5400 and INV_FG → 5000
    jrn = (
        await db_session.execute(select(GLJournal).where(GLJournal.id == pe.posted_journal_id))
    ).scalar_one()
    lines = list(
        (await db_session.execute(select(GLJournalLine).where(GLJournalLine.journal_id == jrn.id)))
        .scalars()
        .all()
    )
    debit_total = sum(ln.debit for ln in lines)
    credit_total = sum(ln.credit for ln in lines)
    assert debit_total == credit_total > 0
    # 2 lines per shipment line: DR 5400, CR 5000
    from app.models.gl import GLAccount

    accts = {a.id: a.code for a in (await db_session.execute(select(GLAccount))).scalars().all()}
    codes_used = {accts[ln.account_id] for ln in lines}
    assert "5400" in codes_used and "5000" in codes_used
