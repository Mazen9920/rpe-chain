"""v0.4.0 — Chargeback raise + resolve."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.integrations.paymob.settlement_csv import PaymobSettlementRow
from app.models.payments import (
    Chargeback,
    ChargebackStatus,
    PaymobTransaction,
    PaymobTxnStatus,
)
from app.services import chargebacks as cb_svc
from app.services import gl as gl_svc
from app.services import paymob_recon as paymob_svc

pytestmark = pytest.mark.asyncio


def _row(eid: str, status: str = "SETTLED") -> PaymobSettlementRow:
    return PaymobSettlementRow(
        external_id=eid,
        order_external_id=None,
        amount_gross=Decimal("1000"),
        fees=Decimal("25"),
        amount_net=Decimal("975"),
        currency="EGP",
        captured_at=datetime(2025, 4, 1),
        settled_at=datetime(2025, 4, 2),
        settlement_ref="B-1",
        payment_method="CARD",
        status=status,
        raw={},
    )


async def _seed_paymob(db) -> PaymobTransaction:
    await gl_svc.seed_egypt_coa(db)
    await paymob_svc.ingest_settlement_rows(db, [_row("TXN-CB")])
    return (
        await db.execute(select(PaymobTransaction).where(PaymobTransaction.external_id == "TXN-CB"))
    ).scalar_one()


async def test_raise_chargeback_flips_status_and_posts(db_session):
    txn = await _seed_paymob(db_session)
    assert txn.status == PaymobTxnStatus.SETTLED

    cb = await cb_svc.raise_chargeback(
        db_session,
        paymob_transaction_id=txn.id,
        amount=Decimal("1000"),
        reason="Customer dispute",
    )

    await db_session.refresh(txn)
    assert txn.status == PaymobTxnStatus.CHARGEBACK
    assert cb.status == ChargebackStatus.OPEN
    assert cb.raised_journal_id is not None


async def test_resolve_won_books_bank_recovery(db_session):
    txn = await _seed_paymob(db_session)
    cb = await cb_svc.raise_chargeback(
        db_session, paymob_transaction_id=txn.id, amount=Decimal("1000")
    )
    resolved = await cb_svc.resolve_chargeback(
        db_session, chargeback_id=cb.id, outcome=ChargebackStatus.WON
    )
    assert resolved.status == ChargebackStatus.WON
    assert resolved.resolved_journal_id is not None
    assert resolved.resolved_at is not None


async def test_resolve_lost_books_fee_expense(db_session):
    txn = await _seed_paymob(db_session)
    cb = await cb_svc.raise_chargeback(
        db_session, paymob_transaction_id=txn.id, amount=Decimal("1000")
    )
    resolved = await cb_svc.resolve_chargeback(
        db_session, chargeback_id=cb.id, outcome=ChargebackStatus.LOST
    )
    assert resolved.status == ChargebackStatus.LOST


async def test_resolve_twice_raises(db_session):
    from app.errors import InvalidStateError

    txn = await _seed_paymob(db_session)
    cb = await cb_svc.raise_chargeback(
        db_session, paymob_transaction_id=txn.id, amount=Decimal("1000")
    )
    await cb_svc.resolve_chargeback(db_session, chargeback_id=cb.id, outcome=ChargebackStatus.WON)
    with pytest.raises(InvalidStateError):
        await cb_svc.resolve_chargeback(
            db_session, chargeback_id=cb.id, outcome=ChargebackStatus.LOST
        )


async def test_chargeback_zero_amount_rejected(db_session):
    from app.errors import ChargebackError

    txn = await _seed_paymob(db_session)
    with pytest.raises(ChargebackError):
        await cb_svc.raise_chargeback(db_session, paymob_transaction_id=txn.id, amount=Decimal("0"))


async def test_list_chargebacks_query(db_session):
    txn = await _seed_paymob(db_session)
    await cb_svc.raise_chargeback(db_session, paymob_transaction_id=txn.id, amount=Decimal("500"))
    rows = list((await db_session.execute(select(Chargeback))).scalars().all())
    assert len(rows) == 1
    assert rows[0].amount == Decimal("500.0000")
