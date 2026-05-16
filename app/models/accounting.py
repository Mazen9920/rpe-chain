"""Pending GL journals. v0.3.0 GL service consumes PENDING entries and posts to real ledger."""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    JSON,
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


class PendingJournalStatus(enum.StrEnum):
    PENDING = "PENDING"
    POSTED = "POSTED"
    REJECTED = "REJECTED"


class PendingJournalEntry(Base):
    __tablename__ = "pending_journals"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    source_doc_type: Mapped[str] = mapped_column(String(32), nullable=False)
    source_doc_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    event_date: Mapped[date] = mapped_column(Date, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EGP")
    memo: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[PendingJournalStatus] = mapped_column(
        SQLEnum(
            PendingJournalStatus,
            native_enum=False,
            length=16,
            name="pending_journal_status",
        ),
        nullable=False,
        default=PendingJournalStatus.PENDING,
    )
    posted_journal_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    lines: Mapped[list[PendingJournalLine]] = relationship(
        back_populates="entry", cascade="all, delete-orphan"
    )


class PendingJournalLine(Base):
    __tablename__ = "pending_journal_lines"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    entry_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("pending_journals.id", ondelete="CASCADE"), nullable=False, index=True
    )
    account_code: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    debit: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    credit: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EGP")
    dimensions: Mapped[Any | None] = mapped_column(JSON, nullable=True)

    entry: Mapped[PendingJournalEntry] = relationship(back_populates="lines")

    __table_args__ = (
        CheckConstraint(
            "(debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)",
            name="ck_pjline_debit_xor_credit",
        ),
    )


__all__ = [
    "PendingJournalEntry",
    "PendingJournalLine",
    "PendingJournalStatus",
]
