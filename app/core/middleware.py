"""HTTP middleware: request-id, structured access log, global error handler."""

from __future__ import annotations

import time
import uuid

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response
from structlog.contextvars import bind_contextvars, clear_contextvars

from app.core.logging import get_logger

log = get_logger("http")


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Attach request_id, log start/end, time the request."""

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
        clear_contextvars()
        bind_contextvars(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
        )

        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            duration_ms = (time.perf_counter() - start) * 1000
            log.exception("request_failed", duration_ms=round(duration_ms, 2))
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"detail": "Internal server error", "request_id": request_id},
                headers={"x-request-id": request_id},
            )
        finally:
            clear_contextvars()

        duration_ms = (time.perf_counter() - start) * 1000
        response.headers["x-request-id"] = request_id
        log.info(
            "request_completed",
            request_id=request_id,
            status_code=response.status_code,
            duration_ms=round(duration_ms, 2),
            method=request.method,
            path=request.url.path,
        )
        return response


def install_error_handlers(app: FastAPI) -> None:
    """Install catch-all JSON error handler. Per-domain handlers added later."""

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled_exception", error=str(exc))
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error"},
        )
