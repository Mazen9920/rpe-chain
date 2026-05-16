"""v0.4.0 — Bosta COD ledger + remittance parser."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.integrations.bosta.remittance_csv import (
    BostaRemittanceRow,
    parse_remittance_csv,
)
from app.models.payments import CODLedgerEntry, CODStatus
from app.services import cod_ledger as cod_svc
from app.services import gl as gl_svc

pytestmark = pytest.mark.asyncio


async def test_parse_remittance_csv_aliases():
    csv = (
        "tracking_number,cod,delivery_fee,delivered_at,remitted_at,batch\n"
        "BST-1,500.00,30.00,2025-02-01,2025-02-03,STMT-99\n"
        "BST-2,250.00,30.00,2025-02-02,2025-02-03,STMT-99\n"
    )
    rows = parse_remittance_csv(csv)
    assert len(rows) == 2
    assert rows[0].tracking_id == "BST-1"
    assert rows[0].cod_amount == Decimal("500.00")
    assert rows[0].delivery_fee == Decimal("30.00")
    assert rows[0].remittance_ref == "STMT-99"


async def test_record_shipment_posts_subledger_transfer(db_session):
    await gl_svc.seed_egypt_coa(db_session)

    entry = await cod_svc.record_shipment(
        db_session,
        tracking_id="BST-100",
        cod_amount=Decimal("750.00"),
        shipped_at=datetime(2025, 2, 1),
    )

    assert entry.status == CODStatus.IN_TRANSIT
    assert entry.posted_journal_id is not None

    from app.models.gl import GLJournalLine

    lines = list(
        (
            await db_session.execute(
                select(GLJournalLine).where(GLJournalLine.journal_id == entry.posted_journal_id)
            )
        )
        .scalars()
        .all()
    )
    debits = sum((ln.debit for ln in lines), Decimal("0"))
    credit_total = sum((ln.credit for ln in lines), Decimal("0"))
    assert debits == credit_total == Decimal("750.0000")


async def test_remittance_marks_delivered_and_posts_bank(db_session):
    await gl_svc.seed_egypt_coa(db_session)

    await cod_svc.record_shipment(
        db_session,
        tracking_id="BST-200",
        cod_amount=Decimal("500.00"),
        delivery_fee=Decimal("30.00"),
        shipped_at=datetime(2025, 2, 1),
    )

    rows = [
        BostaRemittanceRow(
            tracking_id="BST-200",
            cod_amount=Decimal("500.00"),
            delivery_fee=Decimal("30.00"),
            delivered_at=datetime(2025, 2, 2),
            remitted_at=datetime(2025, 2, 3),
            remittance_ref="STMT-1",
            status="DELIVERED",
            raw={},
        )
    ]
    report = await cod_svc.apply_remittance_rows(db_session, rows)

    assert report["matched"] == 1
    assert report["unknown"] == 0

    entry = (
        await db_session.execute(
            select(CODLedgerEntry).where(CODLedgerEntry.tracking_id == "BST-200")
        )
    ).scalar_one()
    assert entry.status == CODStatus.DELIVERED_REMITTED
    assert entry.remittance_ref == "STMT-1"


async def test_remittance_idempotent(db_session):
    await gl_svc.seed_egypt_coa(db_session)
    await cod_svc.record_shipment(db_session, tracking_id="BST-300", cod_amount=Decimal("100"))
    row = BostaRemittanceRow(
        tracking_id="BST-300",
        cod_amount=Decimal("100"),
        delivery_fee=Decimal("0"),
        delivered_at=datetime(2025, 2, 2),
        remitted_at=datetime(2025, 2, 3),
        remittance_ref="STMT-2",
        status="DELIVERED",
        raw={},
    )
    r1 = await cod_svc.apply_remittance_rows(db_session, [row])
    r2 = await cod_svc.apply_remittance_rows(db_session, [row])
    assert r1["matched"] == 1
    assert r2["already_remitted"] == 1


async def test_void_rate(db_session):
    await gl_svc.seed_egypt_coa(db_session)
    # 8 in-transit, 2 returned → void_rate = 20%
    for i in range(8):
        await cod_svc.record_shipment(db_session, tracking_id=f"OK-{i}", cod_amount=Decimal("100"))
    for i in range(2):
        await cod_svc.record_shipment(db_session, tracking_id=f"RET-{i}", cod_amount=Decimal("100"))
        await cod_svc.mark_returned(db_session, tracking_id=f"RET-{i}")

    rate = await cod_svc.void_rate(db_session, window_days=30)
    assert rate == Decimal("0.2000")
