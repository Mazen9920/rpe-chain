"""Sales models: customers, orders, order lines (bundle parent/child), shipments."""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.product import Product


class SalesOrderSource(enum.StrEnum):
    SHOPIFY = "SHOPIFY"
    MANUAL = "MANUAL"
    B2B = "B2B"


class SalesOrderStatus(enum.StrEnum):
    RECEIVED = "RECEIVED"
    CONFIRMED = "CONFIRMED"
    ALLOCATED = "ALLOCATED"
    PICKED = "PICKED"
    PACKED = "PACKED"
    SHIPPED = "SHIPPED"
    DELIVERED = "DELIVERED"
    CANCELLED = "CANCELLED"


class ShipmentStatus(enum.StrEnum):
    DRAFT = "DRAFT"
    DISPATCHED = "DISPATCHED"
    DELIVERED = "DELIVERED"
    CANCELLED = "CANCELLED"


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EGP")
    payment_terms_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    credit_limit: Mapped[Decimal] = mapped_column(
        Numeric(18, 4), nullable=False, default=Decimal("0")
    )
    external_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class SalesOrder(Base):
    __tablename__ = "sales_orders"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    order_number: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    customer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    warehouse_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("warehouses.id", ondelete="SET NULL"), nullable=True, index=True
    )
    source: Mapped[SalesOrderSource] = mapped_column(
        SQLEnum(SalesOrderSource, native_enum=False, length=16, name="sales_order_source"),
        nullable=False,
        default=SalesOrderSource.MANUAL,
    )
    external_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    status: Mapped[SalesOrderStatus] = mapped_column(
        SQLEnum(SalesOrderStatus, native_enum=False, length=16, name="sales_order_status"),
        nullable=False,
        default=SalesOrderStatus.RECEIVED,
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EGP")
    order_date: Mapped[date] = mapped_column(Date, nullable=False, default=date.today)
    notes: Mapped[str | None] = mapped_column(String(512), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    customer: Mapped[Customer] = relationship(Customer)
    lines: Mapped[list[SalesOrderLine]] = relationship(
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="SalesOrderLine.position",
    )

    __table_args__ = (
        UniqueConstraint("source", "external_id", name="uq_sales_order_source_external"),
    )


class SalesOrderLine(Base):
    __tablename__ = "sales_order_lines"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sales_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    parent_line_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sales_order_lines.id", ondelete="CASCADE"), nullable=True, index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    is_bundle_parent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_bundle_component: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    qty: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    qty_allocated: Mapped[Decimal] = mapped_column(
        Numeric(12, 4), nullable=False, default=Decimal("0")
    )
    qty_picked: Mapped[Decimal] = mapped_column(
        Numeric(12, 4), nullable=False, default=Decimal("0")
    )
    qty_shipped: Mapped[Decimal] = mapped_column(
        Numeric(12, 4), nullable=False, default=Decimal("0")
    )

    unit_price: Mapped[Decimal] = mapped_column(
        Numeric(18, 4), nullable=False, default=Decimal("0")
    )
    line_total: Mapped[Decimal] = mapped_column(
        Numeric(18, 4), nullable=False, default=Decimal("0")
    )

    order: Mapped[SalesOrder] = relationship(back_populates="lines")
    product: Mapped[Product] = relationship(Product)

    __table_args__ = (
        CheckConstraint("qty > 0", name="ck_sol_qty_positive"),
        CheckConstraint("qty_allocated >= 0 AND qty_allocated <= qty", name="ck_sol_alloc_range"),
        CheckConstraint("qty_picked >= 0 AND qty_picked <= qty", name="ck_sol_picked_range"),
        CheckConstraint("qty_shipped >= 0 AND qty_shipped <= qty", name="ck_sol_shipped_range"),
    )


class Shipment(Base):
    __tablename__ = "shipments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    shipment_number: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False, index=True
    )
    order_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sales_orders.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    warehouse_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("warehouses.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    status: Mapped[ShipmentStatus] = mapped_column(
        SQLEnum(ShipmentStatus, native_enum=False, length=16, name="shipment_status"),
        nullable=False,
        default=ShipmentStatus.DRAFT,
    )
    carrier: Mapped[str | None] = mapped_column(String(64), nullable=True)
    tracking_number: Mapped[str | None] = mapped_column(String(128), nullable=True)
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    lines: Mapped[list[ShipmentLine]] = relationship(
        back_populates="shipment", cascade="all, delete-orphan"
    )


class ShipmentLine(Base):
    __tablename__ = "shipment_lines"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    shipment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("shipments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_line_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sales_order_lines.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    qty: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    cost_source: Mapped[str] = mapped_column(String(16), nullable=False, default="standard")

    shipment: Mapped[Shipment] = relationship(back_populates="lines")

    __table_args__ = (CheckConstraint("qty > 0", name="ck_shipline_qty_positive"),)


__all__ = [
    "Customer",
    "SalesOrder",
    "SalesOrderLine",
    "SalesOrderSource",
    "SalesOrderStatus",
    "Shipment",
    "ShipmentLine",
    "ShipmentStatus",
]
