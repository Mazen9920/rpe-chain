"""Return Merchandise Authorization service (v0.4.1).

Lifecycle:
    REQUESTED -> AUTHORIZED -> RECEIVED -> CLOSED
                                     \\-> CANCELLED

On close, posts:
    refund         : DR 4010 Sales Revenue / CR refund_account (1020 / 1010 / 1100)
    cogs reversal  : for each restocked qty -> DR 5000 FG / CR 5400 COGS-FG at original_unit_cost
    inventory      : restocked qty added back via inventory.receive at original_unit_cost
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import InvalidStateError, NotFoundError
from app.models.rma import (
    RMA,
    RMALine,
    RMALineDisposition,
    RMARefundMethod,
    RMAStatus,
)
from app.services import gl as gl_svc
from app.services import inventory as inv_svc

SALES_REVENUE_ACCOUNT = "4010"
FG_INVENTORY_ACCOUNT = "5000"
COGS_FG_ACCOUNT = "5400"
AR_ACCOUNT = "1100"
BANK_ACCOUNT = "1020"
CASH_ACCOUNT = "1010"

ZERO = Decimal("0")


def _refund_account_for(method: RMARefundMethod) -> str:
    if method == RMARefundMethod.CASH:
        return CASH_ACCOUNT
    if method == RMARefundMethod.CREDIT_NOTE:
        return AR_ACCOUNT
    return BANK_ACCOUNT


@dataclass(frozen=True)
class RMALineInput:
    product_id: uuid.UUID
    qty_requested: Decimal
    original_unit_price: Decimal
    original_unit_cost: Decimal = ZERO
    disposition: RMALineDisposition = RMALineDisposition.RESTOCK


async def _get_rma(session: AsyncSession, rma_id: uuid.UUID) -> RMA:
    rma = await session.get(RMA, rma_id)
    if rma is None:
        raise NotFoundError(f"RMA {rma_id} not found")
    return rma


async def _lines(session: AsyncSession, rma_id: uuid.UUID) -> list[RMALine]:
    return list(
        (await session.execute(select(RMALine).where(RMALine.rma_id == rma_id))).scalars().all()
    )


async def _next_rma_number(session: AsyncSession, today: date | None = None) -> str:
    today = today or date.today()
    prefix = f"RMA{today:%Y%m}"
    stmt = (
        select(RMA.rma_number)
        .where(RMA.rma_number.like(f"{prefix}%"))
        .order_by(RMA.rma_number.desc())
        .limit(1)
    )
    last = (await session.execute(stmt)).scalar_one_or_none()
    seq = int(last[len(prefix) :]) + 1 if last else 1
    return f"{prefix}{seq:05d}"


async def create_rma(
    session: AsyncSession,
    *,
    customer_id: uuid.UUID,
    warehouse_id: uuid.UUID,
    lines: Iterable[RMALineInput],
    customer_invoice_id: uuid.UUID | None = None,
    sales_order_id: uuid.UUID | None = None,
    reason: str | None = None,
    refund_method: RMARefundMethod = RMARefundMethod.BANK,
    currency: str = "EGP",
) -> RMA:
    line_list = list(lines)
    if not line_list:
        raise ValueError("RMA must have at least one line")

    rma = RMA(
        rma_number=await _next_rma_number(session),
        customer_id=customer_id,
        customer_invoice_id=customer_invoice_id,
        sales_order_id=sales_order_id,
        warehouse_id=warehouse_id,
        status=RMAStatus.REQUESTED,
        reason=reason,
        refund_method=refund_method,
        refund_account_code=_refund_account_for(refund_method),
        currency=currency,
        requested_at=date.today(),
    )
    session.add(rma)
    await session.flush()

    total_refund = ZERO
    for inp in line_list:
        if inp.qty_requested <= 0:
            raise ValueError("qty_requested must be positive")
        session.add(
            RMALine(
                rma_id=rma.id,
                product_id=inp.product_id,
                qty_requested=inp.qty_requested,
                original_unit_price=inp.original_unit_price,
                original_unit_cost=inp.original_unit_cost,
                disposition=inp.disposition,
            )
        )
        total_refund += Decimal(inp.original_unit_price) * Decimal(inp.qty_requested)

    rma.total_refund_amount = total_refund
    await session.flush()
    return rma


async def authorize_rma(session: AsyncSession, rma_id: uuid.UUID) -> RMA:
    rma = await _get_rma(session, rma_id)
    if rma.status != RMAStatus.REQUESTED:
        raise InvalidStateError(
            f"RMA {rma.rma_number} cannot be authorized from status {rma.status}"
        )
    rma.status = RMAStatus.AUTHORIZED
    rma.authorized_at = datetime.utcnow()
    await session.flush()
    return rma


async def receive_rma(
    session: AsyncSession,
    rma_id: uuid.UUID,
    *,
    dispositions: dict[uuid.UUID, tuple[Decimal, Decimal]] | None = None,
) -> RMA:
    """Mark goods received. `dispositions` maps line_id -> (qty_restocked, qty_scrapped).

    If not provided, qty_received = qty_requested with disposition default per line.
    """
    rma = await _get_rma(session, rma_id)
    if rma.status != RMAStatus.AUTHORIZED:
        raise InvalidStateError(f"RMA {rma.rma_number} cannot receive from status {rma.status}")
    lines = await _lines(session, rma.id)
    for ln in lines:
        if dispositions and ln.id in dispositions:
            restocked, scrapped = dispositions[ln.id]
        elif ln.disposition == RMALineDisposition.SCRAP:
            restocked, scrapped = ZERO, Decimal(ln.qty_requested)
        else:
            restocked, scrapped = Decimal(ln.qty_requested), ZERO
        if restocked < 0 or scrapped < 0:
            raise ValueError("disposition qtys must be non-negative")
        if restocked + scrapped > Decimal(ln.qty_requested):
            raise InvalidStateError(
                f"received qty exceeds requested for line {ln.id}",
                details={"line_id": str(ln.id)},
            )
        ln.qty_received = restocked + scrapped
        ln.qty_restocked = restocked
        ln.qty_scrapped = scrapped

    rma.status = RMAStatus.RECEIVED
    rma.received_at = datetime.utcnow()
    await session.flush()
    return rma


async def close_rma(
    session: AsyncSession, rma_id: uuid.UUID, *, event_date: date | None = None
) -> RMA:
    """Post refund + COGS reversal journals, restock inventory, close RMA."""
    rma = await _get_rma(session, rma_id)
    if rma.status != RMAStatus.RECEIVED:
        raise InvalidStateError(f"RMA {rma.rma_number} cannot be closed from status {rma.status}")

    lines = await _lines(session, rma.id)

    # Refund journal: DR 4010 Sales Revenue / CR refund_account
    if Decimal(rma.total_refund_amount) > 0 and rma.refund_journal_id is None:
        try:
            journal = await gl_svc.post_journal(
                session,
                source_doc_type="RMA_REFUND",
                source_doc_id=rma.id,
                event_date=event_date or date.today(),
                lines=[
                    gl_svc.JournalLineSpec(
                        account_code=SALES_REVENUE_ACCOUNT,
                        debit=Decimal(rma.total_refund_amount),
                        currency=rma.currency,
                    ),
                    gl_svc.JournalLineSpec(
                        account_code=rma.refund_account_code,
                        credit=Decimal(rma.total_refund_amount),
                        currency=rma.currency,
                    ),
                ],
                memo=f"RMA refund {rma.rma_number}",
            )
            rma.refund_journal_id = journal.id
        except gl_svc.AccountNotFoundError:
            pass

    # COGS reversal + restock: for each restocked qty, receive into stock and post journal
    cogs_reversal_total = ZERO
    for ln in lines:
        restocked = Decimal(ln.qty_restocked)
        if restocked <= 0:
            continue
        unit_cost = Decimal(ln.original_unit_cost)
        await inv_svc.receive(
            session,
            product_id=ln.product_id,
            warehouse_id=rma.warehouse_id,
            qty=restocked,
            unit_cost=unit_cost,
            currency=rma.currency,
            ref_type="RMA_RESTOCK",
            ref_id=rma.id,
        )
        cogs_reversal_total += unit_cost * restocked

    if cogs_reversal_total > 0 and rma.cogs_reversal_journal_id is None:
        try:
            journal = await gl_svc.post_journal(
                session,
                source_doc_type="RMA_COGS_REVERSAL",
                source_doc_id=rma.id,
                event_date=event_date or date.today(),
                lines=[
                    gl_svc.JournalLineSpec(
                        account_code=FG_INVENTORY_ACCOUNT,
                        debit=cogs_reversal_total,
                        currency=rma.currency,
                    ),
                    gl_svc.JournalLineSpec(
                        account_code=COGS_FG_ACCOUNT,
                        credit=cogs_reversal_total,
                        currency=rma.currency,
                    ),
                ],
                memo=f"RMA COGS reversal {rma.rma_number}",
            )
            rma.cogs_reversal_journal_id = journal.id
        except gl_svc.AccountNotFoundError:
            pass

    rma.status = RMAStatus.CLOSED
    rma.closed_at = datetime.utcnow()
    await session.flush()
    return rma


async def cancel_rma(session: AsyncSession, rma_id: uuid.UUID) -> RMA:
    rma = await _get_rma(session, rma_id)
    if rma.status not in (RMAStatus.REQUESTED, RMAStatus.AUTHORIZED):
        raise InvalidStateError(
            f"RMA {rma.rma_number} cannot be cancelled from status {rma.status}"
        )
    rma.status = RMAStatus.CANCELLED
    await session.flush()
    return rma


async def open_rma_summary(session: AsyncSession) -> dict[str, int]:
    stmt = select(RMA.status, func.count(RMA.id)).group_by(RMA.status)
    out: dict[str, int] = {s.value: 0 for s in RMAStatus}
    for status, count in (await session.execute(stmt)).all():
        out[str(status)] = int(count or 0)
    return out


__all__ = [
    "AR_ACCOUNT",
    "BANK_ACCOUNT",
    "CASH_ACCOUNT",
    "COGS_FG_ACCOUNT",
    "FG_INVENTORY_ACCOUNT",
    "SALES_REVENUE_ACCOUNT",
    "RMALineInput",
    "authorize_rma",
    "cancel_rma",
    "close_rma",
    "create_rma",
    "open_rma_summary",
    "receive_rma",
]
