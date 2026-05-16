"""Chargeback service.

`raise_chargeback` — open a dispute against a settled Paymob transaction.
   Posts: DR 1130 AR-Chargeback / CR 1020 Bank  (or CR 1110 AR-Paymob if not
   yet settled). Marks the underlying PaymobTransaction CHARGEBACK.

`resolve_chargeback` — settle as WON or LOST.
   WON  → DR 1020 Bank / CR 1130 AR-Chargeback
   LOST → DR 7010 Gateway Fees / CR 1130 AR-Chargeback
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ChargebackError, InvalidStateError, NotFoundError
from app.models.payments import (
    Chargeback,
    ChargebackStatus,
    PaymobTransaction,
    PaymobTxnStatus,
)
from app.services import gl as gl_svc

AR_CHARGEBACK_ACCOUNT = "1130"
AR_PAYMOB_ACCOUNT = "1110"
BANK_ACCOUNT_CODE = "1020"
GATEWAY_FEES_ACCOUNT = "7010"


async def raise_chargeback(
    session: AsyncSession,
    *,
    paymob_transaction_id: uuid.UUID,
    amount: Decimal,
    reason: str | None = None,
) -> Chargeback:
    if amount <= 0:
        raise ChargebackError("Chargeback amount must be positive")

    txn = await session.get(PaymobTransaction, paymob_transaction_id)
    if txn is None:
        raise NotFoundError(f"Paymob transaction not found: {paymob_transaction_id}")
    if txn.status in (PaymobTxnStatus.REFUNDED, PaymobTxnStatus.VOIDED):
        raise ChargebackError(f"Cannot raise chargeback on {txn.status} transaction")

    cb = Chargeback(
        paymob_transaction_id=txn.id,
        amount=amount,
        currency=txn.currency,
        reason=reason,
        status=ChargebackStatus.OPEN,
    )
    session.add(cb)
    await session.flush()

    # If the txn was settled, money already moved to bank → reverse from bank.
    # Otherwise it sits in AR-Paymob → reverse from there.
    settled = txn.status == PaymobTxnStatus.SETTLED and txn.posted_journal_id is not None
    credit_account = BANK_ACCOUNT_CODE if settled else AR_PAYMOB_ACCOUNT

    try:
        journal = await gl_svc.post_journal(
            session,
            source_doc_type="CHARGEBACK_RAISE",
            source_doc_id=cb.id,
            event_date=datetime.utcnow().date(),
            lines=[
                gl_svc.JournalLineSpec(
                    account_code=AR_CHARGEBACK_ACCOUNT, debit=amount, currency=txn.currency
                ),
                gl_svc.JournalLineSpec(
                    account_code=credit_account, credit=amount, currency=txn.currency
                ),
            ],
            memo=f"Chargeback raised on {txn.external_id}",
        )
        cb.raised_journal_id = journal.id
    except gl_svc.AccountNotFoundError:
        pass

    txn.status = PaymobTxnStatus.CHARGEBACK
    await session.flush()
    return cb


async def resolve_chargeback(
    session: AsyncSession,
    *,
    chargeback_id: uuid.UUID,
    outcome: ChargebackStatus,
) -> Chargeback:
    if outcome not in (ChargebackStatus.WON, ChargebackStatus.LOST, ChargebackStatus.CANCELLED):
        raise ChargebackError(f"Invalid resolution outcome: {outcome}")

    cb = await session.get(Chargeback, chargeback_id)
    if cb is None:
        raise NotFoundError(f"Chargeback not found: {chargeback_id}")
    if cb.status != ChargebackStatus.OPEN:
        raise InvalidStateError(f"Chargeback already {cb.status}")

    amount = Decimal(cb.amount)
    if outcome == ChargebackStatus.WON:
        lines = [
            gl_svc.JournalLineSpec(
                account_code=BANK_ACCOUNT_CODE, debit=amount, currency=cb.currency
            ),
            gl_svc.JournalLineSpec(
                account_code=AR_CHARGEBACK_ACCOUNT, credit=amount, currency=cb.currency
            ),
        ]
        memo = f"Chargeback won {cb.id}"
    elif outcome == ChargebackStatus.LOST:
        lines = [
            gl_svc.JournalLineSpec(
                account_code=GATEWAY_FEES_ACCOUNT, debit=amount, currency=cb.currency
            ),
            gl_svc.JournalLineSpec(
                account_code=AR_CHARGEBACK_ACCOUNT, credit=amount, currency=cb.currency
            ),
        ]
        memo = f"Chargeback lost {cb.id}"
    else:  # CANCELLED — reverse the raise
        lines = [
            gl_svc.JournalLineSpec(
                account_code=AR_PAYMOB_ACCOUNT, debit=amount, currency=cb.currency
            ),
            gl_svc.JournalLineSpec(
                account_code=AR_CHARGEBACK_ACCOUNT, credit=amount, currency=cb.currency
            ),
        ]
        memo = f"Chargeback cancelled {cb.id}"

    try:
        journal = await gl_svc.post_journal(
            session,
            source_doc_type="CHARGEBACK_RESOLVE",
            source_doc_id=cb.id,
            event_date=datetime.utcnow().date(),
            lines=lines,
            memo=memo,
        )
        cb.resolved_journal_id = journal.id
    except gl_svc.AccountNotFoundError:
        pass

    cb.status = outcome
    cb.resolved_at = datetime.utcnow()
    await session.flush()
    return cb


__all__ = [
    "AR_CHARGEBACK_ACCOUNT",
    "AR_PAYMOB_ACCOUNT",
    "BANK_ACCOUNT_CODE",
    "GATEWAY_FEES_ACCOUNT",
    "raise_chargeback",
    "resolve_chargeback",
]
