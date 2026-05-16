"""Production endpoints (v0.4.1): MOs and work centers."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.users import current_active_user
from app.models.manufacturing import MOComponent, ProductionOrder, WorkCenter
from app.models.user import User
from app.schemas.v4_1 import (
    MOCompleteIn,
    MOComponentOut,
    MOCreate,
    MOOut,
    MOSummary,
    WorkCenterCreate,
    WorkCenterOut,
)
from app.services import production as prod_svc

router = APIRouter(tags=["production"])


# ---------- Work centers ----------


@router.post(
    "/production/work-centers",
    response_model=WorkCenterOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_work_center(
    payload: WorkCenterCreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> WorkCenterOut:
    wc = WorkCenter(
        code=payload.code,
        name=payload.name,
        hourly_rate=payload.hourly_rate,
        capacity_hours_per_day=payload.capacity_hours_per_day,
    )
    db.add(wc)
    await db.commit()
    await db.refresh(wc)
    return WorkCenterOut.model_validate(wc)


@router.get(
    "/production/work-centers",
    response_model=list[WorkCenterOut],
)
async def list_work_centers(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> list[WorkCenterOut]:
    rows = list((await db.execute(select(WorkCenter).order_by(WorkCenter.code))).scalars().all())
    return [WorkCenterOut.model_validate(r) for r in rows]


# ---------- Production orders ----------


@router.post(
    "/production/orders",
    response_model=MOOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_mo(
    payload: MOCreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> MOOut:
    mo = await prod_svc.create_mo(
        db,
        product_id=payload.product_id,
        qty_planned=payload.qty_planned,
        warehouse_id=payload.warehouse_id,
        planned_start=payload.planned_start,
        planned_end=payload.planned_end,
        currency=payload.currency,
        notes=payload.notes,
    )
    await db.commit()
    await db.refresh(mo)
    return MOOut.model_validate(mo)


@router.get(
    "/production/orders",
    response_model=list[MOOut],
)
async def list_mos(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
    limit: int = 100,
) -> list[MOOut]:
    rows = list(
        (
            await db.execute(
                select(ProductionOrder).order_by(ProductionOrder.created_at.desc()).limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return [MOOut.model_validate(r) for r in rows]


@router.get(
    "/production/orders/{mo_id}",
    response_model=MOOut,
)
async def get_mo(
    mo_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> MOOut:
    mo = await prod_svc._get_mo(db, mo_id)
    return MOOut.model_validate(mo)


@router.get(
    "/production/orders/{mo_id}/components",
    response_model=list[MOComponentOut],
)
async def list_mo_components(
    mo_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> list[MOComponentOut]:
    rows = list(
        (
            await db.execute(
                select(MOComponent).where(MOComponent.mo_id == mo_id).order_by(MOComponent.position)
            )
        )
        .scalars()
        .all()
    )
    return [MOComponentOut.model_validate(r) for r in rows]


@router.post("/production/orders/{mo_id}/release", response_model=MOOut)
async def release_mo(
    mo_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> MOOut:
    mo = await prod_svc.release_mo(db, mo_id)
    await db.commit()
    await db.refresh(mo)
    return MOOut.model_validate(mo)


@router.post("/production/orders/{mo_id}/issue", response_model=MOOut)
async def issue_mo(
    mo_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> MOOut:
    mo = await prod_svc.issue_materials(db, mo_id)
    await db.commit()
    await db.refresh(mo)
    return MOOut.model_validate(mo)


@router.post("/production/orders/{mo_id}/complete", response_model=MOOut)
async def complete_mo(
    mo_id: uuid.UUID,
    payload: MOCompleteIn,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> MOOut:
    mo = await prod_svc.complete_mo(db, mo_id, qty_produced=payload.qty_produced)
    await db.commit()
    await db.refresh(mo)
    return MOOut.model_validate(mo)


@router.post("/production/orders/{mo_id}/close", response_model=MOOut)
async def close_mo(
    mo_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> MOOut:
    mo = await prod_svc.close_mo(db, mo_id)
    await db.commit()
    await db.refresh(mo)
    return MOOut.model_validate(mo)


@router.post("/production/orders/{mo_id}/cancel", response_model=MOOut)
async def cancel_mo(
    mo_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> MOOut:
    mo = await prod_svc.cancel_mo(db, mo_id)
    await db.commit()
    await db.refresh(mo)
    return MOOut.model_validate(mo)


@router.get("/production/summary", response_model=MOSummary)
async def production_summary(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> MOSummary:
    counts = await prod_svc.open_mo_summary(db)
    wip = await prod_svc.wip_balance(db)
    return MOSummary(counts=counts, wip_balance=wip)
