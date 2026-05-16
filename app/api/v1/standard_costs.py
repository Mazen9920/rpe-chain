"""Routers: standard-costs, rm-costs, mfg-fees, other-costs, costing-settings."""

from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.users import current_active_user, current_superuser
from app.crud import standard_cost as crud
from app.errors import NotFoundError
from app.models.costing import OtherCostType
from app.models.user import User
from app.schemas.standard_cost import (
    CostingSettingsRead,
    CostingSettingsUpdate,
    LockResponse,
    MfgFeeRead,
    MfgFeeUpsert,
    OtherCostRead,
    OtherCostUpsert,
    RecomputeRequest,
    RecomputeResponse,
    RmCostRead,
    RmCostUpsert,
    StandardCostRead,
)
from app.services import standard_cost as svc

router = APIRouter(tags=["costing"])


# ---------- standard-costs ----------


@router.get("/standard-costs", response_model=list[StandardCostRead])
async def list_std_costs(
    month: date | None = Query(default=None, description="First day of month (YYYY-MM-01)"),
    product_id: uuid.UUID | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[StandardCostRead]:
    rows = await crud.list_standard_costs(
        db, month_start=month, product_id=product_id, status=status_filter
    )
    return [StandardCostRead.model_validate(r) for r in rows]


@router.get("/standard-costs/{product_id}/{month}", response_model=StandardCostRead)
async def get_std_cost(
    product_id: uuid.UUID,
    month: date,
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> StandardCostRead:
    row = await crud.get_standard_cost(db, product_id, month)
    if row is None:
        raise HTTPException(status_code=404, detail="standard_cost_not_found")
    return StandardCostRead.model_validate(row)


@router.post(
    "/standard-costs/recompute",
    response_model=RecomputeResponse,
    status_code=status.HTTP_200_OK,
)
async def recompute(
    body: RecomputeRequest,
    _: User = Depends(current_superuser),
    db: AsyncSession = Depends(get_db),
) -> RecomputeResponse:
    summary = await svc.recompute_all_for_month(db, body.month_start, body.product_ids)
    return RecomputeResponse(
        month_start=date.fromisoformat(summary["month_start"]),
        count=summary["count"],
        by_status=summary["by_status"],
    )


@router.post("/standard-costs/lock", response_model=LockResponse)
async def lock(
    body: RecomputeRequest,
    _: User = Depends(current_superuser),
    db: AsyncSession = Depends(get_db),
) -> LockResponse:
    counts = await svc.lock_month(db, body.month_start)
    return LockResponse(month_start=svc.first_of_month(body.month_start), counts=counts)


@router.post("/standard-costs/unlock", response_model=LockResponse)
async def unlock(
    body: RecomputeRequest,
    force: bool = Query(default=False),
    user: User = Depends(current_superuser),
    db: AsyncSession = Depends(get_db),
) -> LockResponse:
    counts = await svc.unlock_month(db, body.month_start, force=force, actor_id=user.id)
    return LockResponse(month_start=svc.first_of_month(body.month_start), counts=counts)


# ---------- rm-costs ----------


@router.get("/rm-costs", response_model=list[RmCostRead])
async def list_rm(
    month: date | None = None,
    product_id: uuid.UUID | None = None,
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[RmCostRead]:
    rows = await crud.list_rm_costs(db, month_start=month, product_id=product_id)
    return [RmCostRead.model_validate(r) for r in rows]


@router.put("/rm-costs/{product_id}/{month}", response_model=RmCostRead)
async def put_rm(
    product_id: uuid.UUID,
    month: date,
    body: RmCostUpsert,
    _: User = Depends(current_superuser),
    db: AsyncSession = Depends(get_db),
) -> RmCostRead:
    row = await crud.upsert_rm_cost(db, product_id, month, body.model_dump(exclude_unset=True))
    return RmCostRead.model_validate(row)


# ---------- mfg-fees ----------


@router.get("/mfg-fees", response_model=list[MfgFeeRead])
async def list_fees(
    month: date | None = None,
    product_id: uuid.UUID | None = None,
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[MfgFeeRead]:
    rows = await crud.list_mfg_fees(db, month_start=month, product_id=product_id)
    return [MfgFeeRead.model_validate(r) for r in rows]


@router.put("/mfg-fees/{product_id}/{month}", response_model=MfgFeeRead)
async def put_fee(
    product_id: uuid.UUID,
    month: date,
    body: MfgFeeUpsert,
    _: User = Depends(current_superuser),
    db: AsyncSession = Depends(get_db),
) -> MfgFeeRead:
    row = await crud.upsert_mfg_fee(db, product_id, month, body.model_dump(exclude_unset=True))
    return MfgFeeRead.model_validate(row)


# ---------- other-costs ----------


@router.get("/other-costs", response_model=list[OtherCostRead])
async def list_other(
    month: date | None = None,
    product_id: uuid.UUID | None = None,
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[OtherCostRead]:
    rows = await crud.list_other_costs(db, month_start=month, product_id=product_id)
    return [OtherCostRead.model_validate(r) for r in rows]


@router.put("/other-costs/{product_id}/{month}/{cost_type}", response_model=OtherCostRead)
async def put_other(
    product_id: uuid.UUID,
    month: date,
    cost_type: OtherCostType,
    body: OtherCostUpsert,
    _: User = Depends(current_superuser),
    db: AsyncSession = Depends(get_db),
) -> OtherCostRead:
    row = await crud.upsert_other_cost(
        db, product_id, month, cost_type, body.model_dump(exclude_unset=True)
    )
    return OtherCostRead.model_validate(row)


# ---------- settings ----------


@router.get("/costing-settings", response_model=CostingSettingsRead)
async def get_settings_endpoint(
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> CostingSettingsRead:
    s = await svc.get_costing_settings(db)
    await db.commit()
    return CostingSettingsRead.model_validate(s)


@router.put("/costing-settings", response_model=CostingSettingsRead)
async def update_settings_endpoint(
    body: CostingSettingsUpdate,
    _: User = Depends(current_superuser),
    db: AsyncSession = Depends(get_db),
) -> CostingSettingsRead:
    s = await svc.get_costing_settings(db)
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is not None:
            setattr(s, k, v)
    await db.commit()
    await db.refresh(s)
    return CostingSettingsRead.model_validate(s)


# Suppress unused import warning (NotFoundError handled globally)
_ = NotFoundError
