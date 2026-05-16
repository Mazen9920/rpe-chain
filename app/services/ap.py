"""AP service: supplier invoice posting, payment matching, aging."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_EVEN, Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.errors import InvalidStateError, NotFoundError
from app.models.procurement import (
    APPayment,
    APPaymentApplication,
    PaymentMethod,
    Supplier,
    SupplierInvoice,
    SupplierInvoiceLine,
    SupplierInvoiceStatus,
)
from app.services.gl import JournalLineSpec, post_journal

log = get_logger("ap")

Q4 = Decimal("0.0001")
ZERO = Decimal("0")


def _q(x: Decimal) -> Decimal:
    return x.quantize(Q4, rounding=ROUND_HALF_EVEN)


@dataclass(frozen=True)
class InvoiceLineInput:
    description: str
    account_code: str  # GL expense/asset account
    qty: Decimal
    unit_price: Decimal
    po_line_id: uuid.UUID | None = None


async def _next_payment_number(session: AsyncSession) -> str:
    today = date.today()
    prefix = f"AP{today:%Y%m}"
    stmt = (
        select(APPayment.payment_number)
        .where(APPayment.payment_number.like(f"{prefix}%"))
        .order_by(APPayment.payment_number.desc())
        .limit(1)
    )
    last = (await session.execute(stmt)).scalar_one_or_none()
    seq = int(last[len(prefix) :]) + 1 if last else 1
    return f"{prefix}{seq:04d}"


async def register_invoice(
    session: AsyncSession,
    *,
    supplier_id: uuid.UUID,
    invoice_number: str,
    invoice_date: date,
    lines: list[InvoiceLineInput],
    tax: Decimal = ZERO,
    po_id: uuid.UUID | None = None,
    currency: str | None = None,
    fx_rate: Decimal = Decimal("1"),
    due_date: date | None = None,
) -> SupplierInvoice:
    """Create + post supplier invoice. Posts journal: DR expense/inventory accounts, CR AP."""
    supplier = await session.get(Supplier, supplier_id)
    if supplier is None:
        raise NotFoundError(f"Supplier {supplier_id} not found")
    if not lines:
        raise InvalidStateError("Invoice must have at least one line")
    ccy = currency or supplier.currency
    ap_account = supplier.ap_account_code or "2010"

    subtotal = _q(sum((Decimal(ln.qty) * Decimal(ln.unit_price) for ln in lines), ZERO))
    total = _q(subtotal + Decimal(tax))
    due = due_date or (invoice_date + timedelta(days=supplier.payment_terms_days))

    inv = SupplierInvoice(
        invoice_number=invoice_number,
        supplier_id=supplier_id,
        po_id=po_id,
        currency=ccy,
        fx_rate=fx_rate,
        invoice_date=invoice_date,
        due_date=due,
        subtotal=subtotal,
        tax=Decimal(tax),
        total=total,
        amount_paid=ZERO,
        status=SupplierInvoiceStatus.POSTED,
    )
    session.add(inv)
    await session.flush()
    for ln in lines:
        amount = _q(Decimal(ln.qty) * Decimal(ln.unit_price))
        session.add(
            SupplierInvoiceLine(
                invoice_id=inv.id,
                po_line_id=ln.po_line_id,
                description=ln.description,
                account_code=ln.account_code,
                qty=Decimal(ln.qty),
                unit_price=Decimal(ln.unit_price),
                amount=amount,
            )
        )

    # journal: DR expense/asset accounts (+tax) / CR AP
    specs: list[JournalLineSpec] = []
    for ln in lines:
        amount = _q(Decimal(ln.qty) * Decimal(ln.unit_price))
        if amount <= 0:
            continue
        specs.append(
            JournalLineSpec(
                account_code=ln.account_code,
                debit=amount,
                currency=ccy,
                fx_rate=fx_rate,
                dimensions={
                    "supplier_id": str(supplier_id),
                    "invoice_id": str(inv.id),
                    "invoice_number": invoice_number,
                },
            )
        )
    if Decimal(tax) > 0:
        # Input VAT debited to 2050 (nets against output tax in same account)
        specs.append(
            JournalLineSpec(
                account_code="2050",
                debit=Decimal(tax),
                currency=ccy,
                fx_rate=fx_rate,
            )
        )
    specs.append(
        JournalLineSpec(
            account_code=ap_account,
            credit=total,
            currency=ccy,
            fx_rate=fx_rate,
            dimensions={
                "supplier_id": str(supplier_id),
                "invoice_id": str(inv.id),
                "invoice_number": invoice_number,
            },
        )
    )
    journal = await post_journal(
        session,
        source_doc_type="SUPPLIER_INVOICE",
        source_doc_id=inv.id,
        event_date=invoice_date,
        lines=specs,
        memo=f"Supplier invoice {invoice_number}",
    )
    inv.posted_journal_id = journal.id

    # mark PO line invoiced if linked
    from app.models.procurement import POLine

    for ln in lines:
        if ln.po_line_id:
            pol = await session.get(POLine, ln.po_line_id)
            if pol is not None:
                pol.qty_invoiced = Decimal(pol.qty_invoiced) + Decimal(ln.qty)

    await session.flush()
    return inv


async def pay_invoice(
    session: AsyncSession,
    *,
    invoice_id: uuid.UUID,
    payment_date: date,
    amount: Decimal,
    cash_account_code: str = "1020",
    method: PaymentMethod = PaymentMethod.BANK,
    note: str | None = None,
) -> APPayment:
    """Pay (full or partial) a supplier invoice. Posts journal: DR AP / CR Cash."""
    inv = await session.get(SupplierInvoice, invoice_id)
    if inv is None:
        raise NotFoundError(f"Invoice {invoice_id} not found")
    if inv.status in (SupplierInvoiceStatus.PAID, SupplierInvoiceStatus.VOID):
        raise InvalidStateError(f"Cannot pay invoice in {inv.status.value}")
    outstanding = Decimal(inv.total) - Decimal(inv.amount_paid)
    if amount <= 0 or amount > outstanding:
        raise InvalidStateError(f"Invalid payment amount {amount}; outstanding={outstanding}")

    supplier = await session.get(Supplier, inv.supplier_id)
    assert supplier is not None
    ap_account = supplier.ap_account_code or "2010"

    pay = APPayment(
        payment_number=await _next_payment_number(session),
        supplier_id=inv.supplier_id,
        payment_date=payment_date,
        method=method,
        currency=inv.currency,
        fx_rate=inv.fx_rate,
        amount=Decimal(amount),
        cash_account_code=cash_account_code,
        note=note,
    )
    session.add(pay)
    await session.flush()
    session.add(
        APPaymentApplication(payment_id=pay.id, invoice_id=inv.id, amount_applied=Decimal(amount))
    )

    journal = await post_journal(
        session,
        source_doc_type="AP_PAYMENT",
        source_doc_id=pay.id,
        event_date=payment_date,
        lines=[
            JournalLineSpec(
                account_code=ap_account,
                debit=Decimal(amount),
                currency=inv.currency,
                fx_rate=inv.fx_rate,
                dimensions={"invoice_id": str(inv.id)},
            ),
            JournalLineSpec(
                account_code=cash_account_code,
                credit=Decimal(amount),
                currency=inv.currency,
                fx_rate=inv.fx_rate,
            ),
        ],
        memo=f"Payment {pay.payment_number} for invoice {inv.invoice_number}",
    )
    pay.posted_journal_id = journal.id
    inv.amount_paid = Decimal(inv.amount_paid) + Decimal(amount)
    if inv.amount_paid >= Decimal(inv.total):
        inv.status = SupplierInvoiceStatus.PAID
    else:
        inv.status = SupplierInvoiceStatus.PARTIALLY_PAID
    await session.flush()
    return pay


async def aging_buckets(session: AsyncSession, *, as_of: date) -> dict[str, Decimal]:
    """Return outstanding AP grouped by buckets (current, 1-30, 31-60, 61-90, 90+)."""
    stmt = select(SupplierInvoice).where(
        SupplierInvoice.status.in_(
            (SupplierInvoiceStatus.POSTED, SupplierInvoiceStatus.PARTIALLY_PAID)
        )
    )
    buckets = {"current": ZERO, "1_30": ZERO, "31_60": ZERO, "61_90": ZERO, "90_plus": ZERO}
    for inv in (await session.execute(stmt)).scalars().all():
        outstanding = Decimal(inv.total) - Decimal(inv.amount_paid)
        if outstanding <= 0:
            continue
        days = (as_of - inv.due_date).days
        if days <= 0:
            buckets["current"] += outstanding
        elif days <= 30:
            buckets["1_30"] += outstanding
        elif days <= 60:
            buckets["31_60"] += outstanding
        elif days <= 90:
            buckets["61_90"] += outstanding
        else:
            buckets["90_plus"] += outstanding
    return {k: _q(v) for k, v in buckets.items()}


__all__ = [
    "InvoiceLineInput",
    "aging_buckets",
    "pay_invoice",
    "register_invoice",
]
