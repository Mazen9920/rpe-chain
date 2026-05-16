"""General Ledger + FX models (v0.3.0).

Double-entry: every GLJournal has lines summing debit==credit per currency.
GLAccount carries normal_balance + bs_tag (for Balance Sheet builder) + cf_tag
(for Cash Flow Statement builder).
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
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class AccountType(enum.StrEnum):
    ASSET = "ASSET"
    LIABILITY = "LIABILITY"
    EQUITY = "EQUITY"
    REVENUE = "REVENUE"
    EXPENSE = "EXPENSE"


class NormalBalance(enum.StrEnum):
    DEBIT = "DEBIT"
    CREDIT = "CREDIT"


class JournalStatus(enum.StrEnum):
    DRAFT = "DRAFT"
    POSTED = "POSTED"
    REVERSED = "REVERSED"


class GLAccount(Base):
    __tablename__ = "gl_accounts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(16), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    account_type: Mapped[AccountType] = mapped_column(
        SQLEnum(AccountType, native_enum=False, length=16, name="gl_account_type"),
        nullable=False,
    )
    normal_balance: Mapped[NormalBalance] = mapped_column(
        SQLEnum(NormalBalance, native_enum=False, length=8, name="gl_normal_balance"),
        nullable=False,
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("gl_accounts.id", ondelete="SET NULL"), nullable=True
    )
    bs_tag: Mapped[str | None] = mapped_column(String(64), nullable=True)
    cf_tag: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class GLJournal(Base):
    __tablename__ = "gl_journals"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    journal_number: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    event_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    source_doc_type: Mapped[str] = mapped_column(String(32), nullable=False)
    source_doc_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    memo: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[JournalStatus] = mapped_column(
        SQLEnum(JournalStatus, native_enum=False, length=16, name="gl_journal_status"),
        nullable=False,
        default=JournalStatus.POSTED,
    )
    reversal_of_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("gl_journals.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    lines: Mapped[list[GLJournalLine]] = relationship(
        back_populates="journal", cascade="all, delete-orphan"
    )


class GLJournalLine(Base):
    __tablename__ = "gl_journal_lines"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    journal_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("gl_journals.id", ondelete="CASCADE"), nullable=False, index=True
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("gl_accounts.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    debit: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    credit: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EGP")
    fx_rate: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False, default=Decimal("1"))
    base_debit: Mapped[Decimal] = mapped_column(
        Numeric(18, 4), nullable=False, default=Decimal("0")
    )
    base_credit: Mapped[Decimal] = mapped_column(
        Numeric(18, 4), nullable=False, default=Decimal("0")
    )
    dimensions: Mapped[Any | None] = mapped_column(JSON, nullable=True)

    journal: Mapped[GLJournal] = relationship(back_populates="lines")

    __table_args__ = (
        CheckConstraint(
            "(debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)",
            name="ck_gl_line_debit_xor_credit",
        ),
    )


class FxRate(Base):
    """One row per (from_ccy, to_ccy, as_of_date). `rate` = 1 from_ccy → rate to_ccy."""

    __tablename__ = "fx_rates"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    from_ccy: Mapped[str] = mapped_column(String(3), nullable=False)
    to_ccy: Mapped[str] = mapped_column(String(3), nullable=False)
    as_of_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    rate: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False)
    source: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("from_ccy", "to_ccy", "as_of_date", name="uq_fx_rate_date"),
        CheckConstraint("rate > 0", name="ck_fx_rate_positive"),
    )


__all__ = [
    "AccountType",
    "FxRate",
    "GLAccount",
    "GLJournal",
    "GLJournalLine",
    "JournalStatus",
    "NormalBalance",
]
