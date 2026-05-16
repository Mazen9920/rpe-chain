"""Pydantic v2 schemas for v0.2.0 (catalog, inventory, sales, shipments)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, condecimal
from pydantic.alias_generators import to_camel

from app.models.inventory import CostLayerStatus, MovementType, ReservationStatus
from app.models.product import ProductType
from app.models.sales import SalesOrderSource, SalesOrderStatus, ShipmentStatus


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


Money = Annotated[Decimal, condecimal(max_digits=18, decimal_places=4)]
Qty = Annotated[Decimal, condecimal(max_digits=12, decimal_places=4)]


# ---------- Catalog ----------


class CategoryRead(_Camel):
    id: uuid.UUID
    code: str
    name: str
    parent_id: uuid.UUID | None
    is_active: bool


class CategoryCreate(_Camel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    parent_id: uuid.UUID | None = None


class BundleComponentUpsert(_Camel):
    component_product_id: uuid.UUID
    qty_per: Qty
    allocation_weight: Decimal | None = None
    position: int = 0


class BundleComponentRead(_Camel):
    id: uuid.UUID
    bundle_product_id: uuid.UUID
    component_product_id: uuid.UUID
    position: int
    qty_per: Qty
    allocation_weight: Decimal | None


class BundleAtpRead(_Camel):
    bundle_product_id: uuid.UUID
    warehouse_id: uuid.UUID
    atp: int


class ProductRead(_Camel):
    id: uuid.UUID
    sku: str
    name: str
    uom: str
    product_type: ProductType
    is_manufactured: bool
    is_active: bool
    category_id: uuid.UUID | None
    selling_price: Money | None
    external_id: str | None


class ProductCreate(_Camel):
    sku: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    uom: str = "EA"
    product_type: ProductType = ProductType.RAW
    is_manufactured: bool = False
    category_id: uuid.UUID | None = None
    selling_price: Money | None = None
    external_id: str | None = None


# ---------- Inventory ----------


class WarehouseRead(_Camel):
    id: uuid.UUID
    code: str
    name: str
    country: str | None
    city: str | None
    is_active: bool


class WarehouseCreate(_Camel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=255)
    country: str | None = None
    city: str | None = None


class StockLevelRead(_Camel):
    id: uuid.UUID
    product_id: uuid.UUID
    warehouse_id: uuid.UUID
    on_hand: Qty
    reserved: Qty
    version: int


class StockMovementRead(_Camel):
    id: uuid.UUID
    product_id: uuid.UUID
    warehouse_id: uuid.UUID
    movement_type: MovementType
    qty: Qty
    unit_cost: Money | None
    ref_type: str | None
    ref_id: uuid.UUID | None
    note: str | None
    occurred_at: datetime


class CostLayerRead(_Camel):
    id: uuid.UUID
    product_id: uuid.UUID
    warehouse_id: uuid.UUID
    received_at: datetime
    qty_received: Qty
    qty_remaining: Qty
    unit_cost: Money
    landed_cost_per_unit: Money
    currency: str
    status: CostLayerStatus


class ReservationRead(_Camel):
    id: uuid.UUID
    product_id: uuid.UUID
    warehouse_id: uuid.UUID
    qty: Qty
    ref_type: str
    ref_id: uuid.UUID
    status: ReservationStatus


class ReceiveRequest(_Camel):
    product_id: uuid.UUID
    warehouse_id: uuid.UUID
    qty: Qty
    unit_cost: Money
    landed_cost_per_unit: Money = Decimal("0")
    currency: str = "EGP"


class AdjustRequest(_Camel):
    product_id: uuid.UUID
    warehouse_id: uuid.UUID
    delta: Qty
    unit_cost: Money | None = None
    note: str | None = None


class TransferRequest(_Camel):
    product_id: uuid.UUID
    from_warehouse_id: uuid.UUID
    to_warehouse_id: uuid.UUID
    qty: Qty
    note: str | None = None


# ---------- Sales ----------


class CustomerCreate(_Camel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    email: str | None = None
    phone: str | None = None
    currency: str = "EGP"
    payment_terms_days: int = 0
    credit_limit: Money = Decimal("0")


class CustomerRead(_Camel):
    id: uuid.UUID
    code: str
    name: str
    email: str | None
    phone: str | None
    currency: str
    payment_terms_days: int
    credit_limit: Money
    is_active: bool


class SalesOrderLineCreate(_Camel):
    product_id: uuid.UUID
    qty: Qty
    unit_price: Money = Decimal("0")
    line_total: Money | None = None


class SalesOrderLineRead(_Camel):
    id: uuid.UUID
    order_id: uuid.UUID
    parent_line_id: uuid.UUID | None
    position: int
    product_id: uuid.UUID
    is_bundle_parent: bool
    is_bundle_component: bool
    qty: Qty
    qty_allocated: Qty
    qty_picked: Qty
    qty_shipped: Qty
    unit_price: Money
    line_total: Money


class SalesOrderCreate(_Camel):
    customer_id: uuid.UUID
    warehouse_id: uuid.UUID | None = None
    lines: list[SalesOrderLineCreate]
    source: SalesOrderSource = SalesOrderSource.MANUAL
    external_id: str | None = None
    order_date: date | None = None
    currency: str = "EGP"
    expand_bundles: bool = True


class SalesOrderRead(_Camel):
    id: uuid.UUID
    order_number: str
    customer_id: uuid.UUID
    warehouse_id: uuid.UUID | None
    source: SalesOrderSource
    external_id: str | None
    status: SalesOrderStatus
    currency: str
    order_date: date
    notes: str | None
    lines: list[SalesOrderLineRead] = Field(default_factory=list)


class ShipmentLineRead(_Camel):
    id: uuid.UUID
    shipment_id: uuid.UUID
    order_line_id: uuid.UUID
    product_id: uuid.UUID
    qty: Qty
    unit_cost: Money
    cost_source: str


class ShipmentRead(_Camel):
    id: uuid.UUID
    shipment_number: str
    order_id: uuid.UUID
    warehouse_id: uuid.UUID
    status: ShipmentStatus
    carrier: str | None
    tracking_number: str | None
    dispatched_at: datetime | None
    delivered_at: datetime | None
    lines: list[ShipmentLineRead] = Field(default_factory=list)


class ShipRequest(_Camel):
    carrier: str | None = None
    tracking_number: str | None = None


# ---------- Pending journals ----------


class PendingJournalLineRead(_Camel):
    id: uuid.UUID
    account_code: str
    debit: Money
    credit: Money
    currency: str
    dimensions: Any | None


class PendingJournalRead(_Camel):
    id: uuid.UUID
    source_doc_type: str
    source_doc_id: uuid.UUID
    event_date: date
    currency: str
    status: str
    lines: list[PendingJournalLineRead] = Field(default_factory=list)


__all__ = [
    "AdjustRequest",
    "BundleAtpRead",
    "BundleComponentRead",
    "BundleComponentUpsert",
    "CategoryCreate",
    "CategoryRead",
    "CostLayerRead",
    "CustomerCreate",
    "CustomerRead",
    "PendingJournalLineRead",
    "PendingJournalRead",
    "ProductCreate",
    "ProductRead",
    "ReceiveRequest",
    "ReservationRead",
    "SalesOrderCreate",
    "SalesOrderLineCreate",
    "SalesOrderLineRead",
    "SalesOrderRead",
    "ShipRequest",
    "ShipmentLineRead",
    "ShipmentRead",
    "StockLevelRead",
    "StockMovementRead",
    "TransferRequest",
    "WarehouseCreate",
    "WarehouseRead",
]
