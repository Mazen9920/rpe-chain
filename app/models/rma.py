"""Return Merchandise Authorization (v0.4.1).

Lifecycle:
    REQUESTED -> AUTHORIZED -> RECEIVED -> CLOSED
                                     \\-> CANCELLED

GL impact at close (per restocked / scrapped split):
    Refund:   DR 4010 Sales Revenue          / CR Bank or AR
    Restock:  DR 5000 FG Inventory           / CR 5400 COGS-FG (reverse COGS)
    Scrap:    no inventory; COGS stays posted.
"""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    func,
)
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class RMAStatus(enum.StrEnum):
    REQUESTED = "REQUESTED"
    AUTHORIZED = "AUTHORIZED"
    RECEIVED = "RECEIVED"
    CLOSED = "CLOSED"
    CANCELLED = "CANCELLED"


class RMARefundMethod(enum.StrEnum):
    BANK = "BANK"
    CASH = "CASH"
    CREDIT_NOTE = "CREDIT_NOTE"


class RMALineDisposition(enum.StrEnum):
    RESTOCK = "RESTOCK"
    SCRAP = "SCRAP"


class RMA(Base):
    __tablename__ = "rmas"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    rma_number: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    customer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    customer_invoice_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("customer_invoices.id", ondelete="SET NULL"), nullable=True, index=True
    )
    sales_order_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sales_orders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    warehouse_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("warehouses.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    status: Mapped[RMAStatus] = mapped_column(
        SQLEnum(RMAStatus, native_enum=False, length=16, name="rma_status"),
        nullable=False,
        default=RMAStatus.REQUESTED,
        index=True,
    )
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    refund_method: Mapped[RMARefundMethod] = mapped_column(
        SQLEnum(RMARefundMethod, native_enum=False, length=16, name="rma_refund_method"),
        nullable=False,
        default=RMARefundMethod.BANK,
    )
    refund_account_code: Mapped[str] = mapped_column(String(16), nullable=False, default="1020")
    total_refund_amount: Mapped[Decimal] = mapped_column(
        Numeric(18, 4), nullable=False, default=Decimal("0")
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EGP")
    requested_at: Mapped[date] = mapped_column(Date, nullable=False, default=date.today)
    authorized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    refund_journal_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("gl_journals.id", ondelete="SET NULL"), nullable=True
    )
    cogs_reversal_journal_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("gl_journals.id", ondelete="SET NULL"), nullable=True
    )

    notes: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    lines: Mapped[list[RMALine]] = relationship(
        back_populates="rma",
        cascade="all, delete-orphan",
    )

    __table_args__ = (CheckConstraint("total_refund_amount >= 0", name="ck_rma_refund_nonneg"),)


class RMALine(Base):
    __tablename__ = "rma_lines"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    rma_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("rmas.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    qty_requested: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    qty_received: Mapped[Decimal] = mapped_column(
        Numeric(12, 4), nullable=False, default=Decimal("0")
    )
    qty_restocked: Mapped[Decimal] = mapped_column(
        Numeric(12, 4), nullable=False, default=Decimal("0")
    )
    qty_scrapped: Mapped[Decimal] = mapped_column(
        Numeric(12, 4), nullable=False, default=Decimal("0")
    )
    original_unit_price: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    original_unit_cost: Mapped[Decimal] = mapped_column(
        Numeric(18, 4), nullable=False, default=Decimal("0")
    )
    disposition: Mapped[RMALineDisposition] = mapped_column(
        SQLEnum(RMALineDisposition, native_enum=False, length=16, name="rma_line_disposition"),
        nullable=False,
        default=RMALineDisposition.RESTOCK,
    )

    rma: Mapped[RMA] = relationship(back_populates="lines")

    __table_args__ = (
        CheckConstraint("qty_requested > 0", name="ck_rmal_qty_requested_positive"),
        CheckConstraint("qty_received >= 0", name="ck_rmal_qty_received_nonneg"),
        CheckConstraint("qty_restocked >= 0", name="ck_rmal_qty_restocked_nonneg"),
        CheckConstraint("qty_scrapped >= 0", name="ck_rmal_qty_scrapped_nonneg"),
    )


__all__ = [
    "RMA",
    "RMALine",
    "RMALineDisposition",
    "RMARefundMethod",
    "RMAStatus",
]
