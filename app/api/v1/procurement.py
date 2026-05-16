"""Procurement endpoints: suppliers, purchase orders, goods receipts."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.users import current_active_user, current_superuser
from app.errors import NotFoundError
from app.models.procurement import (
    GoodsReceipt,
    GoodsReceiptLine,
    POLine,
    PurchaseOrder,
    Supplier,
)
from app.models.user import User
from app.schemas.v3 import (
    GoodsReceiptCreate,
    GoodsReceiptLineRead,
    GoodsReceiptRead,
    POLineRead,
    PurchaseOrderCreate,
    PurchaseOrderRead,
    SupplierCreate,
    SupplierRead,
)
from app.services import purchasing as purch_svc

router = APIRouter(tags=["procurement"])


# ----- suppliers -----


@router.get("/suppliers", response_model=list[SupplierRead])
async def list_suppliers(
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[SupplierRead]:
    rows = list((await db.execute(select(Supplier).order_by(Supplier.code))).scalars().all())
    return [SupplierRead.model_validate(r) for r in rows]


@router.post("/suppliers", response_model=SupplierRead, status_code=status.HTTP_201_CREATED)
async def create_supplier(
    payload: SupplierCreate,
    _: User = Depends(current_superuser),
    db: AsyncSession = Depends(get_db),
) -> SupplierRead:
    supplier = Supplier(**payload.model_dump())
    db.add(supplier)
    await db.flush()
    return SupplierRead.model_validate(supplier)


# ----- purchase orders -----


async def _read_po(db: AsyncSession, po: PurchaseOrder) -> PurchaseOrderRead:
    lines = list(
        (await db.execute(select(POLine).where(POLine.po_id == po.id).order_by(POLine.position)))
        .scalars()
        .all()
    )
    out = PurchaseOrderRead.model_validate(po)
    out.lines = [POLineRead.model_validate(ln) for ln in lines]
    return out


@router.get("/purchase-orders", response_model=list[PurchaseOrderRead])
async def list_pos(
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[PurchaseOrderRead]:
    rows = list(
        (
            await db.execute(
                select(PurchaseOrder).order_by(PurchaseOrder.order_date.desc()).limit(200)
            )
        )
        .scalars()
        .all()
    )
    return [await _read_po(db, po) for po in rows]


@router.get("/purchase-orders/{po_id}", response_model=PurchaseOrderRead)
async def get_po(
    po_id: uuid.UUID,
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> PurchaseOrderRead:
    po = await db.get(PurchaseOrder, po_id)
    if po is None:
        raise NotFoundError(f"PO {po_id} not found")
    return await _read_po(db, po)


@router.post(
    "/purchase-orders",
    response_model=PurchaseOrderRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_po(
    payload: PurchaseOrderCreate,
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> PurchaseOrderRead:
    po = await purch_svc.create_po(
        db,
        supplier_id=payload.supplier_id,
        warehouse_id=payload.warehouse_id,
        lines=[
            purch_svc.POLineInput(product_id=ln.product_id, qty=ln.qty, unit_price=ln.unit_price)
            for ln in payload.lines
        ],
        currency=payload.currency,
        fx_rate=payload.fx_rate,
        order_date=payload.order_date,
        expected_date=payload.expected_date,
        landed_cost_total=payload.landed_cost_total,
        notes=payload.notes,
    )
    return await _read_po(db, po)


@router.post("/purchase-orders/{po_id}/send", response_model=PurchaseOrderRead)
async def send_po(
    po_id: uuid.UUID,
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> PurchaseOrderRead:
    po = await purch_svc.send_po(db, po_id)
    return await _read_po(db, po)


# ----- goods receipts -----


async def _read_gr(db: AsyncSession, gr: GoodsReceipt) -> GoodsReceiptRead:
    lines = list(
        (await db.execute(select(GoodsReceiptLine).where(GoodsReceiptLine.gr_id == gr.id)))
        .scalars()
        .all()
    )
    out = GoodsReceiptRead.model_validate(gr)
    out.lines = [GoodsReceiptLineRead.model_validate(ln) for ln in lines]
    return out


@router.post(
    "/goods-receipts",
    response_model=GoodsReceiptRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_gr(
    payload: GoodsReceiptCreate,
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> GoodsReceiptRead:
    gr = await purch_svc.receive_po(
        db,
        po_id=payload.po_id,
        lines=[purch_svc.GRLineInput(po_line_id=ln.po_line_id, qty=ln.qty) for ln in payload.lines],
        received_at=payload.received_at,
        extra_landed_cost=payload.extra_landed_cost,
    )
    return await _read_gr(db, gr)


@router.get("/goods-receipts", response_model=list[GoodsReceiptRead])
async def list_grs(
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[GoodsReceiptRead]:
    rows = list(
        (
            await db.execute(
                select(GoodsReceipt).order_by(GoodsReceipt.received_at.desc()).limit(200)
            )
        )
        .scalars()
        .all()
    )
    return [await _read_gr(db, gr) for gr in rows]
