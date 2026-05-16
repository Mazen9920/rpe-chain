"""Production orders + work centers (v0.4.1).

Two-stage production accounting:

1. Issue raw materials   : DR 5015 WIP            / CR 5010 RM Inventory   (at actual FIFO)
2. Complete finished good: DR 5000 FG Inventory   / CR 5015 WIP            (at standard cost x qty)
3. Close (variance)      : remaining WIP balance is closed to 5030
                           Inventory Adjustments (positive = unfavorable).

All amounts `Numeric(18, 4)`; qty `Numeric(12, 4)`.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
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


class MOStatus(enum.StrEnum):
    DRAFT = "DRAFT"
    RELEASED = "RELEASED"
    IN_PROGRESS = "IN_PROGRESS"
    DONE = "DONE"
    CLOSED = "CLOSED"
    CANCELLED = "CANCELLED"


class WorkCenter(Base):
    __tablename__ = "work_centers"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    hourly_rate: Mapped[Decimal] = mapped_column(
        Numeric(18, 4), nullable=False, default=Decimal("0")
    )
    capacity_hours_per_day: Mapped[Decimal] = mapped_column(
        Numeric(8, 2), nullable=False, default=Decimal("8")
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        CheckConstraint("hourly_rate >= 0", name="ck_wc_hourly_rate_positive"),
        CheckConstraint("capacity_hours_per_day > 0", name="ck_wc_capacity_positive"),
    )


class ProductionOrder(Base):
    __tablename__ = "production_orders"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    mo_number: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    bom_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("bill_of_materials.id", ondelete="SET NULL"), nullable=True
    )
    warehouse_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("warehouses.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    qty_planned: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    qty_produced: Mapped[Decimal] = mapped_column(
        Numeric(12, 4), nullable=False, default=Decimal("0")
    )
    status: Mapped[MOStatus] = mapped_column(
        SQLEnum(MOStatus, native_enum=False, length=16, name="mo_status"),
        nullable=False,
        default=MOStatus.DRAFT,
        index=True,
    )
    std_cost_per_unit: Mapped[Decimal] = mapped_column(
        Numeric(18, 4), nullable=False, default=Decimal("0")
    )
    total_std_cost: Mapped[Decimal] = mapped_column(
        Numeric(18, 4), nullable=False, default=Decimal("0")
    )
    total_actual_cost: Mapped[Decimal] = mapped_column(
        Numeric(18, 4), nullable=False, default=Decimal("0")
    )
    variance: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EGP")
    planned_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    planned_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    actual_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    actual_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    issue_journal_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("gl_journals.id", ondelete="SET NULL"), nullable=True
    )
    completion_journal_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("gl_journals.id", ondelete="SET NULL"), nullable=True
    )
    variance_journal_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("gl_journals.id", ondelete="SET NULL"), nullable=True
    )

    notes: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    raw_payload: Mapped[Any | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    components: Mapped[list[MOComponent]] = relationship(
        back_populates="mo",
        cascade="all, delete-orphan",
        order_by="MOComponent.position",
    )
    operations: Mapped[list[MOOperation]] = relationship(
        back_populates="mo",
        cascade="all, delete-orphan",
        order_by="MOOperation.sequence",
    )

    __table_args__ = (
        CheckConstraint("qty_planned > 0", name="ck_mo_qty_planned_positive"),
        CheckConstraint("qty_produced >= 0", name="ck_mo_qty_produced_nonneg"),
    )


class MOComponent(Base):
    __tablename__ = "mo_components"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    mo_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("production_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    component_product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    qty_required: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    qty_issued: Mapped[Decimal] = mapped_column(
        Numeric(12, 4), nullable=False, default=Decimal("0")
    )
    std_unit_cost: Mapped[Decimal] = mapped_column(
        Numeric(18, 4), nullable=False, default=Decimal("0")
    )
    actual_unit_cost: Mapped[Decimal] = mapped_column(
        Numeric(18, 4), nullable=False, default=Decimal("0")
    )

    mo: Mapped[ProductionOrder] = relationship(back_populates="components")

    __table_args__ = (
        CheckConstraint("qty_required > 0", name="ck_moc_qty_required_positive"),
        CheckConstraint("qty_issued >= 0", name="ck_moc_qty_issued_nonneg"),
        UniqueConstraint("mo_id", "component_product_id", name="uq_mo_component"),
    )


class MOOperation(Base):
    __tablename__ = "mo_operations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    mo_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("production_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    work_center_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("work_centers.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    std_hours: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False, default=Decimal("0"))
    actual_hours: Mapped[Decimal] = mapped_column(
        Numeric(10, 4), nullable=False, default=Decimal("0")
    )

    mo: Mapped[ProductionOrder] = relationship(back_populates="operations")

    __table_args__ = (
        CheckConstraint("std_hours >= 0", name="ck_moo_std_hours_nonneg"),
        CheckConstraint("actual_hours >= 0", name="ck_moo_actual_hours_nonneg"),
    )


__all__ = [
    "MOComponent",
    "MOOperation",
    "MOStatus",
    "ProductionOrder",
    "WorkCenter",
]
