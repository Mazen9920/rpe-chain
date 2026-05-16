"""Production order service (v0.4.1).

Lifecycle:
    DRAFT -> RELEASED -> IN_PROGRESS -> DONE -> CLOSED
                                          \\-> CANCELLED

GL flow:
    issue_materials   : DR 5015 WIP            / CR 5010 RM Inventory    (actual FIFO cost)
    complete_mo       : DR 5000 FG Inventory   / CR 5015 WIP             (qty x std unit cost)
    close_mo          : remaining WIP balance is moved to 5030 Inventory Adjustments
                        (variance = actual issued + actual labor - completed at standard)

Inventory:
    - Raw materials are consumed via FIFO (`inventory.consume_layers`).
    - FG is added to stock at the MO's standard cost via `inventory.receive`.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import InvalidStateError, NotFoundError
from app.models.costing import BillOfMaterials, BomLine
from app.models.inventory import MovementType, StockLevel, StockMovement
from app.models.manufacturing import (
    MOComponent,
    MOOperation,
    MOStatus,
    ProductionOrder,
    WorkCenter,
)
from app.models.product import Product
from app.services import gl as gl_svc
from app.services import inventory as inv_svc
from app.services import standard_cost as sc_svc

WIP_ACCOUNT = "5015"
RM_INVENTORY_ACCOUNT = "5010"
FG_INVENTORY_ACCOUNT = "5000"
INVENTORY_ADJUSTMENTS_ACCOUNT = "5030"

ZERO = Decimal("0")


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


async def _get_mo(session: AsyncSession, mo_id: uuid.UUID) -> ProductionOrder:
    mo = await session.get(ProductionOrder, mo_id)
    if mo is None:
        raise NotFoundError(f"Production order {mo_id} not found")
    return mo


async def _components(session: AsyncSession, mo_id: uuid.UUID) -> list[MOComponent]:
    stmt = select(MOComponent).where(MOComponent.mo_id == mo_id).order_by(MOComponent.position)
    return list((await session.execute(stmt)).scalars().all())


async def _next_mo_number(session: AsyncSession, today: date | None = None) -> str:
    today = today or date.today()
    prefix = f"MO{today:%Y%m}"
    stmt = (
        select(ProductionOrder.mo_number)
        .where(ProductionOrder.mo_number.like(f"{prefix}%"))
        .order_by(ProductionOrder.mo_number.desc())
        .limit(1)
    )
    last = (await session.execute(stmt)).scalar_one_or_none()
    seq = int(last[len(prefix) :]) + 1 if last else 1
    return f"{prefix}{seq:05d}"


async def _consume_one_component(
    session: AsyncSession,
    *,
    product_id: uuid.UUID,
    warehouse_id: uuid.UUID,
    qty: Decimal,
    mo_id: uuid.UUID,
) -> Decimal:
    """Deplete FIFO + decrement StockLevel + record SHIP movement. Returns avg cost."""
    avg_cost, _consumed = await inv_svc.consume_layers(
        session, product_id=product_id, warehouse_id=warehouse_id, qty=qty
    )
    level = (
        await session.execute(
            select(StockLevel).where(
                StockLevel.product_id == product_id,
                StockLevel.warehouse_id == warehouse_id,
            )
        )
    ).scalar_one()
    level.on_hand = Decimal(level.on_hand) - qty
    level.version = level.version + 1
    session.add(
        StockMovement(
            product_id=product_id,
            warehouse_id=warehouse_id,
            movement_type=MovementType.SHIP,
            qty=-qty,
            unit_cost=avg_cost,
            ref_type="MO_ISSUE",
            ref_id=mo_id,
            note=f"MO issue {mo_id}",
        )
    )
    return avg_cost


# ---------------------------------------------------------------------------
# public API
# ---------------------------------------------------------------------------


async def create_mo(
    session: AsyncSession,
    *,
    product_id: uuid.UUID,
    qty_planned: Decimal,
    warehouse_id: uuid.UUID,
    planned_start: datetime | None = None,
    planned_end: datetime | None = None,
    currency: str = "EGP",
    notes: str | None = None,
) -> ProductionOrder:
    if qty_planned <= 0:
        raise ValueError("qty_planned must be positive")

    product = await session.get(Product, product_id)
    if product is None:
        raise NotFoundError(f"Product {product_id} not found")

    # active BOM
    bom = (
        await session.execute(
            select(BillOfMaterials)
            .where(
                BillOfMaterials.product_id == product_id,
                BillOfMaterials.is_active.is_(True),
                BillOfMaterials.archived_at.is_(None),
            )
            .order_by(BillOfMaterials.version.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if bom is None:
        raise InvalidStateError(
            f"No active BOM for product {product_id}", details={"product_id": str(product_id)}
        )

    bom_lines = list(
        (
            await session.execute(
                select(BomLine).where(BomLine.bom_id == bom.id).order_by(BomLine.position)
            )
        )
        .scalars()
        .all()
    )
    if not bom_lines:
        raise InvalidStateError(f"BOM {bom.id} has no lines", details={"bom_id": str(bom.id)})

    mo = ProductionOrder(
        mo_number=await _next_mo_number(session),
        product_id=product_id,
        bom_id=bom.id,
        warehouse_id=warehouse_id,
        qty_planned=qty_planned,
        status=MOStatus.DRAFT,
        currency=currency,
        planned_start=planned_start,
        planned_end=planned_end,
        notes=notes,
    )
    session.add(mo)
    await session.flush()

    total_std = ZERO
    today = date.today()
    for line in bom_lines:
        scrap = Decimal(line.scrap_factor_pct or 0)
        qty_req = Decimal(line.qty_per) * qty_planned * (Decimal("1") + scrap)
        std_cost = await sc_svc.get_cost_for_cogs(session, line.component_product_id, today)
        std_cost = std_cost if std_cost is not None else ZERO
        comp = MOComponent(
            mo_id=mo.id,
            position=line.position,
            component_product_id=line.component_product_id,
            qty_required=qty_req,
            std_unit_cost=std_cost,
        )
        session.add(comp)
        total_std += std_cost * qty_req

    mo.total_std_cost = total_std
    mo.std_cost_per_unit = (total_std / qty_planned) if qty_planned > 0 else ZERO
    await session.flush()
    return mo


async def release_mo(session: AsyncSession, mo_id: uuid.UUID) -> ProductionOrder:
    mo = await _get_mo(session, mo_id)
    if mo.status != MOStatus.DRAFT:
        raise InvalidStateError(
            f"MO {mo.mo_number} cannot be released from status {mo.status}",
            details={"status": str(mo.status)},
        )
    components = await _components(session, mo.id)
    if not components:
        raise InvalidStateError(f"MO {mo.mo_number} has no components")
    mo.status = MOStatus.RELEASED
    await session.flush()
    return mo


async def issue_materials(
    session: AsyncSession, mo_id: uuid.UUID, *, event_date: date | None = None
) -> ProductionOrder:
    """Consume RM (FIFO) + post DR WIP / CR RM Inventory at actual cost. Idempotent."""
    mo = await _get_mo(session, mo_id)
    if mo.status not in (MOStatus.RELEASED, MOStatus.IN_PROGRESS):
        raise InvalidStateError(f"MO {mo.mo_number} cannot issue materials from status {mo.status}")
    if mo.issue_journal_id is not None:
        return mo  # idempotent: already issued

    components = await _components(session, mo.id)
    total_actual = ZERO
    for comp in components:
        outstanding = Decimal(comp.qty_required) - Decimal(comp.qty_issued)
        if outstanding <= 0:
            continue
        avg_cost = await _consume_one_component(
            session,
            product_id=comp.component_product_id,
            warehouse_id=mo.warehouse_id,
            qty=outstanding,
            mo_id=mo.id,
        )
        comp.qty_issued = Decimal(comp.qty_issued) + outstanding
        comp.actual_unit_cost = avg_cost
        total_actual += avg_cost * outstanding

    if total_actual > 0:
        try:
            journal = await gl_svc.post_journal(
                session,
                source_doc_type="MO_ISSUE",
                source_doc_id=mo.id,
                event_date=event_date or date.today(),
                lines=[
                    gl_svc.JournalLineSpec(
                        account_code=WIP_ACCOUNT, debit=total_actual, currency=mo.currency
                    ),
                    gl_svc.JournalLineSpec(
                        account_code=RM_INVENTORY_ACCOUNT,
                        credit=total_actual,
                        currency=mo.currency,
                    ),
                ],
                memo=f"MO issue {mo.mo_number}",
            )
            mo.issue_journal_id = journal.id
        except gl_svc.AccountNotFoundError:
            pass

    mo.total_actual_cost = Decimal(mo.total_actual_cost) + total_actual
    mo.status = MOStatus.IN_PROGRESS
    if mo.actual_start is None:
        mo.actual_start = datetime.utcnow()
    await session.flush()
    return mo


async def complete_mo(
    session: AsyncSession,
    mo_id: uuid.UUID,
    *,
    qty_produced: Decimal,
    event_date: date | None = None,
) -> ProductionOrder:
    """Move FG into stock at standard cost; DR FG / CR WIP."""
    mo = await _get_mo(session, mo_id)
    if mo.status != MOStatus.IN_PROGRESS:
        raise InvalidStateError(f"MO {mo.mo_number} cannot complete from status {mo.status}")
    if qty_produced <= 0:
        raise ValueError("qty_produced must be positive")

    std_unit = Decimal(mo.std_cost_per_unit)
    completion_value = std_unit * qty_produced

    # Receive FG into stock at standard cost
    await inv_svc.receive(
        session,
        product_id=mo.product_id,
        warehouse_id=mo.warehouse_id,
        qty=qty_produced,
        unit_cost=std_unit,
        currency=mo.currency,
        ref_type="MO_COMPLETE",
        ref_id=mo.id,
    )

    if completion_value > 0:
        try:
            journal = await gl_svc.post_journal(
                session,
                source_doc_type="MO_COMPLETE",
                source_doc_id=mo.id,
                event_date=event_date or date.today(),
                lines=[
                    gl_svc.JournalLineSpec(
                        account_code=FG_INVENTORY_ACCOUNT,
                        debit=completion_value,
                        currency=mo.currency,
                    ),
                    gl_svc.JournalLineSpec(
                        account_code=WIP_ACCOUNT,
                        credit=completion_value,
                        currency=mo.currency,
                    ),
                ],
                memo=f"MO completion {mo.mo_number}",
            )
            mo.completion_journal_id = journal.id
        except gl_svc.AccountNotFoundError:
            pass

    mo.qty_produced = Decimal(mo.qty_produced) + qty_produced
    mo.status = MOStatus.DONE
    mo.actual_end = datetime.utcnow()
    await session.flush()
    return mo


async def close_mo(
    session: AsyncSession, mo_id: uuid.UUID, *, event_date: date | None = None
) -> ProductionOrder:
    """Close out remaining WIP to Inventory Adjustments (variance)."""
    mo = await _get_mo(session, mo_id)
    if mo.status not in (MOStatus.DONE, MOStatus.IN_PROGRESS):
        raise InvalidStateError(f"MO {mo.mo_number} cannot close from status {mo.status}")

    completed_at_standard = Decimal(mo.std_cost_per_unit) * Decimal(mo.qty_produced)
    variance = Decimal(mo.total_actual_cost) - completed_at_standard
    mo.variance = variance

    if variance != ZERO:
        # Unfavorable (positive): DR Variance / CR WIP
        # Favorable (negative): DR WIP / CR Variance
        amount = abs(variance)
        if variance > 0:
            lines = [
                gl_svc.JournalLineSpec(
                    account_code=INVENTORY_ADJUSTMENTS_ACCOUNT,
                    debit=amount,
                    currency=mo.currency,
                ),
                gl_svc.JournalLineSpec(
                    account_code=WIP_ACCOUNT, credit=amount, currency=mo.currency
                ),
            ]
        else:
            lines = [
                gl_svc.JournalLineSpec(
                    account_code=WIP_ACCOUNT, debit=amount, currency=mo.currency
                ),
                gl_svc.JournalLineSpec(
                    account_code=INVENTORY_ADJUSTMENTS_ACCOUNT,
                    credit=amount,
                    currency=mo.currency,
                ),
            ]
        try:
            journal = await gl_svc.post_journal(
                session,
                source_doc_type="MO_VARIANCE",
                source_doc_id=mo.id,
                event_date=event_date or date.today(),
                lines=lines,
                memo=f"MO variance {mo.mo_number}",
            )
            mo.variance_journal_id = journal.id
        except gl_svc.AccountNotFoundError:
            pass

    mo.status = MOStatus.CLOSED
    await session.flush()
    return mo


async def cancel_mo(session: AsyncSession, mo_id: uuid.UUID) -> ProductionOrder:
    mo = await _get_mo(session, mo_id)
    if mo.status not in (MOStatus.DRAFT, MOStatus.RELEASED):
        raise InvalidStateError(f"MO {mo.mo_number} cannot be cancelled from status {mo.status}")
    mo.status = MOStatus.CANCELLED
    await session.flush()
    return mo


async def add_operation(
    session: AsyncSession,
    mo_id: uuid.UUID,
    *,
    work_center_id: uuid.UUID,
    sequence: int = 0,
    std_hours: Decimal = ZERO,
    description: str | None = None,
) -> MOOperation:
    mo = await _get_mo(session, mo_id)
    if mo.status not in (MOStatus.DRAFT, MOStatus.RELEASED):
        raise InvalidStateError(f"Cannot add operation to MO in status {mo.status}")
    wc = await session.get(WorkCenter, work_center_id)
    if wc is None:
        raise NotFoundError(f"Work center {work_center_id} not found")
    op = MOOperation(
        mo_id=mo.id,
        work_center_id=work_center_id,
        sequence=sequence,
        std_hours=std_hours,
        description=description,
    )
    session.add(op)
    await session.flush()
    return op


async def wip_balance(session: AsyncSession) -> Decimal:
    """Sum of WIP across all open MOs (IN_PROGRESS or DONE)."""
    stmt = select(
        func.coalesce(func.sum(ProductionOrder.total_actual_cost), Decimal("0"))
        - func.coalesce(
            func.sum(ProductionOrder.std_cost_per_unit * ProductionOrder.qty_produced),
            Decimal("0"),
        )
    ).where(ProductionOrder.status.in_([MOStatus.IN_PROGRESS, MOStatus.DONE]))
    val = (await session.execute(stmt)).scalar_one()
    return Decimal(val or 0)


async def open_mo_summary(session: AsyncSession) -> dict[str, int]:
    """Counts of MOs by open status for daily monitoring."""
    stmt = select(ProductionOrder.status, func.count(ProductionOrder.id)).group_by(
        ProductionOrder.status
    )
    out: dict[str, int] = {s.value: 0 for s in MOStatus}
    for status, count in (await session.execute(stmt)).all():
        out[str(status)] = int(count or 0)
    return out


__all__ = [
    "FG_INVENTORY_ACCOUNT",
    "INVENTORY_ADJUSTMENTS_ACCOUNT",
    "RM_INVENTORY_ACCOUNT",
    "WIP_ACCOUNT",
    "add_operation",
    "cancel_mo",
    "close_mo",
    "complete_mo",
    "create_mo",
    "issue_materials",
    "open_mo_summary",
    "release_mo",
    "wip_balance",
]
