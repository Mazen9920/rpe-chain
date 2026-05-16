"""Accounts Receivable models (v0.3.1).

Auto-posted on shipment via `services.ar.post_invoice_from_shipment`.
Mirrors AP design (`models.procurement`) for symmetry.
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
    UniqueConstraint,
    func,
)
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class CustomerInvoiceStatus(enum.StrEnum):
    DRAFT = "DRAFT"
    POSTED = "POSTED"
    PARTIALLY_PAID = "PARTIALLY_PAID"
    PAID = "PAID"
    CANCELLED = "CANCELLED"
    CREDITED = "CREDITED"


class CustomerInvoiceType(enum.StrEnum):
    INVOICE = "INVOICE"
    CREDIT_NOTE = "CREDIT_NOTE"


class ARPaymentMethod(enum.StrEnum):
    CASH = "CASH"
    BANK = "BANK"
    PAYMOB = "PAYMOB"
    BOSTA_COD = "BOSTA_COD"
    CHEQUE = "CHEQUE"
    EFT = "EFT"


class CustomerInvoice(Base):
    __tablename__ = "customer_invoices"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    invoice_number: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    invoice_type: Mapped[CustomerInvoiceType] = mapped_column(
        SQLEnum(CustomerInvoiceType, native_enum=False, length=16, name="customer_invoice_type"),
        nullable=False,
        default=CustomerInvoiceType.INVOICE,
    )
    customer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    order_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sales_orders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    shipment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("shipments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EGP")
    subtotal: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    tax: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    shipping: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    total: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    amount_paid: Mapped[Decimal] = mapped_column(
        Numeric(18, 4), nullable=False, default=Decimal("0")
    )
    ar_account_code: Mapped[str] = mapped_column(String(16), nullable=False, default="1100")
    status: Mapped[CustomerInvoiceStatus] = mapped_column(
        SQLEnum(
            CustomerInvoiceStatus, native_enum=False, length=16, name="customer_invoice_status"
        ),
        nullable=False,
        default=CustomerInvoiceStatus.DRAFT,
    )
    posted_journal_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("gl_journals.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    lines: Mapped[list[CustomerInvoiceLine]] = relationship(
        back_populates="invoice", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("customer_id", "invoice_number", name="uq_customer_invoice_number"),
    )


class CustomerInvoiceLine(Base):
    __tablename__ = "customer_invoice_lines"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("customer_invoices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False, default=Decimal("1"))
    unit_price: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    revenue_account_code: Mapped[str] = mapped_column(String(16), nullable=False, default="4010")
    product_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), nullable=True
    )

    invoice: Mapped[CustomerInvoice] = relationship(back_populates="lines")

    __table_args__ = (CheckConstraint("qty > 0", name="ck_cil_qty_positive"),)


class ARPayment(Base):
    __tablename__ = "ar_payments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    payment_number: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    customer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    payment_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    method: Mapped[ARPaymentMethod] = mapped_column(
        SQLEnum(ARPaymentMethod, native_enum=False, length=16, name="ar_payment_method"),
        nullable=False,
        default=ARPaymentMethod.BANK,
    )
    cash_account_code: Mapped[str] = mapped_column(String(16), nullable=False, default="1020")
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EGP")
    posted_journal_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("gl_journals.id", ondelete="SET NULL"), nullable=True
    )
    memo: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    applications: Mapped[list[ARPaymentApplication]] = relationship(
        back_populates="payment", cascade="all, delete-orphan"
    )

    __table_args__ = (CheckConstraint("amount > 0", name="ck_ar_payment_amount_pos"),)


class ARPaymentApplication(Base):
    __tablename__ = "ar_payment_applications"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    payment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("ar_payments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("customer_invoices.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)

    payment: Mapped[ARPayment] = relationship(back_populates="applications")

    __table_args__ = (CheckConstraint("amount > 0", name="ck_ar_app_amount_pos"),)


__all__ = [
    "ARPayment",
    "ARPaymentApplication",
    "ARPaymentMethod",
    "CustomerInvoice",
    "CustomerInvoiceLine",
    "CustomerInvoiceStatus",
    "CustomerInvoiceType",
]
