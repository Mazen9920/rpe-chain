"""Pydantic v2 schemas for the standard-cost engine (camelCase wire format)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, condecimal
from pydantic.alias_generators import to_camel

from app.models.costing import CostSource, OtherCostType, StandardCostStatus
from app.models.product import ProductType


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


Money = Annotated[Decimal, condecimal(max_digits=18, decimal_places=4)]
Qty = Annotated[Decimal, condecimal(max_digits=12, decimal_places=4)]
Pct = Annotated[
    Decimal,
    condecimal(max_digits=5, decimal_places=4, ge=Decimal("0"), lt=Decimal("1")),
]
Fx = Annotated[Decimal, condecimal(max_digits=14, decimal_places=6, gt=Decimal("0"))]
Currency = Annotated[str, Field(min_length=3, max_length=3)]


# ---------- Product ----------


class ProductRead(_Camel):
    id: uuid.UUID
    sku: str
    name: str
    uom: str
    product_type: ProductType
    is_manufactured: bool
    is_active: bool


# ---------- BOM ----------


class BomLineRead(_Camel):
    id: uuid.UUID
    position: int
    component_product_id: uuid.UUID
    qty_per: Qty
    scrap_factor_pct: Pct


class BomRead(_Camel):
    id: uuid.UUID
    product_id: uuid.UUID
    version: int
    is_active: bool
    lines: list[BomLineRead] = Field(default_factory=list)


# ---------- Cost inputs ----------


class RmCostUpsert(_Camel):
    unit_cost: Money
    currency: Currency = "EGP"
    fx_rate: Fx | None = None
    source: CostSource = CostSource.MANUAL


class RmCostRead(_Camel):
    id: uuid.UUID
    product_id: uuid.UUID
    month_start: date
    unit_cost: Money
    currency: str
    fx_rate: Fx | None
    source: CostSource
    is_locked: bool


class MfgFeeUpsert(_Camel):
    fee_amount: Money
    currency: Currency = "EGP"


class MfgFeeRead(_Camel):
    id: uuid.UUID
    product_id: uuid.UUID
    month_start: date
    fee_amount: Money
    currency: str
    is_locked: bool


class OtherCostUpsert(_Camel):
    amount: Money
    currency: Currency = "EGP"


class OtherCostRead(_Camel):
    id: uuid.UUID
    product_id: uuid.UUID
    month_start: date
    cost_type: OtherCostType
    amount: Money
    currency: str
    is_locked: bool


# ---------- Standard cost ----------


class StandardCostRead(_Camel):
    id: uuid.UUID
    product_id: uuid.UUID
    month_start: date
    unit_cost: Money | None
    rm_subtotal: Money | None
    mfg_fee: Money | None
    other_subtotal: Money | None
    status: StandardCostStatus
    is_locked: bool
    computed_at: datetime
    missing_inputs: Any | None
    breakdown: Any | None


# ---------- Settings ----------


class CostingSettingsRead(_Camel):
    cutover_date: date | None
    stale_after_days: int
    default_currency: str


class CostingSettingsUpdate(_Camel):
    cutover_date: date | None = None
    stale_after_days: int | None = Field(default=None, ge=1, le=365)
    default_currency: Currency | None = None


# ---------- Requests ----------


class MonthRef(_Camel):
    month_start: date


class RecomputeRequest(_Camel):
    month_start: date
    product_ids: list[uuid.UUID] | None = None


class RecomputeResponse(_Camel):
    month_start: date
    count: int
    by_status: dict[str, int]
    task_id: str | None = None


class LockResponse(_Camel):
    month_start: date
    counts: dict[str, int]


__all__ = [
    "BomLineRead",
    "BomRead",
    "CostingSettingsRead",
    "CostingSettingsUpdate",
    "LockResponse",
    "MfgFeeRead",
    "MfgFeeUpsert",
    "MonthRef",
    "OtherCostRead",
    "OtherCostUpsert",
    "ProductRead",
    "RecomputeRequest",
    "RecomputeResponse",
    "RmCostRead",
    "RmCostUpsert",
    "StandardCostRead",
]
