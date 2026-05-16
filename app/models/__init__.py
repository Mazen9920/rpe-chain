"""Re-export ORM models for Alembic autogenerate."""

from app.models.user import User

__all__ = ["User"]
