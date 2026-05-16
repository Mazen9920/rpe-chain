"""Costing aggregates: BOM, monthly cost inputs, standard cost, costing settings."""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    JSON,
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
from sqlalchemy import (
    Enum as SQLEnum,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.product import Product


class CostSource(enum.StrEnum):
    MANUAL = "MANUAL"
    IMPORT = "IMPORT"
    API = "API"


class OtherCostType(enum.StrEnum):
    PACKAGING = "PACKAGING"
    LABOR = "LABOR"
    OVERHEAD = "OVERHEAD"
    OTHER = "OTHER"


class StandardCostStatus(enum.StrEnum):
    OK = "OK"
    MISSING_RM_PRICES = "MISSING_RM_PRICES"
    MISSING_MFG_FEE = "MISSING_MFG_FEE"
    STALE = "STALE"
    LOCKED = "LOCKED"


# ---------- BOM ----------


class BillOfMaterials(Base):
    __tablename__ = "bill_of_materials"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    product: Mapped[Product] = relationship(
        Product, back_populates="boms", foreign_keys=[product_id]
    )
    lines: Mapped[list[BomLine]] = relationship(
        back_populates="bom",
        cascade="all, delete-orphan",
        order_by="BomLine.position",
    )

    __table_args__ = (UniqueConstraint("product_id", "version", name="uq_bom_product_version"),)


class BomLine(Base):
    __tablename__ = "bom_lines"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    bom_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("bill_of_materials.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    component_product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    qty_per: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    scrap_factor_pct: Mapped[Decimal] = mapped_column(
        Numeric(5, 4), nullable=False, default=Decimal("0")
    )

    bom: Mapped[BillOfMaterials] = relationship(back_populates="lines")
    component: Mapped[Product] = relationship(Product, foreign_keys=[component_product_id])

    __table_args__ = (
        CheckConstraint("qty_per > 0", name="ck_bom_line_qty_positive"),
        CheckConstraint(
            "scrap_factor_pct >= 0 AND scrap_factor_pct < 1",
            name="ck_bom_line_scrap_fraction",
        ),
    )


# ---------- Cost inputs ----------


class _CostMonthMixin:
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    month_start: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EGP")
    is_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class RmCostMonth(_CostMonthMixin, Base):
    __tablename__ = "rm_cost_months"

    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    fx_rate: Mapped[Decimal | None] = mapped_column(Numeric(14, 6), nullable=True)
    source: Mapped[CostSource] = mapped_column(
        SQLEnum(CostSource, native_enum=False, length=16, name="cost_source"),
        nullable=False,
        default=CostSource.MANUAL,
    )

    product: Mapped[Product] = relationship(Product)

    __table_args__ = (
        UniqueConstraint("product_id", "month_start", name="uq_rm_cost_product_month"),
        CheckConstraint("unit_cost >= 0", name="ck_rm_unit_cost_nonneg"),
    )


class MfgFeeMonth(_CostMonthMixin, Base):
    __tablename__ = "mfg_fee_months"

    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    fee_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)

    product: Mapped[Product] = relationship(Product)

    __table_args__ = (
        UniqueConstraint("product_id", "month_start", name="uq_mfg_fee_product_month"),
        CheckConstraint("fee_amount >= 0", name="ck_mfg_fee_nonneg"),
    )


class OtherCostMonth(_CostMonthMixin, Base):
    __tablename__ = "other_cost_months"

    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    cost_type: Mapped[OtherCostType] = mapped_column(
        SQLEnum(OtherCostType, native_enum=False, length=16, name="other_cost_type"),
        nullable=False,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)

    product: Mapped[Product] = relationship(Product)

    __table_args__ = (
        UniqueConstraint(
            "product_id", "month_start", "cost_type", name="uq_other_cost_product_month_type"
        ),
        CheckConstraint("amount >= 0", name="ck_other_amount_nonneg"),
    )


# ---------- Standard cost (output) ----------


class StandardCost(Base):
    __tablename__ = "standard_costs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    month_start: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    unit_cost: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    rm_subtotal: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    mfg_fee: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    other_subtotal: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)

    status: Mapped[StandardCostStatus] = mapped_column(
        SQLEnum(StandardCostStatus, native_enum=False, length=24, name="standard_cost_status"),
        nullable=False,
        default=StandardCostStatus.OK,
    )
    is_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    missing_inputs: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    breakdown: Mapped[Any | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    product: Mapped[Product] = relationship(Product)

    __table_args__ = (
        UniqueConstraint("product_id", "month_start", name="uq_std_cost_product_month"),
    )


# ---------- Costing settings ----------


class CostingSettings(Base):
    __tablename__ = "costing_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    cutover_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    stale_after_days: Mapped[int] = mapped_column(Integer, nullable=False, default=7)
    default_currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EGP")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (CheckConstraint("id = 1", name="ck_costing_settings_singleton"),)


__all__ = [
    "BillOfMaterials",
    "BomLine",
    "CostSource",
    "CostingSettings",
    "MfgFeeMonth",
    "OtherCostMonth",
    "OtherCostType",
    "RmCostMonth",
    "StandardCost",
    "StandardCostStatus",
]
