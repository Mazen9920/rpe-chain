"""Period close, recognition, and audit models (v0.3.1).

- `accounting_periods`: month-level lock controlling backdated postings.
- `expense_contracts` + `recognition_entries`: ONE_OFF / MONTHLY / PREPAID / ACCRUED
  recognition schedule, with traceable per-period postings.
- `audit_check_results`: persisted output of audit framework runs.
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
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class PeriodStatus(enum.StrEnum):
    OPEN = "OPEN"
    CLOSING = "CLOSING"
    LOCKED = "LOCKED"
    REOPENED = "REOPENED"


class RecognitionMode(enum.StrEnum):
    ONE_OFF = "ONE_OFF"
    MONTHLY = "MONTHLY"
    PREPAID = "PREPAID"
    ACCRUED = "ACCRUED"


class ContractStatus(enum.StrEnum):
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class AuditSeverity(enum.StrEnum):
    BLOCKER = "BLOCKER"
    WARN = "WARN"
    INFO = "INFO"


class AccountingPeriod(Base):
    __tablename__ = "accounting_periods"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[PeriodStatus] = mapped_column(
        SQLEnum(PeriodStatus, native_enum=False, length=16, name="period_status"),
        nullable=False,
        default=PeriodStatus.OPEN,
    )
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    locked_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("year", "month", name="uq_period_year_month"),
        CheckConstraint("month >= 1 AND month <= 12", name="ck_period_month_range"),
    )


class ExpenseContract(Base):
    __tablename__ = "expense_contracts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    supplier_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    expense_account_code: Mapped[str] = mapped_column(String(16), nullable=False)
    counter_account_code: Mapped[str] = mapped_column(
        String(16), nullable=False, default="2040"
    )  # Accrued by default
    recognition_mode: Mapped[RecognitionMode] = mapped_column(
        SQLEnum(RecognitionMode, native_enum=False, length=16, name="recognition_mode"),
        nullable=False,
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EGP")
    total_amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    monthly_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    period_months: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_recognized_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_recognized_month: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[ContractStatus] = mapped_column(
        SQLEnum(ContractStatus, native_enum=False, length=16, name="contract_status"),
        nullable=False,
        default=ContractStatus.ACTIVE,
    )
    memo: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (CheckConstraint("total_amount > 0", name="ck_contract_amount_pos"),)


class RecognitionEntry(Base):
    __tablename__ = "recognition_entries"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    contract_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("expense_contracts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    period_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("accounting_periods.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    journal_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("gl_journals.id", ondelete="RESTRICT"), nullable=False
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    recognized_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("contract_id", "period_id", name="uq_recognition_per_period"),
    )


class AuditCheckResult(Base):
    __tablename__ = "audit_check_results"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    period_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("accounting_periods.id", ondelete="CASCADE"), nullable=False, index=True
    )
    check_name: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    severity: Mapped[AuditSeverity] = mapped_column(
        SQLEnum(AuditSeverity, native_enum=False, length=8, name="audit_severity"),
        nullable=False,
    )
    ok: Mapped[bool] = mapped_column(Boolean, nullable=False)
    message: Mapped[str] = mapped_column(String(500), nullable=False)
    refs: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    run_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


__all__ = [
    "AccountingPeriod",
    "AuditCheckResult",
    "AuditSeverity",
    "ContractStatus",
    "ExpenseContract",
    "PeriodStatus",
    "RecognitionEntry",
    "RecognitionMode",
]
