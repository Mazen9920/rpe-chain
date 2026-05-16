"""Purchasing service: PO lifecycle + goods receipt (lands stock with landed cost)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_EVEN, Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.errors import InvalidStateError, NotFoundError
from app.models.procurement import (
    GoodsReceipt,
    GoodsReceiptLine,
    GoodsReceiptStatus,
    POLine,
    POStatus,
    PurchaseOrder,
    Supplier,
)
from app.services import inventory as inv_svc

log = get_logger("purchasing")

Q4 = Decimal("0.0001")
ZERO = Decimal("0")


def _q(x: Decimal) -> Decimal:
    return x.quantize(Q4, rounding=ROUND_HALF_EVEN)


@dataclass(frozen=True)
class POLineInput:
    product_id: uuid.UUID
    qty: Decimal
    unit_price: Decimal


@dataclass(frozen=True)
class GRLineInput:
    po_line_id: uuid.UUID
    qty: Decimal


async def _next_po_number(session: AsyncSession) -> str:
    today = date.today()
    prefix = f"PO{today:%Y%m}"
    stmt = (
        select(PurchaseOrder.po_number)
        .where(PurchaseOrder.po_number.like(f"{prefix}%"))
        .order_by(PurchaseOrder.po_number.desc())
        .limit(1)
    )
    last = (await session.execute(stmt)).scalar_one_or_none()
    seq = int(last[len(prefix) :]) + 1 if last else 1
    return f"{prefix}{seq:04d}"


async def _next_gr_number(session: AsyncSession) -> str:
    today = date.today()
    prefix = f"GR{today:%Y%m}"
    stmt = (
        select(GoodsReceipt.gr_number)
        .where(GoodsReceipt.gr_number.like(f"{prefix}%"))
        .order_by(GoodsReceipt.gr_number.desc())
        .limit(1)
    )
    last = (await session.execute(stmt)).scalar_one_or_none()
    seq = int(last[len(prefix) :]) + 1 if last else 1
    return f"{prefix}{seq:04d}"


async def create_po(
    session: AsyncSession,
    *,
    supplier_id: uuid.UUID,
    warehouse_id: uuid.UUID,
    lines: list[POLineInput],
    currency: str = "EGP",
    fx_rate: Decimal = Decimal("1"),
    order_date: date | None = None,
    expected_date: date | None = None,
    landed_cost_total: Decimal = ZERO,
    notes: str | None = None,
) -> PurchaseOrder:
    if not lines:
        raise InvalidStateError("Cannot create PO with no lines")
    supplier = await session.get(Supplier, supplier_id)
    if supplier is None:
        raise NotFoundError(f"Supplier {supplier_id} not found")

    po = PurchaseOrder(
        po_number=await _next_po_number(session),
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        currency=currency,
        fx_rate=fx_rate,
        status=POStatus.DRAFT,
        order_date=order_date or date.today(),
        expected_date=expected_date,
        landed_cost_total=landed_cost_total,
        notes=notes,
    )
    session.add(po)
    await session.flush()
    for idx, ln in enumerate(lines):
        session.add(
            POLine(
                po_id=po.id,
                product_id=ln.product_id,
                position=idx,
                qty_ordered=ln.qty,
                unit_price=ln.unit_price,
            )
        )
    await session.flush()
    return po


async def send_po(session: AsyncSession, po_id: uuid.UUID) -> PurchaseOrder:
    po = await session.get(PurchaseOrder, po_id)
    if po is None:
        raise NotFoundError(f"PO {po_id} not found")
    if po.status != POStatus.DRAFT:
        raise InvalidStateError(f"Cannot send PO in status {po.status.value}")
    po.status = POStatus.SENT
    await session.flush()
    return po


async def receive_po(
    session: AsyncSession,
    *,
    po_id: uuid.UUID,
    lines: list[GRLineInput],
    received_at: date | None = None,
    extra_landed_cost: Decimal = ZERO,
) -> GoodsReceipt:
    """Create GR + land stock w/ FIFO cost layers.

    unit_cost = PO line price; landed cost allocated by line value.
    """
    po = await session.get(PurchaseOrder, po_id)
    if po is None:
        raise NotFoundError(f"PO {po_id} not found")
    if po.status in (POStatus.CLOSED, POStatus.CANCELLED):
        raise InvalidStateError(f"Cannot receive against PO in {po.status.value}")
    if not lines:
        raise InvalidStateError("Receipt must have at least one line")

    # Fetch PO lines
    po_lines_stmt = select(POLine).where(POLine.po_id == po.id)
    po_lines_rows = list((await session.execute(po_lines_stmt)).scalars().all())
    po_lines = {pl.id: pl for pl in po_lines_rows}

    # Validate + compute value-weights for landed-cost allocation
    receipt_specs: list[tuple[POLine, Decimal]] = []
    total_value = ZERO
    for ln in lines:
        pl = po_lines.get(ln.po_line_id)
        if pl is None:
            raise NotFoundError(f"PO line {ln.po_line_id} not on PO {po_id}")
        if ln.qty <= 0:
            raise InvalidStateError("Receipt qty must be > 0")
        remaining = Decimal(pl.qty_ordered) - Decimal(pl.qty_received)
        if ln.qty > remaining:
            raise InvalidStateError(
                f"Over-receipt for PO line {pl.id}: have {remaining}, got {ln.qty}"
            )
        value = _q(Decimal(ln.qty) * Decimal(pl.unit_price))
        receipt_specs.append((pl, value))
        total_value += value

    landed_pool = _q(extra_landed_cost or ZERO)
    gr = GoodsReceipt(
        gr_number=await _next_gr_number(session),
        po_id=po.id,
        warehouse_id=po.warehouse_id,
        received_at=received_at or date.today(),
        landed_cost_allocated=landed_pool,
        status=GoodsReceiptStatus.POSTED,
    )
    session.add(gr)
    await session.flush()

    # Allocate landed cost proportional to value
    for (pl, value), ln in zip(receipt_specs, lines, strict=True):
        share = (
            _q(landed_pool * value / total_value) if total_value > 0 and landed_pool > 0 else ZERO
        )
        landed_per_unit = _q(share / Decimal(ln.qty)) if ln.qty > 0 else ZERO
        layer = await inv_svc.receive(
            session,
            product_id=pl.product_id,
            warehouse_id=po.warehouse_id,
            qty=Decimal(ln.qty),
            unit_cost=Decimal(pl.unit_price),
            landed_cost_per_unit=landed_per_unit,
            ref_type="goods_receipt",
            ref_id=gr.id,
        )
        session.add(
            GoodsReceiptLine(
                gr_id=gr.id,
                po_line_id=pl.id,
                product_id=pl.product_id,
                qty=Decimal(ln.qty),
                unit_cost=Decimal(pl.unit_price),
                landed_per_unit=landed_per_unit,
                cost_layer_id=layer.id,
            )
        )
        pl.qty_received = Decimal(pl.qty_received) + Decimal(ln.qty)

    # Update PO status
    total_ordered = sum((Decimal(pl.qty_ordered) for pl in po_lines.values()), ZERO)
    total_received = sum((Decimal(pl.qty_received) for pl in po_lines.values()), ZERO)
    if total_received >= total_ordered:
        po.status = POStatus.RECEIVED
    elif total_received > 0:
        po.status = POStatus.PARTIAL
    await session.flush()
    return gr


async def three_way_match(
    session: AsyncSession,
    *,
    po_id: uuid.UUID,
    invoice_total: Decimal,
    tolerance: Decimal = Decimal("0.01"),
) -> tuple[bool, Decimal, Decimal]:
    """Return (ok, received_value, variance). Compares PO received value vs invoice total."""
    stmt = (
        select(func.coalesce(func.sum(GoodsReceiptLine.qty * GoodsReceiptLine.unit_cost), ZERO))
        .join(GoodsReceipt, GoodsReceipt.id == GoodsReceiptLine.gr_id)
        .where(GoodsReceipt.po_id == po_id, GoodsReceipt.status == GoodsReceiptStatus.POSTED)
    )
    received_value = Decimal((await session.execute(stmt)).scalar_one() or 0)
    variance = (invoice_total - received_value).copy_abs()
    return (variance <= tolerance, _q(received_value), _q(variance))


__all__ = [
    "GRLineInput",
    "POLineInput",
    "create_po",
    "receive_po",
    "send_po",
    "three_way_match",
]
