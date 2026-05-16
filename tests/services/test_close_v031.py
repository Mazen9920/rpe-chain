"""v0.3.1 — AR + period close + recognition + reports + audits."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.errors import AuditFailedError, PeriodLockedError
from app.models.ar import CustomerInvoice, CustomerInvoiceStatus
from app.models.close import (
    AccountingPeriod,
    PeriodStatus,
    RecognitionMode,
)
from app.models.inventory import Warehouse
from app.models.product import Product, ProductType
from app.models.sales import Customer
from app.services import ar as ar_svc
from app.services import audit as audit_svc
from app.services import gl as gl_svc
from app.services import inventory as inv
from app.services import period_close as close_svc
from app.services import recognition as rec_svc
from app.services import reports as reports_svc
from app.services import sales as sales_svc

pytestmark = pytest.mark.asyncio


async def _seed(db):
    await gl_svc.seed_egypt_coa(db)
    cust = Customer(code="C-ACME", name="Acme Co", currency="EGP", payment_terms_days=30)
    wh = Warehouse(code="WH", name="Main")
    p = Product(
        sku="FG-1",
        name="Widget",
        product_type=ProductType.FINISHED,
        uom="EA",
        selling_price=Decimal("100"),
    )
    db.add_all([cust, wh, p])
    await db.flush()
    await inv.receive(
        db, product_id=p.id, warehouse_id=wh.id, qty=Decimal("50"), unit_cost=Decimal("40")
    )
    await db.flush()
    return cust, wh, p


async def test_ship_auto_posts_ar_invoice(db_session):
    cust, wh, p = await _seed(db_session)
    order = await sales_svc.create_order(
        db_session,
        customer_id=cust.id,
        warehouse_id=wh.id,
        lines=[{"product_id": p.id, "qty": Decimal("3"), "unit_price": Decimal("100")}],
    )
    await sales_svc.confirm(db_session, order.id)
    await sales_svc.allocate(db_session, order.id)
    shipment = await sales_svc.ship(db_session, order.id, carrier="DHL", tracking_number="T")
    await db_session.flush()
    invs = list(
        (
            await db_session.execute(
                select(CustomerInvoice).where(CustomerInvoice.shipment_id == shipment.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(invs) == 1
    inv0 = invs[0]
    assert inv0.status == CustomerInvoiceStatus.POSTED
    assert inv0.total == Decimal("300.0000")
    assert inv0.posted_journal_id is not None


async def test_ar_payment_applies_and_marks_paid(db_session):
    cust, wh, p = await _seed(db_session)
    order = await sales_svc.create_order(
        db_session,
        customer_id=cust.id,
        warehouse_id=wh.id,
        lines=[{"product_id": p.id, "qty": Decimal("2"), "unit_price": Decimal("50")}],
    )
    await sales_svc.confirm(db_session, order.id)
    await sales_svc.allocate(db_session, order.id)
    await sales_svc.ship(db_session, order.id, carrier="DHL", tracking_number="T2")
    await db_session.flush()

    payment = await ar_svc.register_payment(
        db_session,
        customer_id=cust.id,
        payment_date=date.today(),
        amount=Decimal("100"),
    )
    await db_session.flush()
    assert payment.posted_journal_id is not None
    inv_row = (
        await db_session.execute(
            select(CustomerInvoice).where(CustomerInvoice.customer_id == cust.id)
        )
    ).scalar_one()
    assert inv_row.amount_paid == Decimal("100.0000")
    assert inv_row.status == CustomerInvoiceStatus.PAID


async def test_aging_buckets(db_session):
    cust, _, _ = await _seed(db_session)
    # Create one invoice dated 100 days ago
    await ar_svc.post_invoice(
        db_session,
        customer_id=cust.id,
        invoice_date=date(2025, 1, 1),
        lines=[
            ar_svc.InvoiceLineSpec(description="x", qty=Decimal("1"), unit_price=Decimal("500"))
        ],
        due_date=date(2025, 1, 1),
    )
    await db_session.flush()
    buckets = await ar_svc.aging_buckets(db_session, as_of=date(2025, 5, 1))
    assert buckets["90_plus"] == Decimal("500.0000")


async def test_period_close_locks_and_blocks_future_posts(db_session):
    await _seed(db_session)
    # Post a balanced journal in Jan 2026
    await gl_svc.post_journal(
        db_session,
        source_doc_type="TEST",
        source_doc_id=uuid.uuid4(),
        event_date=date(2026, 1, 15),
        lines=[
            gl_svc.JournalLineSpec(account_code="1020", debit=Decimal("100")),
            gl_svc.JournalLineSpec(account_code="3010", credit=Decimal("100")),
        ],
    )
    await db_session.flush()
    result = await close_svc.close(db_session, year=2026, month=1, locked_by="tester")
    assert result["status"] == PeriodStatus.LOCKED.value
    await db_session.flush()
    # Subsequent post should raise PeriodLockedError → 409
    with pytest.raises(PeriodLockedError):
        await gl_svc.post_journal(
            db_session,
            source_doc_type="TEST2",
            source_doc_id=uuid.uuid4(),
            event_date=date(2026, 1, 20),
            lines=[
                gl_svc.JournalLineSpec(account_code="1020", debit=Decimal("10")),
                gl_svc.JournalLineSpec(account_code="3010", credit=Decimal("10")),
            ],
        )


async def test_recognition_monthly_idempotent(db_session):
    await gl_svc.seed_egypt_coa(db_session)
    contract = await rec_svc.schedule_contract(
        db_session,
        code="RENT",
        description="Office rent",
        expense_account_code="6140",
        total_amount=Decimal("12000"),
        start_date=date(2026, 1, 1),
        recognition_mode=RecognitionMode.MONTHLY,
        period_months=12,
    )
    await db_session.flush()
    e1 = await rec_svc.recognize_for_period(db_session, contract_id=contract.id, year=2026, month=1)
    e2 = await rec_svc.recognize_for_period(db_session, contract_id=contract.id, year=2026, month=1)
    assert e1 is not None and e2 is not None
    assert e1.id == e2.id
    assert e1.amount == Decimal("1000.0000")


async def test_audits_lists_27_and_persists_results(db_session):
    await _seed(db_session)
    defs = audit_svc.list_checks()
    assert len(defs) == 27
    period = AccountingPeriod(year=2026, month=2, status=PeriodStatus.OPEN)
    db_session.add(period)
    await db_session.flush()
    results = await audit_svc.run_audits(db_session, period=period)
    assert len(results) == 27


async def test_close_fails_on_blocker(db_session):
    await _seed(db_session)
    # Unbalanced journal forbidden by gl_svc; instead create a future-dated journal
    # which triggers c04_no_future_journals BLOCKER for period 2026-01.
    await gl_svc.post_journal(
        db_session,
        source_doc_type="FUTURE",
        source_doc_id=uuid.uuid4(),
        event_date=date(2027, 6, 1),
        lines=[
            gl_svc.JournalLineSpec(account_code="1020", debit=Decimal("1")),
            gl_svc.JournalLineSpec(account_code="3010", credit=Decimal("1")),
        ],
    )
    await db_session.flush()
    with pytest.raises(AuditFailedError) as ei:
        await close_svc.close(db_session, year=2026, month=1, locked_by="t")
    assert "failures" in ei.value.details


async def test_reports_pnl_bs_cf(db_session):
    cust, wh, p = await _seed(db_session)
    order = await sales_svc.create_order(
        db_session,
        customer_id=cust.id,
        warehouse_id=wh.id,
        lines=[{"product_id": p.id, "qty": Decimal("2"), "unit_price": Decimal("100")}],
    )
    await sales_svc.confirm(db_session, order.id)
    await sales_svc.allocate(db_session, order.id)
    await sales_svc.ship(db_session, order.id, carrier="DHL", tracking_number="T3")
    await db_session.flush()

    pnl = await reports_svc.pnl(
        db_session, period_start=date(2020, 1, 1), period_end=date(2030, 12, 31)
    )
    assert pnl.revenue_total >= Decimal("200")

    bs = await reports_svc.balance_sheet(db_session, as_of=date(2030, 12, 31))
    # Assets = Liabilities + Equity (incl retained earnings)
    assert bs.balanced is True

    cf = await reports_svc.cash_flow(
        db_session, period_start=date(2020, 1, 1), period_end=date(2030, 12, 31)
    )
    # No cash leg yet (shipment didn't touch cash); should be zero
    assert cf.net_change_in_cash == Decimal("0.0000")
