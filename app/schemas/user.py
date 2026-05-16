"""Pydantic schemas for User (fastapi-users)."""

from __future__ import annotations

import uuid

from fastapi_users import schemas
from pydantic import ConfigDict
from pydantic.alias_generators import to_camel


class _CamelBase(schemas.CreateUpdateDictModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


class UserRead(schemas.BaseUser[uuid.UUID]):
    full_name: str | None = None
    mfa_enabled: bool = False

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


class UserCreate(schemas.BaseUserCreate):
    full_name: str | None = None


class UserUpdate(schemas.BaseUserUpdate):
    full_name: str | None = None


__all__ = ["UserCreate", "UserRead", "UserUpdate", "_CamelBase"]
