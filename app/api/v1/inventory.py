"""Inventory endpoints: warehouses, stock levels, movements, receive/adjust/transfer."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.users import current_active_user, current_superuser
from app.models.inventory import CostLayer, StockLevel, StockMovement, Warehouse
from app.models.user import User
from app.schemas.v2 import (
    AdjustRequest,
    CostLayerRead,
    ReceiveRequest,
    StockLevelRead,
    StockMovementRead,
    TransferRequest,
    WarehouseCreate,
    WarehouseRead,
)
from app.services import inventory as inv_svc

router = APIRouter(tags=["inventory"])


# ----- warehouses -----


@router.get("/warehouses", response_model=list[WarehouseRead])
async def list_warehouses(
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[WarehouseRead]:
    rows = list((await db.execute(select(Warehouse))).scalars().all())
    return [WarehouseRead.model_validate(r) for r in rows]


@router.post("/warehouses", response_model=WarehouseRead, status_code=201)
async def create_warehouse(
    body: WarehouseCreate,
    _: User = Depends(current_superuser),
    db: AsyncSession = Depends(get_db),
) -> WarehouseRead:
    wh = Warehouse(code=body.code, name=body.name, country=body.country, city=body.city)
    db.add(wh)
    await db.commit()
    await db.refresh(wh)
    return WarehouseRead.model_validate(wh)


# ----- stock levels / movements / layers -----


@router.get("/stock-levels", response_model=list[StockLevelRead])
async def list_levels(
    product_id: uuid.UUID | None = None,
    warehouse_id: uuid.UUID | None = None,
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[StockLevelRead]:
    stmt = select(StockLevel)
    if product_id is not None:
        stmt = stmt.where(StockLevel.product_id == product_id)
    if warehouse_id is not None:
        stmt = stmt.where(StockLevel.warehouse_id == warehouse_id)
    rows = list((await db.execute(stmt)).scalars().all())
    return [StockLevelRead.model_validate(r) for r in rows]


@router.get("/stock-movements", response_model=list[StockMovementRead])
async def list_movements(
    product_id: uuid.UUID | None = None,
    warehouse_id: uuid.UUID | None = None,
    limit: int = Query(default=200, le=1000),
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[StockMovementRead]:
    stmt = select(StockMovement).order_by(StockMovement.occurred_at.desc()).limit(limit)
    if product_id is not None:
        stmt = stmt.where(StockMovement.product_id == product_id)
    if warehouse_id is not None:
        stmt = stmt.where(StockMovement.warehouse_id == warehouse_id)
    rows = list((await db.execute(stmt)).scalars().all())
    return [StockMovementRead.model_validate(r) for r in rows]


@router.get("/cost-layers", response_model=list[CostLayerRead])
async def list_layers(
    product_id: uuid.UUID | None = None,
    warehouse_id: uuid.UUID | None = None,
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[CostLayerRead]:
    stmt = select(CostLayer).order_by(CostLayer.received_at)
    if product_id is not None:
        stmt = stmt.where(CostLayer.product_id == product_id)
    if warehouse_id is not None:
        stmt = stmt.where(CostLayer.warehouse_id == warehouse_id)
    rows = list((await db.execute(stmt)).scalars().all())
    return [CostLayerRead.model_validate(r) for r in rows]


# ----- mutations -----


@router.post("/inventory/receive", response_model=CostLayerRead, status_code=201)
async def receive(
    body: ReceiveRequest,
    _: User = Depends(current_superuser),
    db: AsyncSession = Depends(get_db),
) -> CostLayerRead:
    layer = await inv_svc.receive(
        db,
        product_id=body.product_id,
        warehouse_id=body.warehouse_id,
        qty=body.qty,
        unit_cost=body.unit_cost,
        landed_cost_per_unit=body.landed_cost_per_unit,
        currency=body.currency,
    )
    await db.commit()
    await db.refresh(layer)
    return CostLayerRead.model_validate(layer)


@router.post("/inventory/adjust", status_code=204)
async def adjust(
    body: AdjustRequest,
    _: User = Depends(current_superuser),
    db: AsyncSession = Depends(get_db),
) -> None:
    await inv_svc.adjust(
        db,
        product_id=body.product_id,
        warehouse_id=body.warehouse_id,
        delta=body.delta,
        unit_cost=body.unit_cost,
        note=body.note,
    )
    await db.commit()


@router.post("/inventory/transfer", status_code=204)
async def transfer(
    body: TransferRequest,
    _: User = Depends(current_superuser),
    db: AsyncSession = Depends(get_db),
) -> None:
    await inv_svc.transfer(
        db,
        product_id=body.product_id,
        from_warehouse_id=body.from_warehouse_id,
        to_warehouse_id=body.to_warehouse_id,
        qty=body.qty,
        note=body.note,
    )
    await db.commit()
