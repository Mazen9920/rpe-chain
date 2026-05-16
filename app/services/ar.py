"""Accounts Receivable service (v0.3.1).

- `post_invoice_for_shipment(session, shipment)` — auto-invoice on shipment:
  posts DR AR / CR Revenue, links journal back to invoice.
- `register_payment(session, *, customer_id, payment_date, amount, ...)` —
  posts DR Cash / CR AR and applies to outstanding invoices oldest-first (or specified).
- `aging_buckets(session, *, as_of, customer_id=None)` — same buckets as AP.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_EVEN, Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import InvalidStateError, NotFoundError
from app.models.ar import (
    ARPayment,
    ARPaymentApplication,
    ARPaymentMethod,
    CustomerInvoice,
    CustomerInvoiceLine,
    CustomerInvoiceStatus,
    CustomerInvoiceType,
)
from app.models.sales import Customer, SalesOrder, SalesOrderLine, Shipment, ShipmentLine
from app.services import gl as gl_svc

Q4 = Decimal("0.0001")
ZERO = Decimal("0")


def _q(x: Decimal) -> Decimal:
    return x.quantize(Q4, rounding=ROUND_HALF_EVEN)


@dataclass(frozen=True)
class InvoiceLineSpec:
    description: str
    qty: Decimal
    unit_price: Decimal
    revenue_account_code: str = "4010"
    product_id: uuid.UUID | None = None


async def _next_invoice_number(session: AsyncSession, when: date) -> str:
    prefix = f"AR{when:%Y%m}"
    stmt = (
        select(CustomerInvoice.invoice_number)
        .where(CustomerInvoice.invoice_number.like(f"{prefix}%"))
        .order_by(CustomerInvoice.invoice_number.desc())
        .limit(1)
    )
    last = (await session.execute(stmt)).scalar_one_or_none()
    seq = int(last[len(prefix) :]) + 1 if last else 1
    return f"{prefix}{seq:04d}"


async def _next_payment_number(session: AsyncSession, when: date) -> str:
    prefix = f"RC{when:%Y%m}"
    stmt = (
        select(ARPayment.payment_number)
        .where(ARPayment.payment_number.like(f"{prefix}%"))
        .order_by(ARPayment.payment_number.desc())
        .limit(1)
    )
    last = (await session.execute(stmt)).scalar_one_or_none()
    seq = int(last[len(prefix) :]) + 1 if last else 1
    return f"{prefix}{seq:04d}"


async def post_invoice(
    session: AsyncSession,
    *,
    customer_id: uuid.UUID,
    invoice_date: date,
    lines: Iterable[InvoiceLineSpec],
    order_id: uuid.UUID | None = None,
    shipment_id: uuid.UUID | None = None,
    due_date: date | None = None,
    currency: str = "EGP",
    tax: Decimal = ZERO,
    shipping: Decimal = ZERO,
    ar_account_code: str = "1100",
    memo: str | None = None,
) -> CustomerInvoice:
    """Create + post a customer invoice. Returns the persisted invoice."""
    customer = await session.get(Customer, customer_id)
    if customer is None:
        raise NotFoundError(f"Customer not found: {customer_id}")

    line_specs = list(lines)
    if not line_specs:
        raise InvalidStateError("Invoice must have at least one line")

    subtotal = sum((_q(ln.qty * ln.unit_price) for ln in line_specs), ZERO)
    total = _q(subtotal + tax + shipping)

    invoice = CustomerInvoice(
        invoice_number=await _next_invoice_number(session, invoice_date),
        invoice_type=CustomerInvoiceType.INVOICE,
        customer_id=customer_id,
        order_id=order_id,
        shipment_id=shipment_id,
        invoice_date=invoice_date,
        due_date=due_date
        or (invoice_date + timedelta(days=int(customer.payment_terms_days or 30))),
        currency=currency,
        subtotal=_q(subtotal),
        tax=_q(tax),
        shipping=_q(shipping),
        total=total,
        amount_paid=ZERO,
        ar_account_code=ar_account_code,
        status=CustomerInvoiceStatus.DRAFT,
    )
    session.add(invoice)
    await session.flush()
    for ln in line_specs:
        session.add(
            CustomerInvoiceLine(
                invoice_id=invoice.id,
                description=ln.description,
                qty=_q(ln.qty),
                unit_price=_q(ln.unit_price),
                line_total=_q(ln.qty * ln.unit_price),
                revenue_account_code=ln.revenue_account_code,
                product_id=ln.product_id,
            )
        )
    await session.flush()

    # GL: DR AR / CR Revenue (per line) / CR Tax / CR Shipping
    specs: list[gl_svc.JournalLineSpec] = [
        gl_svc.JournalLineSpec(account_code=ar_account_code, debit=total, currency=currency),
    ]
    for ln in line_specs:
        specs.append(
            gl_svc.JournalLineSpec(
                account_code=ln.revenue_account_code,
                credit=_q(ln.qty * ln.unit_price),
                currency=currency,
            )
        )
    if tax > 0:
        specs.append(gl_svc.JournalLineSpec(account_code="2050", credit=_q(tax), currency=currency))
    if shipping > 0:
        specs.append(
            gl_svc.JournalLineSpec(account_code="4020", credit=_q(shipping), currency=currency)
        )
    journal = await gl_svc.post_journal(
        session,
        source_doc_type="CUSTOMER_INVOICE",
        source_doc_id=invoice.id,
        event_date=invoice_date,
        lines=specs,
        memo=memo or f"Invoice {invoice.invoice_number}",
    )
    invoice.status = CustomerInvoiceStatus.POSTED
    invoice.posted_journal_id = journal.id
    await session.flush()
    return invoice


async def post_invoice_for_shipment(
    session: AsyncSession,
    *,
    shipment: Shipment,
    invoice_date: date | None = None,
) -> CustomerInvoice:
    """Build + post a customer invoice from a Shipment.

    Pulls unit_price from the originating SalesOrderLine. Uses each line's qty
    actually shipped. Idempotent: if an invoice already exists for this shipment,
    returns it.
    """
    existing = (
        await session.execute(
            select(CustomerInvoice).where(CustomerInvoice.shipment_id == shipment.id)
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    order = await session.get(SalesOrder, shipment.order_id)
    if order is None:
        raise NotFoundError(f"Order not found: {shipment.order_id}")

    ship_lines = list(
        (await session.execute(select(ShipmentLine).where(ShipmentLine.shipment_id == shipment.id)))
        .scalars()
        .all()
    )
    order_lines = {
        ol.id: ol
        for ol in (
            await session.execute(select(SalesOrderLine).where(SalesOrderLine.order_id == order.id))
        )
        .scalars()
        .all()
    }
    specs: list[InvoiceLineSpec] = []
    for sl in ship_lines:
        ol = order_lines.get(sl.order_line_id)
        if ol is None:
            continue
        specs.append(
            InvoiceLineSpec(
                description=f"Shipment line {sl.id}",
                qty=Decimal(sl.qty),
                unit_price=Decimal(ol.unit_price),
                product_id=sl.product_id,
            )
        )
    if not specs:
        raise InvalidStateError("No shippable lines on shipment")

    return await post_invoice(
        session,
        customer_id=order.customer_id,
        invoice_date=invoice_date or date.today(),
        lines=specs,
        order_id=order.id,
        shipment_id=shipment.id,
        currency=order.currency,
        memo=f"Auto-invoice for shipment {shipment.shipment_number}",
    )


async def register_payment(
    session: AsyncSession,
    *,
    customer_id: uuid.UUID,
    payment_date: date,
    amount: Decimal,
    method: ARPaymentMethod = ARPaymentMethod.BANK,
    cash_account_code: str = "1020",
    currency: str = "EGP",
    invoice_ids: list[uuid.UUID] | None = None,
    memo: str | None = None,
) -> ARPayment:
    """Record a customer payment. Auto-applies to oldest outstanding invoices.

    Posts DR cash_account_code / CR AR (per invoice's ar_account_code).
    """
    if amount <= 0:
        raise InvalidStateError("Payment amount must be positive")

    customer = await session.get(Customer, customer_id)
    if customer is None:
        raise NotFoundError(f"Customer not found: {customer_id}")

    if invoice_ids:
        inv_rows = list(
            (
                await session.execute(
                    select(CustomerInvoice)
                    .where(CustomerInvoice.id.in_(invoice_ids))
                    .order_by(CustomerInvoice.invoice_date)
                )
            )
            .scalars()
            .all()
        )
    else:
        inv_rows = list(
            (
                await session.execute(
                    select(CustomerInvoice)
                    .where(
                        CustomerInvoice.customer_id == customer_id,
                        CustomerInvoice.status.in_(
                            [CustomerInvoiceStatus.POSTED, CustomerInvoiceStatus.PARTIALLY_PAID]
                        ),
                    )
                    .order_by(CustomerInvoice.invoice_date)
                )
            )
            .scalars()
            .all()
        )

    payment = ARPayment(
        payment_number=await _next_payment_number(session, payment_date),
        customer_id=customer_id,
        payment_date=payment_date,
        method=method,
        cash_account_code=cash_account_code,
        amount=_q(amount),
        currency=currency,
        memo=memo,
    )
    session.add(payment)
    await session.flush()

    remaining = _q(amount)
    specs: list[gl_svc.JournalLineSpec] = [
        gl_svc.JournalLineSpec(account_code=cash_account_code, debit=_q(amount), currency=currency),
    ]
    for inv in inv_rows:
        if remaining <= 0:
            break
        outstanding = _q(Decimal(inv.total) - Decimal(inv.amount_paid))
        if outstanding <= 0:
            continue
        applied = min(remaining, outstanding)
        session.add(ARPaymentApplication(payment_id=payment.id, invoice_id=inv.id, amount=applied))
        inv.amount_paid = _q(Decimal(inv.amount_paid) + applied)
        if _q(Decimal(inv.amount_paid)) >= _q(Decimal(inv.total)):
            inv.status = CustomerInvoiceStatus.PAID
        else:
            inv.status = CustomerInvoiceStatus.PARTIALLY_PAID
        specs.append(
            gl_svc.JournalLineSpec(
                account_code=inv.ar_account_code, credit=applied, currency=currency
            )
        )
        remaining = _q(remaining - applied)

    if remaining > 0:
        # unapplied overpayment → park in AR as credit balance under same account
        specs.append(
            gl_svc.JournalLineSpec(account_code="1100", credit=remaining, currency=currency)
        )

    journal = await gl_svc.post_journal(
        session,
        source_doc_type="AR_PAYMENT",
        source_doc_id=payment.id,
        event_date=payment_date,
        lines=specs,
        memo=memo or f"Receipt {payment.payment_number}",
    )
    payment.posted_journal_id = journal.id
    await session.flush()
    return payment


async def aging_buckets(
    session: AsyncSession,
    *,
    as_of: date,
    customer_id: uuid.UUID | None = None,
) -> dict[str, Decimal]:
    """Return aging totals: current / 1_30 / 31_60 / 61_90 / 90_plus."""
    stmt = select(CustomerInvoice).where(
        CustomerInvoice.status.in_(
            [CustomerInvoiceStatus.POSTED, CustomerInvoiceStatus.PARTIALLY_PAID]
        )
    )
    if customer_id is not None:
        stmt = stmt.where(CustomerInvoice.customer_id == customer_id)
    invoices = list((await session.execute(stmt)).scalars().all())
    buckets: dict[str, Decimal] = {
        "current": ZERO,
        "1_30": ZERO,
        "31_60": ZERO,
        "61_90": ZERO,
        "90_plus": ZERO,
    }
    for inv in invoices:
        outstanding = _q(Decimal(inv.total) - Decimal(inv.amount_paid))
        if outstanding <= 0:
            continue
        due = inv.due_date or inv.invoice_date
        overdue = (as_of - due).days
        if overdue <= 0:
            buckets["current"] += outstanding
        elif overdue <= 30:
            buckets["1_30"] += outstanding
        elif overdue <= 60:
            buckets["31_60"] += outstanding
        elif overdue <= 90:
            buckets["61_90"] += outstanding
        else:
            buckets["90_plus"] += outstanding
    return {k: _q(v) for k, v in buckets.items()}


async def outstanding_total(
    session: AsyncSession, *, customer_id: uuid.UUID | None = None
) -> Decimal:
    stmt = select(
        func.coalesce(func.sum(CustomerInvoice.total - CustomerInvoice.amount_paid), 0)
    ).where(
        CustomerInvoice.status.in_(
            [CustomerInvoiceStatus.POSTED, CustomerInvoiceStatus.PARTIALLY_PAID]
        )
    )
    if customer_id is not None:
        stmt = stmt.where(CustomerInvoice.customer_id == customer_id)
    val = (await session.execute(stmt)).scalar_one()
    return _q(Decimal(val))


__all__ = [
    "InvoiceLineSpec",
    "aging_buckets",
    "outstanding_total",
    "post_invoice",
    "post_invoice_for_shipment",
    "register_payment",
]
