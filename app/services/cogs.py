"""COGS service: cost selector (std → FIFO), pending journal posting.

Account codes are symbolic strings; v0.3.0 GL service maps them to real accounts.
"""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from decimal import ROUND_HALF_EVEN, Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import CogsCostUnavailableError
from app.models.accounting import (
    PendingJournalEntry,
    PendingJournalLine,
    PendingJournalStatus,
)
from app.models.inventory import CostLayer, CostLayerStatus
from app.models.product import Product, ProductType
from app.models.sales import Shipment, ShipmentLine
from app.services.standard_cost import get_cost_for_cogs

Q4 = Decimal("0.0001")
ZERO = Decimal("0")


def _q(x: Decimal) -> Decimal:
    return x.quantize(Q4, rounding=ROUND_HALF_EVEN)


class AccountCode(enum.StrEnum):
    """Symbolic account codes for pending journals (v0.3.0 GL resolves to real accounts)."""

    COGS_FG = "COGS_FG"
    COGS_RM = "COGS_RM"
    INV_FG = "INV_FG"
    INV_RM = "INV_RM"
    INV_PACK = "INV_PACK"


def _inventory_account_for(product: Product) -> AccountCode:
    if product.product_type == ProductType.RAW:
        return AccountCode.INV_RM
    if product.product_type == ProductType.PACKAGING:
        return AccountCode.INV_PACK
    return AccountCode.INV_FG


def _cogs_account_for(product: Product) -> AccountCode:
    if product.product_type in (ProductType.RAW, ProductType.PACKAGING):
        return AccountCode.COGS_RM
    return AccountCode.COGS_FG


async def unit_cost_for_line(
    session: AsyncSession,
    *,
    product: Product,
    warehouse_id: uuid.UUID,
    when: date,
) -> tuple[Decimal, str]:
    """Return (unit_cost, source) where source ∈ {'standard','fifo'}.

    Raises CogsCostUnavailableError if neither source yields a cost.
    """
    std = await get_cost_for_cogs(session, product.id, when)
    if std is not None and std > 0:
        return _q(std), "standard"

    # FIFO fallback: weighted-avg of ACTIVE layers
    stmt = (
        select(CostLayer)
        .where(
            CostLayer.product_id == product.id,
            CostLayer.warehouse_id == warehouse_id,
            CostLayer.status == CostLayerStatus.ACTIVE,
            CostLayer.qty_remaining > 0,
        )
        .order_by(CostLayer.received_at, CostLayer.id)
    )
    layers = list((await session.execute(stmt)).scalars().all())
    if not layers:
        raise CogsCostUnavailableError(
            f"No std cost and no FIFO layers for product {product.sku} @ {warehouse_id}",
            details={"product_id": str(product.id), "warehouse_id": str(warehouse_id)},
        )
    total_qty = sum((Decimal(ln.qty_remaining) for ln in layers), ZERO)
    total_cost = sum(
        (
            Decimal(ln.qty_remaining) * (Decimal(ln.unit_cost) + Decimal(ln.landed_cost_per_unit))
            for ln in layers
        ),
        ZERO,
    )
    if total_qty <= 0:
        raise CogsCostUnavailableError(
            f"FIFO layers empty for product {product.sku}",
            details={"product_id": str(product.id)},
        )
    return _q(total_cost / total_qty), "fifo"


async def post_for_shipment(
    session: AsyncSession,
    *,
    shipment: Shipment,
    lines: list[ShipmentLine],
    products_by_id: dict[uuid.UUID, Product],
    event_date: date,
    currency: str = "EGP",
) -> PendingJournalEntry:
    """Append a balanced PENDING journal for a shipment's COGS impact.

    For each ShipmentLine: DR COGS_* qty*unit_cost, CR INV_* qty*unit_cost.
    """
    entry = PendingJournalEntry(
        source_doc_type="SHIPMENT",
        source_doc_id=shipment.id,
        event_date=event_date,
        currency=currency,
        memo=f"COGS for shipment {shipment.shipment_number}",
        status=PendingJournalStatus.PENDING,
    )
    session.add(entry)
    await session.flush()

    for sl in lines:
        product = products_by_id[sl.product_id]
        amount = _q(Decimal(sl.qty) * Decimal(sl.unit_cost))
        if amount <= 0:
            continue
        session.add(
            PendingJournalLine(
                entry_id=entry.id,
                account_code=_cogs_account_for(product).value,
                debit=amount,
                credit=ZERO,
                currency=currency,
                dimensions={
                    "product_id": str(product.id),
                    "sku": product.sku,
                    "warehouse_id": str(shipment.warehouse_id),
                    "shipment_id": str(shipment.id),
                },
            )
        )
        session.add(
            PendingJournalLine(
                entry_id=entry.id,
                account_code=_inventory_account_for(product).value,
                debit=ZERO,
                credit=amount,
                currency=currency,
                dimensions={
                    "product_id": str(product.id),
                    "sku": product.sku,
                    "warehouse_id": str(shipment.warehouse_id),
                    "shipment_id": str(shipment.id),
                },
            )
        )
    entry.posted_at = datetime.utcnow()
    await session.flush()
    return entry


__all__ = [
    "AccountCode",
    "post_for_shipment",
    "unit_cost_for_line",
]
