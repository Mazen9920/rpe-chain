"""AR endpoints: customer invoices, payments, aging."""

from __future__ import annotations

import uuid
from datetime import date as _date

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.users import current_active_user
from app.errors import NotFoundError
from app.models.ar import ARPayment, CustomerInvoice, CustomerInvoiceLine
from app.models.user import User
from app.schemas.v3_1 import (
    ARAgingRead,
    ARPaymentCreate,
    ARPaymentRead,
    CustomerInvoiceCreate,
    CustomerInvoiceLineRead,
    CustomerInvoiceRead,
)
from app.services import ar as ar_svc

router = APIRouter(tags=["ar"])


async def _read_invoice(db: AsyncSession, inv: CustomerInvoice) -> CustomerInvoiceRead:
    lines = list(
        (
            await db.execute(
                select(CustomerInvoiceLine).where(CustomerInvoiceLine.invoice_id == inv.id)
            )
        )
        .scalars()
        .all()
    )
    out = CustomerInvoiceRead.model_validate(inv)
    out.lines = [CustomerInvoiceLineRead.model_validate(ln) for ln in lines]
    return out


@router.post(
    "/customer-invoices",
    response_model=CustomerInvoiceRead,
    status_code=status.HTTP_201_CREATED,
)
async def post_invoice(
    payload: CustomerInvoiceCreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> CustomerInvoiceRead:
    specs = [
        ar_svc.InvoiceLineSpec(
            description=ln.description,
            qty=ln.qty,
            unit_price=ln.unit_price,
            revenue_account_code=ln.revenue_account_code,
            product_id=ln.product_id,
        )
        for ln in payload.lines
    ]
    inv = await ar_svc.post_invoice(
        db,
        customer_id=payload.customer_id,
        invoice_date=payload.invoice_date,
        lines=specs,
        order_id=payload.order_id,
        shipment_id=payload.shipment_id,
        due_date=payload.due_date,
        currency=payload.currency,
        tax=payload.tax,
        shipping=payload.shipping,
        ar_account_code=payload.ar_account_code,
        memo=payload.memo,
    )
    await db.commit()
    await db.refresh(inv)
    return await _read_invoice(db, inv)


@router.get("/customer-invoices", response_model=list[CustomerInvoiceRead])
async def list_invoices(
    customer_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> list[CustomerInvoiceRead]:
    stmt = select(CustomerInvoice).order_by(CustomerInvoice.invoice_date.desc())
    if customer_id is not None:
        stmt = stmt.where(CustomerInvoice.customer_id == customer_id)
    invs = list((await db.execute(stmt)).scalars().all())
    return [await _read_invoice(db, i) for i in invs]


@router.get("/customer-invoices/{invoice_id}", response_model=CustomerInvoiceRead)
async def get_invoice(
    invoice_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> CustomerInvoiceRead:
    inv = await db.get(CustomerInvoice, invoice_id)
    if inv is None:
        raise NotFoundError(f"Customer invoice not found: {invoice_id}")
    return await _read_invoice(db, inv)


@router.post("/ar-payments", response_model=ARPaymentRead, status_code=status.HTTP_201_CREATED)
async def register_payment(
    payload: ARPaymentCreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> ARPaymentRead:
    payment = await ar_svc.register_payment(
        db,
        customer_id=payload.customer_id,
        payment_date=payload.payment_date,
        amount=payload.amount,
        method=payload.method,
        cash_account_code=payload.cash_account_code,
        currency=payload.currency,
        invoice_ids=payload.invoice_ids,
        memo=payload.memo,
    )
    await db.commit()
    await db.refresh(payment)
    return ARPaymentRead.model_validate(payment)


@router.get("/ar-payments", response_model=list[ARPaymentRead])
async def list_payments(
    customer_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> list[ARPaymentRead]:
    stmt = select(ARPayment).order_by(ARPayment.payment_date.desc())
    if customer_id is not None:
        stmt = stmt.where(ARPayment.customer_id == customer_id)
    rows = list((await db.execute(stmt)).scalars().all())
    return [ARPaymentRead.model_validate(p) for p in rows]


@router.get("/ar-aging", response_model=ARAgingRead)
async def aging(
    as_of: _date | None = None,
    customer_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> ARAgingRead:
    as_of = as_of or _date.today()
    buckets = await ar_svc.aging_buckets(db, as_of=as_of, customer_id=customer_id)
    return ARAgingRead.model_validate(
        {
            "as_of": as_of,
            "current": buckets["current"],
            "1_30": buckets["1_30"],
            "31_60": buckets["31_60"],
            "61_90": buckets["61_90"],
            "90_plus": buckets["90_plus"],
        }
    )
