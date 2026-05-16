"""Sales endpoints: customers, orders, state transitions, shipments."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.users import current_active_user, current_superuser
from app.errors import NotFoundError
from app.models.accounting import PendingJournalEntry
from app.models.sales import (
    Customer,
    SalesOrder,
    SalesOrderLine,
    Shipment,
    ShipmentLine,
)
from app.models.user import User
from app.schemas.v2 import (
    CustomerCreate,
    CustomerRead,
    PendingJournalRead,
    SalesOrderCreate,
    SalesOrderLineRead,
    SalesOrderRead,
    ShipmentLineRead,
    ShipmentRead,
    ShipRequest,
)
from app.services import sales as sales_svc

router = APIRouter(tags=["sales"])


# ----- customers -----


@router.get("/customers", response_model=list[CustomerRead])
async def list_customers(
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[CustomerRead]:
    rows = list((await db.execute(select(Customer))).scalars().all())
    return [CustomerRead.model_validate(r) for r in rows]


@router.post("/customers", response_model=CustomerRead, status_code=201)
async def create_customer(
    body: CustomerCreate,
    _: User = Depends(current_superuser),
    db: AsyncSession = Depends(get_db),
) -> CustomerRead:
    c = Customer(**body.model_dump())
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return CustomerRead.model_validate(c)


# ----- sales orders -----


async def _read_order(db: AsyncSession, order_id: uuid.UUID) -> SalesOrderRead:
    order = await db.get(SalesOrder, order_id)
    if order is None:
        raise NotFoundError(f"Order {order_id} not found")
    line_stmt = (
        select(SalesOrderLine)
        .where(SalesOrderLine.order_id == order_id)
        .order_by(SalesOrderLine.position)
    )
    lines = list((await db.execute(line_stmt)).scalars().all())
    payload = SalesOrderRead.model_validate(order).model_copy(
        update={"lines": [SalesOrderLineRead.model_validate(ln) for ln in lines]}
    )
    return payload


@router.get("/sales-orders", response_model=list[SalesOrderRead])
async def list_orders(
    status: str | None = Query(default=None),
    limit: int = Query(default=100, le=500),
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[SalesOrderRead]:
    stmt = select(SalesOrder).order_by(SalesOrder.created_at.desc()).limit(limit)
    if status is not None:
        stmt = stmt.where(SalesOrder.status == status)
    orders = list((await db.execute(stmt)).scalars().all())
    out: list[SalesOrderRead] = []
    for o in orders:
        out.append(await _read_order(db, o.id))
    return out


@router.get("/sales-orders/{order_id}", response_model=SalesOrderRead)
async def get_order(
    order_id: uuid.UUID,
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> SalesOrderRead:
    return await _read_order(db, order_id)


@router.post("/sales-orders", response_model=SalesOrderRead, status_code=201)
async def create_order(
    body: SalesOrderCreate,
    _: User = Depends(current_superuser),
    db: AsyncSession = Depends(get_db),
) -> SalesOrderRead:
    order = await sales_svc.create_order(
        db,
        customer_id=body.customer_id,
        warehouse_id=body.warehouse_id,
        lines=[ln.model_dump() for ln in body.lines],
        source=body.source,
        external_id=body.external_id,
        order_date=body.order_date,
        currency=body.currency,
    )
    if body.expand_bundles:
        await sales_svc.expand_bundles(db, order.id)
    await db.commit()
    return await _read_order(db, order.id)


@router.post("/sales-orders/{order_id}/confirm", response_model=SalesOrderRead)
async def confirm_order(
    order_id: uuid.UUID,
    _: User = Depends(current_superuser),
    db: AsyncSession = Depends(get_db),
) -> SalesOrderRead:
    await sales_svc.confirm(db, order_id)
    await db.commit()
    return await _read_order(db, order_id)


@router.post("/sales-orders/{order_id}/allocate", response_model=SalesOrderRead)
async def allocate_order(
    order_id: uuid.UUID,
    _: User = Depends(current_superuser),
    db: AsyncSession = Depends(get_db),
) -> SalesOrderRead:
    await sales_svc.allocate(db, order_id)
    await db.commit()
    return await _read_order(db, order_id)


@router.post("/sales-orders/{order_id}/cancel", response_model=SalesOrderRead)
async def cancel_order(
    order_id: uuid.UUID,
    _: User = Depends(current_superuser),
    db: AsyncSession = Depends(get_db),
) -> SalesOrderRead:
    await sales_svc.cancel(db, order_id)
    await db.commit()
    return await _read_order(db, order_id)


@router.post("/sales-orders/{order_id}/ship", response_model=ShipmentRead, status_code=201)
async def ship_order(
    order_id: uuid.UUID,
    body: ShipRequest,
    _: User = Depends(current_superuser),
    db: AsyncSession = Depends(get_db),
) -> ShipmentRead:
    shipment = await sales_svc.ship(
        db, order_id, carrier=body.carrier, tracking_number=body.tracking_number
    )
    await db.commit()
    line_stmt = select(ShipmentLine).where(ShipmentLine.shipment_id == shipment.id)
    lines = list((await db.execute(line_stmt)).scalars().all())
    return ShipmentRead.model_validate(shipment).model_copy(
        update={"lines": [ShipmentLineRead.model_validate(ln) for ln in lines]}
    )


# ----- shipments -----


@router.get("/shipments", response_model=list[ShipmentRead])
async def list_shipments(
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[ShipmentRead]:
    rows = list((await db.execute(select(Shipment))).scalars().all())
    out: list[ShipmentRead] = []
    for sh in rows:
        line_stmt = select(ShipmentLine).where(ShipmentLine.shipment_id == sh.id)
        lines = list((await db.execute(line_stmt)).scalars().all())
        out.append(
            ShipmentRead.model_validate(sh).model_copy(
                update={"lines": [ShipmentLineRead.model_validate(ln) for ln in lines]}
            )
        )
    return out


@router.get("/shipments/{shipment_id}", response_model=ShipmentRead)
async def get_shipment(
    shipment_id: uuid.UUID,
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> ShipmentRead:
    sh = await db.get(Shipment, shipment_id)
    if sh is None:
        raise NotFoundError(f"Shipment {shipment_id} not found")
    line_stmt = select(ShipmentLine).where(ShipmentLine.shipment_id == sh.id)
    lines = list((await db.execute(line_stmt)).scalars().all())
    return ShipmentRead.model_validate(sh).model_copy(
        update={"lines": [ShipmentLineRead.model_validate(ln) for ln in lines]}
    )


# ----- pending journals (read-only) -----


@router.get("/pending-journals", response_model=list[PendingJournalRead])
async def list_pending_journals(
    _: User = Depends(current_superuser),
    db: AsyncSession = Depends(get_db),
) -> list[PendingJournalRead]:
    rows = list((await db.execute(select(PendingJournalEntry))).scalars().all())
    return [PendingJournalRead.model_validate(r) for r in rows]
