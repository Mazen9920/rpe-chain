"""User model + fastapi-users SQLAlchemy adapter base."""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi_users_db_sqlalchemy import SQLAlchemyBaseUserTableUUID
from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class User(SQLAlchemyBaseUserTableUUID, Base):
    """Application user. Inherits id/email/hashed_password/is_active/is_superuser/is_verified."""

    __tablename__ = "users"

    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # MFA / TOTP
    mfa_enabled: Mapped[bool] = mapped_column(default=False, nullable=False)
    totp_secret_encrypted: Mapped[str | None] = mapped_column(String(512), nullable=True)
    recovery_codes_encrypted: Mapped[str | None] = mapped_column(String(2048), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


__all__ = ["User", "uuid"]
