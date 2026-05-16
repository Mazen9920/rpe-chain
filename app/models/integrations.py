"""Integration substrate: idempotency keys, raw events store, outbox."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class IntegrationSource(enum.StrEnum):
    SHOPIFY = "SHOPIFY"
    BOSTA = "BOSTA"
    PAYMOB = "PAYMOB"
    BANK = "BANK"


class OutboxStatus(enum.StrEnum):
    PENDING = "PENDING"
    IN_FLIGHT = "IN_FLIGHT"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"


class IdempotencyKey(Base):
    __tablename__ = "idempotency_keys"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    scope: Mapped[str] = mapped_column(String(64), nullable=False)
    key: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (UniqueConstraint("scope", "key", name="uq_idempotency_scope_key"),)


class IntegrationEvent(Base):
    __tablename__ = "integration_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    source: Mapped[IntegrationSource] = mapped_column(
        SQLEnum(IntegrationSource, native_enum=False, length=16, name="integration_source"),
        nullable=False,
    )
    topic: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    external_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    raw_payload: Mapped[Any] = mapped_column(JSON, nullable=False)
    signature_ok: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str | None] = mapped_column(String(1024), nullable=True)


class IntegrationOutbox(Base):
    __tablename__ = "integration_outbox"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    target: Mapped[IntegrationSource] = mapped_column(
        SQLEnum(IntegrationSource, native_enum=False, length=16, name="outbox_target"),
        nullable=False,
        index=True,
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[Any] = mapped_column(JSON, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[OutboxStatus] = mapped_column(
        SQLEnum(OutboxStatus, native_enum=False, length=16, name="outbox_status"),
        nullable=False,
        default=OutboxStatus.PENDING,
        index=True,
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    last_error: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    succeeded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("target", "idempotency_key", name="uq_outbox_target_idem"),
        CheckConstraint("attempts >= 0", name="ck_outbox_attempts_nonneg"),
    )


__all__ = [
    "IdempotencyKey",
    "IntegrationEvent",
    "IntegrationOutbox",
    "IntegrationSource",
    "OutboxStatus",
]
