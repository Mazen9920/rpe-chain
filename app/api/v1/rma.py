"""RMA endpoints (v0.4.1)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.users import current_active_user
from app.models.rma import RMA, RMALine
from app.models.user import User
from app.schemas.v4_1 import (
    RMACreate,
    RMALineOut,
    RMAOut,
    RMAReceiveIn,
    RMASummary,
)
from app.services import rma as rma_svc

router = APIRouter(tags=["rma"])


@router.post(
    "/rma",
    response_model=RMAOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_rma(
    payload: RMACreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> RMAOut:
    rma = await rma_svc.create_rma(
        db,
        customer_id=payload.customer_id,
        warehouse_id=payload.warehouse_id,
        lines=[
            rma_svc.RMALineInput(
                product_id=ln.product_id,
                qty_requested=ln.qty_requested,
                original_unit_price=ln.original_unit_price,
                original_unit_cost=ln.original_unit_cost,
                disposition=ln.disposition,
            )
            for ln in payload.lines
        ],
        customer_invoice_id=payload.customer_invoice_id,
        sales_order_id=payload.sales_order_id,
        reason=payload.reason,
        refund_method=payload.refund_method,
        currency=payload.currency,
    )
    await db.commit()
    await db.refresh(rma)
    return RMAOut.model_validate(rma)


@router.get(
    "/rma",
    response_model=list[RMAOut],
)
async def list_rmas(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
    limit: int = 100,
) -> list[RMAOut]:
    rows = list(
        (await db.execute(select(RMA).order_by(RMA.created_at.desc()).limit(limit))).scalars().all()
    )
    return [RMAOut.model_validate(r) for r in rows]


@router.get(
    "/rma/{rma_id}",
    response_model=RMAOut,
)
async def get_rma(
    rma_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> RMAOut:
    rma = await rma_svc._get_rma(db, rma_id)
    return RMAOut.model_validate(rma)


@router.get(
    "/rma/{rma_id}/lines",
    response_model=list[RMALineOut],
)
async def list_rma_lines(
    rma_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> list[RMALineOut]:
    rows = list((await db.execute(select(RMALine).where(RMALine.rma_id == rma_id))).scalars().all())
    return [RMALineOut.model_validate(r) for r in rows]


@router.post("/rma/{rma_id}/authorize", response_model=RMAOut)
async def authorize_rma(
    rma_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> RMAOut:
    rma = await rma_svc.authorize_rma(db, rma_id)
    await db.commit()
    await db.refresh(rma)
    return RMAOut.model_validate(rma)


@router.post("/rma/{rma_id}/receive", response_model=RMAOut)
async def receive_rma(
    rma_id: uuid.UUID,
    payload: RMAReceiveIn,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> RMAOut:
    dispositions = (
        {d.line_id: (d.qty_restocked, d.qty_scrapped) for d in payload.dispositions}
        if payload.dispositions
        else None
    )
    rma = await rma_svc.receive_rma(db, rma_id, dispositions=dispositions)
    await db.commit()
    await db.refresh(rma)
    return RMAOut.model_validate(rma)


@router.post("/rma/{rma_id}/close", response_model=RMAOut)
async def close_rma(
    rma_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> RMAOut:
    rma = await rma_svc.close_rma(db, rma_id)
    await db.commit()
    await db.refresh(rma)
    return RMAOut.model_validate(rma)


@router.post("/rma/{rma_id}/cancel", response_model=RMAOut)
async def cancel_rma(
    rma_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> RMAOut:
    rma = await rma_svc.cancel_rma(db, rma_id)
    await db.commit()
    await db.refresh(rma)
    return RMAOut.model_validate(rma)


@router.get("/rma/summary/by-status", response_model=RMASummary)
async def rma_summary(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> RMASummary:
    counts = await rma_svc.open_rma_summary(db)
    return RMASummary(counts=counts)
