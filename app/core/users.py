"""fastapi-users wiring: user manager, JWT strategy, auth backends, routers."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from typing import Any

from fastapi import Depends
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin
from fastapi_users.authentication import (
    AuthenticationBackend,
    BearerTransport,
    JWTStrategy,
)
from fastapi_users.db import SQLAlchemyUserDatabase
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_db
from app.core.logging import get_logger
from app.models.user import User

_settings = get_settings()
log = get_logger("auth")


async def get_user_db(
    session: AsyncSession = Depends(get_db),
) -> AsyncIterator[SQLAlchemyUserDatabase[User, uuid.UUID]]:
    yield SQLAlchemyUserDatabase(session, User)


class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    reset_password_token_secret = _settings.secret_key
    verification_token_secret = _settings.secret_key

    async def on_after_register(
        self,
        user: User,
        request: Any | None = None,
    ) -> None:
        log.info("user_registered", user_id=str(user.id), email=user.email)

    async def on_after_login(
        self,
        user: User,
        request: Any | None = None,
        response: Any | None = None,
    ) -> None:
        log.info("user_login", user_id=str(user.id))


async def get_user_manager(
    user_db: SQLAlchemyUserDatabase[User, uuid.UUID] = Depends(get_user_db),
) -> AsyncIterator[UserManager]:
    yield UserManager(user_db)


bearer_transport = BearerTransport(tokenUrl="api/v1/auth/jwt/login")


def get_jwt_strategy() -> JWTStrategy[User, uuid.UUID]:
    return JWTStrategy(
        secret=_settings.secret_key,
        lifetime_seconds=_settings.access_token_ttl_seconds,
    )


auth_backend = AuthenticationBackend(
    name="jwt",
    transport=bearer_transport,
    get_strategy=get_jwt_strategy,
)

fastapi_users = FastAPIUsers[User, uuid.UUID](get_user_manager, [auth_backend])

current_active_user = fastapi_users.current_user(active=True)
current_superuser = fastapi_users.current_user(active=True, superuser=True)
