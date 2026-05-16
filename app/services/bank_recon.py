"""Bank reconciliation service.

Imports bank statement lines into `BankTransaction` and auto-matches them
against:

- Paymob settlement batches (by `settlement_ref` keyword in description,
  signed positive amount matching `Σ amount_net` of a settlement_ref).
- Bosta remittance deposits (by `remittance_ref` keyword in description).
- Manual / left-unmatched: status remains UNMATCHED for ops review.

The matcher does NOT post any new GL — Paymob/Bosta services already do.
It simply marks the bank line MATCHED + records `matched_type` +
`matched_doc_id` so the bank GL balance (1020) ties to the sub-ledgers.

`auto_match_unmatched` is the Celery beat entrypoint.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import NotFoundError
from app.models.payments import (
    BankAccount,
    BankTransaction,
    BankTxnMatchType,
    BankTxnStatus,
    CODLedgerEntry,
    CODStatus,
    PaymobTransaction,
    PaymobTxnStatus,
)


@dataclass(frozen=True)
class BankStatementRow:
    transaction_date: date
    amount: Decimal
    description: str | None
    external_ref: str | None
    statement_ref: str | None = None


async def get_or_create_account(
    session: AsyncSession,
    *,
    code: str,
    name: str,
    bank_name: str,
    account_number: str | None = None,
    currency: str = "EGP",
    gl_account_code: str = "1020",
) -> BankAccount:
    existing = (
        await session.execute(select(BankAccount).where(BankAccount.code == code))
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    acct = BankAccount(
        code=code,
        name=name,
        bank_name=bank_name,
        account_number=account_number,
        currency=currency,
        gl_account_code=gl_account_code,
    )
    session.add(acct)
    await session.flush()
    return acct


async def import_statement(
    session: AsyncSession,
    *,
    bank_account_id: uuid.UUID,
    rows: Iterable[BankStatementRow],
) -> dict[str, int]:
    acct = await session.get(BankAccount, bank_account_id)
    if acct is None:
        raise NotFoundError(f"Bank account not found: {bank_account_id}")

    created = 0
    skipped = 0
    for row in rows:
        if row.external_ref:
            existing = (
                await session.execute(
                    select(BankTransaction).where(
                        BankTransaction.bank_account_id == bank_account_id,
                        BankTransaction.external_ref == row.external_ref,
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                skipped += 1
                continue
        session.add(
            BankTransaction(
                bank_account_id=bank_account_id,
                transaction_date=row.transaction_date,
                amount=row.amount,
                currency=acct.currency,
                description=row.description,
                external_ref=row.external_ref,
                statement_ref=row.statement_ref,
                status=BankTxnStatus.UNMATCHED,
            )
        )
        created += 1
    await session.flush()
    return {"created": created, "skipped": skipped}


def _q(x: Decimal) -> Decimal:
    return x.quantize(Decimal("0.0001"))


async def _match_paymob(
    session: AsyncSession, txn: BankTransaction
) -> tuple[BankTxnMatchType, uuid.UUID] | None:
    """Match by settlement_ref appearing in description; Σ amount_net == txn.amount."""
    desc = (txn.description or "").upper()
    if not desc:
        return None
    # find all distinct settlement_refs whose substring is in description
    refs = (
        await session.execute(
            select(PaymobTransaction.settlement_ref, func.sum(PaymobTransaction.amount_net))
            .where(
                PaymobTransaction.status == PaymobTxnStatus.SETTLED,
                PaymobTransaction.settlement_ref.is_not(None),
            )
            .group_by(PaymobTransaction.settlement_ref)
        )
    ).all()
    for ref, total in refs:
        if not ref:
            continue
        if ref.upper() in desc and _q(Decimal(total or 0)) == _q(Decimal(txn.amount)):
            first = (
                await session.execute(
                    select(PaymobTransaction.id)
                    .where(PaymobTransaction.settlement_ref == ref)
                    .limit(1)
                )
            ).scalar_one()
            return BankTxnMatchType.PAYMOB_SETTLEMENT, first
    return None


async def _match_bosta(
    session: AsyncSession, txn: BankTransaction
) -> tuple[BankTxnMatchType, uuid.UUID] | None:
    desc = (txn.description or "").upper()
    if not desc:
        return None
    refs = (
        await session.execute(
            select(CODLedgerEntry.remittance_ref, func.sum(CODLedgerEntry.cod_amount))
            .where(
                CODLedgerEntry.status == CODStatus.DELIVERED_REMITTED,
                CODLedgerEntry.remittance_ref.is_not(None),
            )
            .group_by(CODLedgerEntry.remittance_ref)
        )
    ).all()
    for ref, total in refs:
        if not ref:
            continue
        if ref.upper() in desc and _q(Decimal(total or 0)) == _q(Decimal(txn.amount)):
            first = (
                await session.execute(
                    select(CODLedgerEntry.id).where(CODLedgerEntry.remittance_ref == ref).limit(1)
                )
            ).scalar_one()
            return BankTxnMatchType.BOSTA_REMITTANCE, first
    return None


async def auto_match_unmatched(session: AsyncSession) -> dict[str, int]:
    """Walk UNMATCHED bank lines and try Paymob → Bosta matchers."""
    txns = list(
        (
            await session.execute(
                select(BankTransaction).where(BankTransaction.status == BankTxnStatus.UNMATCHED)
            )
        )
        .scalars()
        .all()
    )
    paymob = 0
    bosta = 0
    for txn in txns:
        result = await _match_paymob(session, txn)
        if result is None:
            result = await _match_bosta(session, txn)
        if result is None:
            continue
        match_type, doc_id = result
        txn.status = BankTxnStatus.MATCHED
        txn.matched_type = match_type
        txn.matched_doc_id = doc_id
        txn.matched_at = datetime.utcnow()
        if match_type == BankTxnMatchType.PAYMOB_SETTLEMENT:
            paymob += 1
        elif match_type == BankTxnMatchType.BOSTA_REMITTANCE:
            bosta += 1
    await session.flush()
    return {
        "scanned": len(txns),
        "matched_paymob": paymob,
        "matched_bosta": bosta,
        "unmatched": len(txns) - paymob - bosta,
    }


__all__ = [
    "BankStatementRow",
    "auto_match_unmatched",
    "get_or_create_account",
    "import_statement",
]
