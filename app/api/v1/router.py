"""v1 API router aggregation."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import (
    ap,
    ar,
    banking,
    catalog,
    close,
    gl,
    health,
    inventory,
    mfa,
    payments,
    procurement,
    sales,
    shopify_webhooks,
    standard_costs,
)
from app.core.users import auth_backend, fastapi_users
from app.schemas.user import UserCreate, UserRead, UserUpdate

api_router = APIRouter()

api_router.include_router(health.router)
api_router.include_router(standard_costs.router)
api_router.include_router(catalog.router)
api_router.include_router(inventory.router)
api_router.include_router(sales.router)
api_router.include_router(shopify_webhooks.router)
api_router.include_router(gl.router)
api_router.include_router(procurement.router)
api_router.include_router(ap.router)
api_router.include_router(ar.router)
api_router.include_router(close.router)
api_router.include_router(payments.router)
api_router.include_router(banking.router)

api_router.include_router(
    fastapi_users.get_auth_router(auth_backend),
    prefix="/auth/jwt",
    tags=["auth"],
)
api_router.include_router(
    fastapi_users.get_register_router(UserRead, UserCreate),
    prefix="/auth",
    tags=["auth"],
)
api_router.include_router(
    fastapi_users.get_reset_password_router(),
    prefix="/auth",
    tags=["auth"],
)
api_router.include_router(
    fastapi_users.get_users_router(UserRead, UserUpdate),
    prefix="/users",
    tags=["users"],
)
api_router.include_router(mfa.router)
