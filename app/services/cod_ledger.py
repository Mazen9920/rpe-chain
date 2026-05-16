"""Bosta COD ledger service.

Lifecycle:
- `record_shipment` — create a COD entry when a Bosta shipment is booked.
  Posts: DR 1120 AR-Bosta / CR 1100 AR  (sub-ledger transfer).
- `mark_delivered` — flip to DELIVERED_UNREMITTED on courier event.
- `apply_remittance_rows` — when Bosta deposits COD to the bank, post:
      DR 1020 Bank / CR 1120 AR-Bosta
  per tracking_id, mark DELIVERED_REMITTED, store remittance_ref.
- `mark_returned` / `mark_voided` — handle reverse flow.
- `void_rate` — % of (RETURNED+VOIDED) over the last `window_days`.

Idempotency: each COD entry tracks a `posted_journal_id`. Remittance only
posts once per entry (guarded by `status` transition + `posted_journal_id`).
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import InvalidStateError, NotFoundError
from app.integrations.bosta.remittance_csv import BostaRemittanceRow
from app.models.payments import CODLedgerEntry, CODStatus
from app.services import gl as gl_svc

AR_BOSTA_ACCOUNT = "1120"
AR_TRADE_ACCOUNT = "1100"
BANK_ACCOUNT_CODE = "1020"
SHIPPING_EXPENSE_ACCOUNT = "6140"


async def record_shipment(
    session: AsyncSession,
    *,
    tracking_id: str,
    cod_amount: Decimal,
    delivery_fee: Decimal = Decimal("0"),
    currency: str = "EGP",
    order_id: object | None = None,
    customer_invoice_id: object | None = None,
    customer_id: object | None = None,
    shipped_at: datetime | None = None,
) -> CODLedgerEntry:
    existing = (
        await session.execute(
            select(CODLedgerEntry).where(CODLedgerEntry.tracking_id == tracking_id)
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    entry = CODLedgerEntry(
        tracking_id=tracking_id,
        order_id=order_id,
        customer_invoice_id=customer_invoice_id,
        customer_id=customer_id,
        cod_amount=cod_amount,
        delivery_fee=delivery_fee,
        currency=currency,
        status=CODStatus.IN_TRANSIT,
        shipped_at=shipped_at or datetime.utcnow(),
    )
    session.add(entry)
    await session.flush()

    if cod_amount > 0:
        try:
            journal = await gl_svc.post_journal(
                session,
                source_doc_type="BOSTA_SHIPMENT",
                source_doc_id=entry.id,
                event_date=(entry.shipped_at or datetime.utcnow()).date(),
                lines=[
                    gl_svc.JournalLineSpec(
                        account_code=AR_BOSTA_ACCOUNT, debit=cod_amount, currency=currency
                    ),
                    gl_svc.JournalLineSpec(
                        account_code=AR_TRADE_ACCOUNT, credit=cod_amount, currency=currency
                    ),
                ],
                memo=f"Bosta COD shipment {tracking_id}",
            )
            entry.posted_journal_id = journal.id
        except gl_svc.AccountNotFoundError:
            pass

    await session.flush()
    return entry


async def mark_delivered(
    session: AsyncSession, *, tracking_id: str, delivered_at: datetime | None = None
) -> CODLedgerEntry:
    entry = (
        await session.execute(
            select(CODLedgerEntry).where(CODLedgerEntry.tracking_id == tracking_id)
        )
    ).scalar_one_or_none()
    if entry is None:
        raise NotFoundError(f"COD entry not found: {tracking_id}")
    if entry.status in (CODStatus.DELIVERED_REMITTED, CODStatus.VOIDED):
        return entry
    entry.status = CODStatus.DELIVERED_UNREMITTED
    entry.delivered_at = delivered_at or datetime.utcnow()
    await session.flush()
    return entry


async def mark_returned(session: AsyncSession, *, tracking_id: str) -> CODLedgerEntry:
    entry = (
        await session.execute(
            select(CODLedgerEntry).where(CODLedgerEntry.tracking_id == tracking_id)
        )
    ).scalar_one_or_none()
    if entry is None:
        raise NotFoundError(f"COD entry not found: {tracking_id}")
    if entry.status == CODStatus.DELIVERED_REMITTED:
        raise InvalidStateError("Cannot return a remitted COD entry")
    entry.status = CODStatus.RETURNED
    return entry


async def mark_voided(session: AsyncSession, *, tracking_id: str) -> CODLedgerEntry:
    entry = (
        await session.execute(
            select(CODLedgerEntry).where(CODLedgerEntry.tracking_id == tracking_id)
        )
    ).scalar_one_or_none()
    if entry is None:
        raise NotFoundError(f"COD entry not found: {tracking_id}")
    if entry.status == CODStatus.DELIVERED_REMITTED:
        raise InvalidStateError("Cannot void a remitted COD entry")
    entry.status = CODStatus.VOIDED
    return entry


async def apply_remittance_rows(
    session: AsyncSession, rows: Iterable[BostaRemittanceRow]
) -> dict[str, int]:
    """Match each remittance row by tracking_id, post DR Bank / CR AR-Bosta."""
    matched = 0
    unknown = 0
    already = 0

    for row in rows:
        entry = (
            await session.execute(
                select(CODLedgerEntry).where(CODLedgerEntry.tracking_id == row.tracking_id)
            )
        ).scalar_one_or_none()
        if entry is None:
            unknown += 1
            continue
        if entry.status == CODStatus.DELIVERED_REMITTED:
            already += 1
            continue

        entry.remitted_at = row.remitted_at
        entry.remittance_ref = row.remittance_ref
        entry.delivered_at = entry.delivered_at or row.delivered_at
        entry.status = CODStatus.DELIVERED_REMITTED

        cod = Decimal(entry.cod_amount)
        fee = Decimal(row.delivery_fee or 0)
        specs: list[gl_svc.JournalLineSpec] = [
            gl_svc.JournalLineSpec(
                account_code=BANK_ACCOUNT_CODE,
                debit=cod - fee,
                currency=entry.currency,
            ),
        ]
        if fee > 0:
            specs.append(
                gl_svc.JournalLineSpec(
                    account_code=SHIPPING_EXPENSE_ACCOUNT,
                    debit=fee,
                    currency=entry.currency,
                )
            )
        specs.append(
            gl_svc.JournalLineSpec(
                account_code=AR_BOSTA_ACCOUNT, credit=cod, currency=entry.currency
            )
        )
        try:
            journal = await gl_svc.post_journal(
                session,
                source_doc_type="BOSTA_REMITTANCE",
                source_doc_id=entry.id,
                event_date=row.remitted_at.date(),
                lines=specs,
                memo=f"Bosta remittance {entry.tracking_id}"
                + (f" ({row.remittance_ref})" if row.remittance_ref else ""),
            )
            entry.posted_journal_id = journal.id
        except gl_svc.AccountNotFoundError:
            pass
        matched += 1

    await session.flush()
    return {"matched": matched, "unknown": unknown, "already_remitted": already}


async def void_rate(session: AsyncSession, *, window_days: int = 30) -> Decimal:
    since = date.today() - timedelta(days=window_days)
    total_stmt = select(func.count()).where(
        CODLedgerEntry.shipped_at.is_not(None),
        func.date(CODLedgerEntry.shipped_at) >= since,
    )
    void_stmt = select(func.count()).where(
        CODLedgerEntry.shipped_at.is_not(None),
        func.date(CODLedgerEntry.shipped_at) >= since,
        CODLedgerEntry.status.in_([CODStatus.RETURNED, CODStatus.VOIDED]),
    )
    total = (await session.execute(total_stmt)).scalar() or 0
    voids = (await session.execute(void_stmt)).scalar() or 0
    if total == 0:
        return Decimal("0")
    return (Decimal(voids) / Decimal(total)).quantize(Decimal("0.0001"))


__all__ = [
    "AR_BOSTA_ACCOUNT",
    "AR_TRADE_ACCOUNT",
    "BANK_ACCOUNT_CODE",
    "SHIPPING_EXPENSE_ACCOUNT",
    "apply_remittance_rows",
    "mark_delivered",
    "mark_returned",
    "mark_voided",
    "record_shipment",
    "void_rate",
]
