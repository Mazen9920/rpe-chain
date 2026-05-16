"""Application error hierarchy with FastAPI handler registration."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse


class AppError(Exception):
    """Base for domain errors with deterministic HTTP mapping."""

    status_code: int = status.HTTP_400_BAD_REQUEST
    code: str = "app_error"

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class MonthLockedError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "month_locked"


class BomCycleError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "bom_cycle"


class BundleCycleError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "bundle_cycle"


class NotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "not_found"


class CogsCostUnavailableError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "cogs_cost_unavailable"


class InsufficientStockError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "insufficient_stock"


class InvalidStateError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "invalid_state"


class StockConcurrencyError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "stock_concurrency"


def install_app_error_handler(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _handle(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"code": exc.code, "message": exc.message, "details": exc.details},
        )
