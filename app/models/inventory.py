"""Inventory models: warehouses, lots, stock levels, movements, cost layers, reservations."""

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


class MovementType(enum.StrEnum):
    RECEIVE = "RECEIVE"
    SHIP = "SHIP"
    TRANSFER_OUT = "TRANSFER_OUT"
    TRANSFER_IN = "TRANSFER_IN"
    ADJUST = "ADJUST"
    RESERVE = "RESERVE"
    RELEASE = "RELEASE"


class CostLayerStatus(enum.StrEnum):
    ACTIVE = "ACTIVE"
    DEPLETED = "DEPLETED"
    LOCKED = "LOCKED"


class ReservationStatus(enum.StrEnum):
    ACTIVE = "ACTIVE"
    RELEASED = "RELEASED"
    CONSUMED = "CONSUMED"


class Warehouse(Base):
    __tablename__ = "warehouses"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    country: Mapped[str | None] = mapped_column(String(2), nullable=True)
    city: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Lot(Base):
    __tablename__ = "lots"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    lot_code: Mapped[str] = mapped_column(String(64), nullable=False)
    received_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    expires_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    product: Mapped[Product] = relationship(Product)

    __table_args__ = (UniqueConstraint("product_id", "lot_code", name="uq_lot_product_code"),)


class StockLevel(Base):
    """Per (product, warehouse) on-hand + reserved. `version` is optimistic-lock counter."""

    __tablename__ = "stock_levels"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    warehouse_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("warehouses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    on_hand: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False, default=Decimal("0"))
    reserved: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False, default=Decimal("0"))
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    product: Mapped[Product] = relationship(Product)

    __table_args__ = (
        UniqueConstraint("product_id", "warehouse_id", name="uq_stock_product_wh"),
        CheckConstraint("on_hand >= 0", name="ck_stock_on_hand_nonneg"),
        CheckConstraint("reserved >= 0", name="ck_stock_reserved_nonneg"),
        CheckConstraint("reserved <= on_hand", name="ck_stock_reserved_le_on_hand"),
    )


class StockMovement(Base):
    """Append-only signed ledger of all stock changes."""

    __tablename__ = "stock_movements"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    warehouse_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("warehouses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    lot_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("lots.id", ondelete="SET NULL"), nullable=True, index=True
    )
    movement_type: Mapped[MovementType] = mapped_column(
        SQLEnum(MovementType, native_enum=False, length=16, name="movement_type"),
        nullable=False,
    )
    qty: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    unit_cost: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    ref_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ref_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (CheckConstraint("qty <> 0", name="ck_movement_qty_nonzero"),)


class CostLayer(Base):
    """FIFO cost layer opened on receipt; depleted on shipment."""

    __tablename__ = "cost_layers"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    warehouse_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("warehouses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    lot_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("lots.id", ondelete="SET NULL"), nullable=True
    )
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    qty_received: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    qty_remaining: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    landed_cost_per_unit: Mapped[Decimal] = mapped_column(
        Numeric(18, 4), nullable=False, default=Decimal("0")
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EGP")
    status: Mapped[CostLayerStatus] = mapped_column(
        SQLEnum(CostLayerStatus, native_enum=False, length=16, name="cost_layer_status"),
        nullable=False,
        default=CostLayerStatus.ACTIVE,
    )

    __table_args__ = (
        CheckConstraint("qty_received > 0", name="ck_layer_received_positive"),
        CheckConstraint("qty_remaining >= 0", name="ck_layer_remaining_nonneg"),
        CheckConstraint("qty_remaining <= qty_received", name="ck_layer_remaining_le_received"),
        CheckConstraint("unit_cost >= 0", name="ck_layer_unit_cost_nonneg"),
    )


class Reservation(Base):
    """Soft hold on inventory for a sales order line or other doc."""

    __tablename__ = "reservations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    warehouse_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("warehouses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    qty: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    ref_type: Mapped[str] = mapped_column(String(32), nullable=False)
    ref_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    status: Mapped[ReservationStatus] = mapped_column(
        SQLEnum(ReservationStatus, native_enum=False, length=16, name="reservation_status"),
        nullable=False,
        default=ReservationStatus.ACTIVE,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (CheckConstraint("qty > 0", name="ck_reservation_qty_positive"),)


__all__ = [
    "CostLayer",
    "CostLayerStatus",
    "Lot",
    "MovementType",
    "Reservation",
    "ReservationStatus",
    "StockLevel",
    "StockMovement",
    "Warehouse",
]
