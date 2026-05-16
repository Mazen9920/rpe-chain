"""AP endpoints: supplier invoices, payments, aging."""

from __future__ import annotations

import uuid
from datetime import date as _date

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.users import current_active_user
from app.errors import NotFoundError
from app.models.procurement import APPayment, SupplierInvoice, SupplierInvoiceLine
from app.models.user import User
from app.schemas.v3 import (
    AgingBucketsRead,
    APPaymentCreate,
    APPaymentRead,
    SupplierInvoiceCreate,
    SupplierInvoiceLineRead,
    SupplierInvoiceRead,
)
from app.services import ap as ap_svc

router = APIRouter(tags=["ap"])


async def _read_invoice(db: AsyncSession, inv: SupplierInvoice) -> SupplierInvoiceRead:
    lines = list(
        (
            await db.execute(
                select(SupplierInvoiceLine).where(SupplierInvoiceLine.invoice_id == inv.id)
            )
        )
        .scalars()
        .all()
    )
    out = SupplierInvoiceRead.model_validate(inv)
    out.lines = [SupplierInvoiceLineRead.model_validate(ln) for ln in lines]
    return out


@router.get("/supplier-invoices", response_model=list[SupplierInvoiceRead])
async def list_invoices(
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[SupplierInvoiceRead]:
    rows = list(
        (
            await db.execute(
                select(SupplierInvoice).order_by(SupplierInvoice.invoice_date.desc()).limit(200)
            )
        )
        .scalars()
        .all()
    )
    return [await _read_invoice(db, inv) for inv in rows]


@router.get("/supplier-invoices/{invoice_id}", response_model=SupplierInvoiceRead)
async def get_invoice(
    invoice_id: uuid.UUID,
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> SupplierInvoiceRead:
    inv = await db.get(SupplierInvoice, invoice_id)
    if inv is None:
        raise NotFoundError(f"Invoice {invoice_id} not found")
    return await _read_invoice(db, inv)


@router.post(
    "/supplier-invoices",
    response_model=SupplierInvoiceRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_invoice(
    payload: SupplierInvoiceCreate,
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> SupplierInvoiceRead:
    inv = await ap_svc.register_invoice(
        db,
        supplier_id=payload.supplier_id,
        invoice_number=payload.invoice_number,
        invoice_date=payload.invoice_date,
        lines=[
            ap_svc.InvoiceLineInput(
                description=ln.description,
                account_code=ln.account_code,
                qty=ln.qty,
                unit_price=ln.unit_price,
                po_line_id=ln.po_line_id,
            )
            for ln in payload.lines
        ],
        tax=payload.tax,
        po_id=payload.po_id,
        currency=payload.currency,
        fx_rate=payload.fx_rate,
        due_date=payload.due_date,
    )
    return await _read_invoice(db, inv)


@router.post("/ap-payments", response_model=APPaymentRead, status_code=status.HTTP_201_CREATED)
async def pay_invoice(
    payload: APPaymentCreate,
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> APPaymentRead:
    pay = await ap_svc.pay_invoice(
        db,
        invoice_id=payload.invoice_id,
        payment_date=payload.payment_date,
        amount=payload.amount,
        cash_account_code=payload.cash_account_code,
        method=payload.method,
        note=payload.note,
    )
    return APPaymentRead.model_validate(pay)


@router.get("/ap-payments", response_model=list[APPaymentRead])
async def list_payments(
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[APPaymentRead]:
    rows = list(
        (await db.execute(select(APPayment).order_by(APPayment.payment_date.desc()).limit(200)))
        .scalars()
        .all()
    )
    return [APPaymentRead.model_validate(r) for r in rows]


@router.get("/ap/aging", response_model=AgingBucketsRead)
async def ap_aging(
    as_of: _date,
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> AgingBucketsRead:
    b = await ap_svc.aging_buckets(db, as_of=as_of)
    return AgingBucketsRead(
        current=b["current"],
        bucket_1_30=b["1_30"],
        bucket_31_60=b["31_60"],
        bucket_61_90=b["61_90"],
        bucket_90_plus=b["90_plus"],
    )
