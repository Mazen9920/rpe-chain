"""Paymob, Bosta COD, bank, and chargeback models (v0.4.0).

These tables back the high-toil "cash-in reconciliation" workflows:
- `paymob_transactions` — gateway transactions + settlement linkage
- `cod_ledger` — Bosta shipments + COD lifecycle
- `bank_accounts` + `bank_transactions` — bank statement import
- `chargebacks` — Paymob disputes

All amounts in `Numeric(18, 4)` per project convention.
"""

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
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

# ---------------------------------------------------------------------------
# Paymob
# ---------------------------------------------------------------------------


class PaymobTxnStatus(enum.StrEnum):
    CAPTURED = "CAPTURED"
    SETTLED = "SETTLED"
    REFUNDED = "REFUNDED"
    CHARGEBACK = "CHARGEBACK"
    VOIDED = "VOIDED"


class PaymobPaymentMethod(enum.StrEnum):
    CARD = "CARD"
    WALLET = "WALLET"
    INSTALLMENTS = "INSTALLMENTS"
    KIOSK = "KIOSK"
    OTHER = "OTHER"


class PaymobTransaction(Base):
    __tablename__ = "paymob_transactions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    external_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    order_external_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    order_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sales_orders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    customer_invoice_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("customer_invoices.id", ondelete="SET NULL"), nullable=True, index=True
    )
    payment_method: Mapped[PaymobPaymentMethod] = mapped_column(
        SQLEnum(PaymobPaymentMethod, native_enum=False, length=16, name="paymob_payment_method"),
        nullable=False,
        default=PaymobPaymentMethod.CARD,
    )
    amount_gross: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    fees: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    amount_net: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EGP")
    status: Mapped[PaymobTxnStatus] = mapped_column(
        SQLEnum(PaymobTxnStatus, native_enum=False, length=16, name="paymob_txn_status"),
        nullable=False,
        default=PaymobTxnStatus.CAPTURED,
        index=True,
    )
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    settlement_ref: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    posted_journal_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("gl_journals.id", ondelete="SET NULL"), nullable=True
    )
    raw_payload: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        CheckConstraint("amount_gross >= 0", name="ck_paymob_gross_positive"),
        CheckConstraint("fees >= 0", name="ck_paymob_fees_positive"),
    )


# ---------------------------------------------------------------------------
# Bosta COD
# ---------------------------------------------------------------------------


class CODStatus(enum.StrEnum):
    PENDING = "PENDING"
    IN_TRANSIT = "IN_TRANSIT"
    DELIVERED_UNREMITTED = "DELIVERED_UNREMITTED"
    DELIVERED_REMITTED = "DELIVERED_REMITTED"
    RETURNED = "RETURNED"
    VOIDED = "VOIDED"


class CODLedgerEntry(Base):
    __tablename__ = "cod_ledger"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tracking_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    order_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sales_orders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    customer_invoice_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("customer_invoices.id", ondelete="SET NULL"), nullable=True, index=True
    )
    customer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("customers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    cod_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    delivery_fee: Mapped[Decimal] = mapped_column(
        Numeric(18, 4), nullable=False, default=Decimal("0")
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EGP")
    status: Mapped[CODStatus] = mapped_column(
        SQLEnum(CODStatus, native_enum=False, length=24, name="cod_status"),
        nullable=False,
        default=CODStatus.PENDING,
        index=True,
    )
    shipped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    remitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    remittance_ref: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    posted_journal_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("gl_journals.id", ondelete="SET NULL"), nullable=True
    )
    raw_payload: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (CheckConstraint("cod_amount >= 0", name="ck_cod_amount_positive"),)


# ---------------------------------------------------------------------------
# Bank
# ---------------------------------------------------------------------------


class BankAccount(Base):
    __tablename__ = "bank_accounts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    bank_name: Mapped[str] = mapped_column(String(255), nullable=False)
    account_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EGP")
    gl_account_code: Mapped[str] = mapped_column(String(16), nullable=False, default="1020")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class BankTxnStatus(enum.StrEnum):
    UNMATCHED = "UNMATCHED"
    MATCHED = "MATCHED"
    IGNORED = "IGNORED"


class BankTxnMatchType(enum.StrEnum):
    AP_PAYMENT = "AP_PAYMENT"
    AR_PAYMENT = "AR_PAYMENT"
    PAYMOB_SETTLEMENT = "PAYMOB_SETTLEMENT"
    BOSTA_REMITTANCE = "BOSTA_REMITTANCE"
    MANUAL = "MANUAL"


class BankTransaction(Base):
    __tablename__ = "bank_transactions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    bank_account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("bank_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    transaction_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)  # signed
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EGP")
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    external_ref: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    statement_ref: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    status: Mapped[BankTxnStatus] = mapped_column(
        SQLEnum(BankTxnStatus, native_enum=False, length=16, name="bank_txn_status"),
        nullable=False,
        default=BankTxnStatus.UNMATCHED,
        index=True,
    )
    matched_type: Mapped[BankTxnMatchType | None] = mapped_column(
        SQLEnum(BankTxnMatchType, native_enum=False, length=24, name="bank_txn_match_type"),
        nullable=True,
    )
    matched_doc_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    matched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint(
            "bank_account_id", "external_ref", name="uq_bank_txn_account_external_ref"
        ),
    )


# ---------------------------------------------------------------------------
# Chargebacks
# ---------------------------------------------------------------------------


class ChargebackStatus(enum.StrEnum):
    OPEN = "OPEN"
    WON = "WON"
    LOST = "LOST"
    CANCELLED = "CANCELLED"


class Chargeback(Base):
    __tablename__ = "chargebacks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    paymob_transaction_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("paymob_transactions.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EGP")
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[ChargebackStatus] = mapped_column(
        SQLEnum(ChargebackStatus, native_enum=False, length=16, name="chargeback_status"),
        nullable=False,
        default=ChargebackStatus.OPEN,
        index=True,
    )
    raised_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    raised_journal_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("gl_journals.id", ondelete="SET NULL"), nullable=True
    )
    resolved_journal_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("gl_journals.id", ondelete="SET NULL"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (CheckConstraint("amount > 0", name="ck_chargeback_amount_positive"),)


__all__ = [
    "BankAccount",
    "BankTransaction",
    "BankTxnMatchType",
    "BankTxnStatus",
    "CODLedgerEntry",
    "CODStatus",
    "Chargeback",
    "ChargebackStatus",
    "PaymobPaymentMethod",
    "PaymobTransaction",
    "PaymobTxnStatus",
]
