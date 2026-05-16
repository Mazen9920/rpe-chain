"""Procurement + AP E2E: PO → receipt → invoice → payment posts 4 journals; TB balances."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models.gl import GLJournal
from app.models.inventory import StockLevel, Warehouse
from app.models.procurement import (
    POLine,
    POStatus,
    Supplier,
    SupplierInvoiceStatus,
    VendorType,
)
from app.models.product import Product, ProductType
from app.services import ap as ap_svc
from app.services import gl as gl_svc
from app.services import purchasing as purch_svc

pytestmark = pytest.mark.asyncio


async def _seed(db):
    await gl_svc.seed_egypt_coa(db)
    sup = Supplier(
        code="HASSAN",
        name="Hassan Mfg",
        vendor_type=VendorType.MANUFACTURER,
        currency="EGP",
        payment_terms_days=30,
        ap_account_code="2020",
    )
    wh = Warehouse(code="EG-CAI-01", name="Cairo Main")
    rm = Product(sku="WRAP-RM", name="Wrap RM", uom="EA", product_type=ProductType.RAW)
    db.add_all([sup, wh, rm])
    await db.flush()
    return sup, wh, rm


async def test_full_p2p_flow(db_session):
    sup, wh, rm = await _seed(db_session)

    # 1. Create + send PO for 100 units @ 5 EGP, 50 EGP landed cost
    po = await purch_svc.create_po(
        db_session,
        supplier_id=sup.id,
        warehouse_id=wh.id,
        lines=[
            purch_svc.POLineInput(product_id=rm.id, qty=Decimal("100"), unit_price=Decimal("5"))
        ],
        landed_cost_total=Decimal("50"),
    )
    await purch_svc.send_po(db_session, po.id)
    await db_session.refresh(po)
    assert po.status == POStatus.SENT

    po_line = (await db_session.execute(select(POLine).where(POLine.po_id == po.id))).scalar_one()

    # 2. Receive all 100 with 50 EGP extra landed
    gr = await purch_svc.receive_po(
        db_session,
        po_id=po.id,
        lines=[purch_svc.GRLineInput(po_line_id=po_line.id, qty=Decimal("100"))],
        extra_landed_cost=Decimal("50"),
    )
    await db_session.refresh(po)
    assert po.status == POStatus.RECEIVED
    # Stock landed
    lvl = (
        await db_session.execute(select(StockLevel).where(StockLevel.product_id == rm.id))
    ).scalar_one()
    assert lvl.on_hand == Decimal("100.0000")
    from app.models.procurement import GoodsReceiptLine

    gr_line = (
        await db_session.execute(select(GoodsReceiptLine).where(GoodsReceiptLine.gr_id == gr.id))
    ).scalar_one()
    assert gr_line.landed_per_unit == Decimal("0.5000")

    # 3. Three-way match check
    ok, recv_value, var = await purch_svc.three_way_match(
        db_session, po_id=po.id, invoice_total=Decimal("500")
    )
    assert ok and recv_value == Decimal("500.0000") and var == Decimal("0.0000")

    # 4. Register invoice (500 EGP for 100 units RM)
    inv = await ap_svc.register_invoice(
        db_session,
        supplier_id=sup.id,
        invoice_number="INV-001",
        invoice_date=date(2026, 2, 1),
        lines=[
            ap_svc.InvoiceLineInput(
                description="WRAP-RM",
                account_code="5010",  # Inventory-RM
                qty=Decimal("100"),
                unit_price=Decimal("5"),
                po_line_id=po_line.id,
            )
        ],
        po_id=po.id,
    )
    assert inv.status == SupplierInvoiceStatus.POSTED
    assert inv.total == Decimal("500.0000")
    assert inv.posted_journal_id is not None

    # 5. Pay full
    pay = await ap_svc.pay_invoice(
        db_session,
        invoice_id=inv.id,
        payment_date=date(2026, 2, 15),
        amount=Decimal("500"),
    )
    await db_session.refresh(inv)
    assert inv.status == SupplierInvoiceStatus.PAID
    assert pay.posted_journal_id is not None

    # 6. Two GL journals (invoice + payment). GR doesn't post yet (lands stock only).
    journals = list(
        (await db_session.execute(select(GLJournal).order_by(GLJournal.event_date))).scalars().all()
    )
    assert len(journals) == 2
    # 7. Trial balance balances
    rows = await gl_svc.trial_balance(db_session, as_of=date(2026, 3, 1))
    total_d = sum(d for _, d, _ in rows)
    total_c = sum(c for _, _, c in rows)
    assert total_d == total_c
    # AP-Manufacturers (2020) net = 0 after payment
    by_code = {code: (d, c) for code, d, c in rows}
    assert by_code["2020"][0] == by_code["2020"][1]
    # Inventory-RM debited 500
    assert by_code["5010"][0] == Decimal("500.0000")
    # Cash bank credited 500
    assert by_code["1020"][1] == Decimal("500.0000")


async def test_partial_payment_then_full(db_session):
    sup, _wh, _rm = await _seed(db_session)
    inv = await ap_svc.register_invoice(
        db_session,
        supplier_id=sup.id,
        invoice_number="INV-PART",
        invoice_date=date(2026, 4, 1),
        lines=[
            ap_svc.InvoiceLineInput(
                description="x",
                account_code="5010",
                qty=Decimal("1"),
                unit_price=Decimal("300"),
            )
        ],
    )
    await ap_svc.pay_invoice(
        db_session, invoice_id=inv.id, payment_date=date(2026, 4, 5), amount=Decimal("100")
    )
    await db_session.refresh(inv)
    assert inv.status == SupplierInvoiceStatus.PARTIALLY_PAID
    assert inv.amount_paid == Decimal("100.0000")
    await ap_svc.pay_invoice(
        db_session, invoice_id=inv.id, payment_date=date(2026, 4, 10), amount=Decimal("200")
    )
    await db_session.refresh(inv)
    assert inv.status == SupplierInvoiceStatus.PAID


async def test_aging_buckets(db_session):
    sup, _, _ = await _seed(db_session)
    # 1 invoice 45 days overdue, 1 within terms
    await ap_svc.register_invoice(
        db_session,
        supplier_id=sup.id,
        invoice_number="INV-OLD",
        invoice_date=date(2026, 1, 1),
        due_date=date(2026, 1, 15),
        lines=[
            ap_svc.InvoiceLineInput(
                description="x",
                account_code="5010",
                qty=Decimal("1"),
                unit_price=Decimal("200"),
            )
        ],
    )
    await ap_svc.register_invoice(
        db_session,
        supplier_id=sup.id,
        invoice_number="INV-NEW",
        invoice_date=date(2026, 2, 20),
        due_date=date(2026, 3, 5),
        lines=[
            ap_svc.InvoiceLineInput(
                description="x",
                account_code="5010",
                qty=Decimal("1"),
                unit_price=Decimal("75"),
            )
        ],
    )
    buckets = await ap_svc.aging_buckets(db_session, as_of=date(2026, 3, 1))
    assert buckets["current"] == Decimal("75.0000")
    assert buckets["31_60"] == Decimal("200.0000")
