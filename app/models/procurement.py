"""Procurement + AP models (v0.3.0).

Supplier vendor types differentiate Manufacturers (Hassan/Khaled/Haytham) from
Ads platforms (TikTok/Meta/Google), Couriers (Bosta), Gateways (Paymob), etc.
"""

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
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class VendorType(enum.StrEnum):
    SUPPLIER = "SUPPLIER"
    MANUFACTURER = "MANUFACTURER"
    ADS_PLATFORM = "ADS_PLATFORM"
    COURIER = "COURIER"
    GATEWAY = "GATEWAY"
    OTHER = "OTHER"


class POStatus(enum.StrEnum):
    DRAFT = "DRAFT"
    SENT = "SENT"
    PARTIAL = "PARTIAL"
    RECEIVED = "RECEIVED"
    CLOSED = "CLOSED"
    CANCELLED = "CANCELLED"


class GoodsReceiptStatus(enum.StrEnum):
    DRAFT = "DRAFT"
    POSTED = "POSTED"
    REVERSED = "REVERSED"


class SupplierInvoiceStatus(enum.StrEnum):
    DRAFT = "DRAFT"
    POSTED = "POSTED"
    PAID = "PAID"
    PARTIALLY_PAID = "PARTIALLY_PAID"
    VOID = "VOID"


class PaymentMethod(enum.StrEnum):
    CASH = "CASH"
    BANK = "BANK"
    OTHER = "OTHER"


class Supplier(Base):
    __tablename__ = "suppliers"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    vendor_type: Mapped[VendorType] = mapped_column(
        SQLEnum(VendorType, native_enum=False, length=16, name="vendor_type"), nullable=False
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EGP")
    payment_terms_days: Mapped[int] = mapped_column(nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    ap_account_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    po_number: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    supplier_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("suppliers.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    warehouse_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("warehouses.id", ondelete="RESTRICT"), nullable=False
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EGP")
    fx_rate: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False, default=Decimal("1"))
    status: Mapped[POStatus] = mapped_column(
        SQLEnum(POStatus, native_enum=False, length=16, name="po_status"),
        nullable=False,
        default=POStatus.DRAFT,
    )
    order_date: Mapped[date] = mapped_column(Date, nullable=False, default=date.today)
    expected_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    landed_cost_total: Mapped[Decimal] = mapped_column(
        Numeric(18, 4), nullable=False, default=Decimal("0")
    )
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    lines: Mapped[list[POLine]] = relationship(back_populates="po", cascade="all, delete-orphan")


class POLine(Base):
    __tablename__ = "po_lines"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    po_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("purchase_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=False
    )
    position: Mapped[int] = mapped_column(nullable=False, default=0)
    qty_ordered: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    qty_received: Mapped[Decimal] = mapped_column(
        Numeric(12, 4), nullable=False, default=Decimal("0")
    )
    qty_invoiced: Mapped[Decimal] = mapped_column(
        Numeric(12, 4), nullable=False, default=Decimal("0")
    )
    unit_price: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)

    po: Mapped[PurchaseOrder] = relationship(back_populates="lines")

    __table_args__ = (CheckConstraint("qty_ordered > 0", name="ck_po_line_qty_positive"),)


class GoodsReceipt(Base):
    __tablename__ = "goods_receipts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    gr_number: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    po_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("purchase_orders.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    warehouse_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("warehouses.id", ondelete="RESTRICT"), nullable=False
    )
    received_at: Mapped[date] = mapped_column(Date, nullable=False, default=date.today)
    landed_cost_allocated: Mapped[Decimal] = mapped_column(
        Numeric(18, 4), nullable=False, default=Decimal("0")
    )
    status: Mapped[GoodsReceiptStatus] = mapped_column(
        SQLEnum(GoodsReceiptStatus, native_enum=False, length=16, name="gr_status"),
        nullable=False,
        default=GoodsReceiptStatus.POSTED,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    lines: Mapped[list[GoodsReceiptLine]] = relationship(
        back_populates="gr", cascade="all, delete-orphan"
    )


class GoodsReceiptLine(Base):
    __tablename__ = "goods_receipt_lines"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    gr_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("goods_receipts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    po_line_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("po_lines.id", ondelete="RESTRICT"), nullable=False
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=False
    )
    qty: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    landed_per_unit: Mapped[Decimal] = mapped_column(
        Numeric(18, 4), nullable=False, default=Decimal("0")
    )
    cost_layer_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)

    gr: Mapped[GoodsReceipt] = relationship(back_populates="lines")


class SupplierInvoice(Base):
    __tablename__ = "supplier_invoices"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    invoice_number: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    supplier_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("suppliers.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    po_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("purchase_orders.id", ondelete="SET NULL"), nullable=True
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EGP")
    fx_rate: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False, default=Decimal("1"))
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    tax: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    total: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    amount_paid: Mapped[Decimal] = mapped_column(
        Numeric(18, 4), nullable=False, default=Decimal("0")
    )
    status: Mapped[SupplierInvoiceStatus] = mapped_column(
        SQLEnum(SupplierInvoiceStatus, native_enum=False, length=16, name="si_status"),
        nullable=False,
        default=SupplierInvoiceStatus.DRAFT,
    )
    posted_journal_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    lines: Mapped[list[SupplierInvoiceLine]] = relationship(
        back_populates="invoice", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("supplier_id", "invoice_number", name="uq_si_supplier_number"),
        CheckConstraint("total >= 0", name="ck_si_total_nonneg"),
    )


class SupplierInvoiceLine(Base):
    __tablename__ = "supplier_invoice_lines"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("supplier_invoices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    po_line_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("po_lines.id", ondelete="SET NULL"), nullable=True
    )
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    account_code: Mapped[str] = mapped_column(String(16), nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False, default=Decimal("1"))
    unit_price: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)

    invoice: Mapped[SupplierInvoice] = relationship(back_populates="lines")


class APPayment(Base):
    __tablename__ = "ap_payments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    payment_number: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    supplier_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("suppliers.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    payment_date: Mapped[date] = mapped_column(Date, nullable=False, default=date.today)
    method: Mapped[PaymentMethod] = mapped_column(
        SQLEnum(PaymentMethod, native_enum=False, length=8, name="payment_method"),
        nullable=False,
        default=PaymentMethod.BANK,
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EGP")
    fx_rate: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False, default=Decimal("1"))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    cash_account_code: Mapped[str] = mapped_column(String(16), nullable=False)
    posted_journal_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    applications: Mapped[list[APPaymentApplication]] = relationship(
        back_populates="payment", cascade="all, delete-orphan"
    )


class APPaymentApplication(Base):
    __tablename__ = "ap_payment_applications"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    payment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("ap_payments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("supplier_invoices.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    amount_applied: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)

    payment: Mapped[APPayment] = relationship(back_populates="applications")


__all__ = [
    "APPayment",
    "APPaymentApplication",
    "GoodsReceipt",
    "GoodsReceiptLine",
    "GoodsReceiptStatus",
    "POLine",
    "POStatus",
    "PaymentMethod",
    "PurchaseOrder",
    "Supplier",
    "SupplierInvoice",
    "SupplierInvoiceLine",
    "SupplierInvoiceStatus",
    "VendorType",
]
