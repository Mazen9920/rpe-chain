"""v0.4.0 — Paymob settlement parser + recon service."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.integrations.paymob.settlement_csv import (
    PaymobSettlementRow,
    parse_settlement_csv,
)
from app.models.payments import (
    PaymobPaymentMethod,
    PaymobTransaction,
    PaymobTxnStatus,
)
from app.services import gl as gl_svc
from app.services import paymob_recon as paymob_svc

pytestmark = pytest.mark.asyncio


def _row(external_id: str, gross: str, fees: str, status: str = "SETTLED") -> PaymobSettlementRow:
    g = Decimal(gross)
    f = Decimal(fees)
    return PaymobSettlementRow(
        external_id=external_id,
        order_external_id=None,
        amount_gross=g,
        fees=f,
        amount_net=g - f,
        currency="EGP",
        captured_at=datetime(2025, 1, 15, 10, 0, 0),
        settled_at=datetime(2025, 1, 16, 12, 0, 0),
        settlement_ref="BATCH-001",
        payment_method="CARD",
        status=status,
        raw={"external_id": external_id},
    )


async def test_parse_settlement_csv_aliases():
    csv = (
        "transaction_id,order_id,amount,fees,settled_at,settlement_ref\n"
        "TXN-1,ORD-1,1000.00,25.50,2025-01-16,BATCH-1\n"
        "TXN-2,ORD-2,500.00,12.50,2025-01-16,BATCH-1\n"
    )
    rows = parse_settlement_csv(csv)
    assert len(rows) == 2
    assert rows[0].external_id == "TXN-1"
    assert rows[0].amount_gross == Decimal("1000.00")
    assert rows[0].fees == Decimal("25.50")
    assert rows[0].amount_net == Decimal("974.50")  # computed
    assert rows[0].settlement_ref == "BATCH-1"


async def test_ingest_creates_txns_and_posts_settlement(db_session):
    await gl_svc.seed_egypt_coa(db_session)
    rows = [_row("TXN-A", "1000.00", "25.00"), _row("TXN-B", "500.00", "12.50")]

    report = await paymob_svc.ingest_settlement_rows(db_session, rows)

    assert report["created"] == 2
    assert report["settled_posted"] == 2

    txns = list(
        (
            await db_session.execute(
                select(PaymobTransaction).order_by(PaymobTransaction.external_id)
            )
        )
        .scalars()
        .all()
    )
    assert len(txns) == 2
    assert txns[0].status == PaymobTxnStatus.SETTLED
    assert txns[0].payment_method == PaymobPaymentMethod.CARD
    assert txns[0].posted_journal_id is not None
    assert txns[0].amount_net == Decimal("975.0000")


async def test_ingest_is_idempotent(db_session):
    await gl_svc.seed_egypt_coa(db_session)
    rows = [_row("TXN-A", "1000.00", "25.00")]

    r1 = await paymob_svc.ingest_settlement_rows(db_session, rows)
    r2 = await paymob_svc.ingest_settlement_rows(db_session, rows)

    assert r1["created"] == 1
    assert r2["created"] == 0
    assert r2["updated"] == 1
    # second pass should NOT re-post journal
    assert r2["settled_posted"] == 0

    txns = list((await db_session.execute(select(PaymobTransaction))).scalars().all())
    assert len(txns) == 1


async def test_settlement_journal_balanced(db_session):
    await gl_svc.seed_egypt_coa(db_session)
    rows = [_row("TXN-A", "1000.00", "25.00")]
    await paymob_svc.ingest_settlement_rows(db_session, rows)

    txn = (
        await db_session.execute(
            select(PaymobTransaction).where(PaymobTransaction.external_id == "TXN-A")
        )
    ).scalar_one()
    assert txn.posted_journal_id is not None

    from app.models.gl import GLJournalLine

    lines = list(
        (
            await db_session.execute(
                select(GLJournalLine).where(GLJournalLine.journal_id == txn.posted_journal_id)
            )
        )
        .scalars()
        .all()
    )
    debits = sum((ln.debit for ln in lines), Decimal("0"))
    credit_total = sum((ln.credit for ln in lines), Decimal("0"))
    assert debits == credit_total == Decimal("1000.0000")


async def test_acceptance_100_txn_paymob_ar_zero(db_session):
    """Master plan §223 — 100 Paymob captures → settled → AR-Paymob outstanding == 0."""
    await gl_svc.seed_egypt_coa(db_session)
    rows = [_row(f"TXN-{i:03d}", "100.00", "2.50") for i in range(100)]
    report = await paymob_svc.ingest_settlement_rows(db_session, rows)
    assert report["created"] == 100
    assert report["settled_posted"] == 100

    outstanding = await paymob_svc.ar_paymob_outstanding(db_session)
    assert outstanding == Decimal("0")
