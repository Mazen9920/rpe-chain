"""Schemas for v0.4.1 — production orders + RMA."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from app.models.manufacturing import MOStatus
from app.models.rma import RMALineDisposition, RMARefundMethod, RMAStatus


class _CamelBase(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


# ---------- Work centers ----------


class WorkCenterCreate(_CamelBase):
    code: str
    name: str
    hourly_rate: Decimal = Decimal("0")
    capacity_hours_per_day: Decimal = Decimal("8")


class WorkCenterOut(_CamelBase):
    id: uuid.UUID
    code: str
    name: str
    hourly_rate: Decimal
    capacity_hours_per_day: Decimal
    is_active: bool


# ---------- Production orders ----------


class MOCreate(_CamelBase):
    product_id: uuid.UUID
    qty_planned: Decimal
    warehouse_id: uuid.UUID
    planned_start: datetime | None = None
    planned_end: datetime | None = None
    currency: str = "EGP"
    notes: str | None = None


class MOComponentOut(_CamelBase):
    id: uuid.UUID
    component_product_id: uuid.UUID
    qty_required: Decimal
    qty_issued: Decimal
    std_unit_cost: Decimal
    actual_unit_cost: Decimal


class MOOut(_CamelBase):
    id: uuid.UUID
    mo_number: str
    product_id: uuid.UUID
    bom_id: uuid.UUID | None
    warehouse_id: uuid.UUID
    qty_planned: Decimal
    qty_produced: Decimal
    status: MOStatus
    std_cost_per_unit: Decimal
    total_std_cost: Decimal
    total_actual_cost: Decimal
    variance: Decimal
    currency: str
    issue_journal_id: uuid.UUID | None
    completion_journal_id: uuid.UUID | None
    variance_journal_id: uuid.UUID | None


class MOCompleteIn(_CamelBase):
    qty_produced: Decimal


class MOSummary(_CamelBase):
    counts: dict[str, int]
    wip_balance: Decimal


# ---------- RMA ----------


class RMALineIn(_CamelBase):
    product_id: uuid.UUID
    qty_requested: Decimal
    original_unit_price: Decimal
    original_unit_cost: Decimal = Decimal("0")
    disposition: RMALineDisposition = RMALineDisposition.RESTOCK


class RMACreate(_CamelBase):
    customer_id: uuid.UUID
    warehouse_id: uuid.UUID
    lines: list[RMALineIn]
    customer_invoice_id: uuid.UUID | None = None
    sales_order_id: uuid.UUID | None = None
    reason: str | None = None
    refund_method: RMARefundMethod = RMARefundMethod.BANK
    currency: str = "EGP"


class RMALineOut(_CamelBase):
    id: uuid.UUID
    product_id: uuid.UUID
    qty_requested: Decimal
    qty_received: Decimal
    qty_restocked: Decimal
    qty_scrapped: Decimal
    original_unit_price: Decimal
    original_unit_cost: Decimal
    disposition: RMALineDisposition


class RMAOut(_CamelBase):
    id: uuid.UUID
    rma_number: str
    customer_id: uuid.UUID
    customer_invoice_id: uuid.UUID | None
    sales_order_id: uuid.UUID | None
    warehouse_id: uuid.UUID
    status: RMAStatus
    refund_method: RMARefundMethod
    refund_account_code: str
    total_refund_amount: Decimal
    currency: str
    refund_journal_id: uuid.UUID | None
    cogs_reversal_journal_id: uuid.UUID | None


class RMAReceiveLineIn(_CamelBase):
    line_id: uuid.UUID
    qty_restocked: Decimal
    qty_scrapped: Decimal = Decimal("0")


class RMAReceiveIn(_CamelBase):
    dispositions: list[RMAReceiveLineIn] = []


class RMASummary(_CamelBase):
    counts: dict[str, int]


__all__ = [
    "MOCompleteIn",
    "MOComponentOut",
    "MOCreate",
    "MOOut",
    "MOSummary",
    "RMACreate",
    "RMALineIn",
    "RMALineOut",
    "RMAOut",
    "RMAReceiveIn",
    "RMAReceiveLineIn",
    "RMASummary",
    "WorkCenterCreate",
    "WorkCenterOut",
]
