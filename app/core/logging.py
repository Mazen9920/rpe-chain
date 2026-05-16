"""Structured JSON logging via structlog with correlation IDs."""

from __future__ import annotations

import logging
import sys

import structlog
from structlog.contextvars import merge_contextvars
from structlog.processors import (
    JSONRenderer,
    TimeStamper,
    add_log_level,
    format_exc_info,
)
from structlog.stdlib import ProcessorFormatter
from structlog.types import EventDict


def _drop_secrets(_: object, __: str, event_dict: EventDict) -> EventDict:
    """Redact common secret keys before they hit the renderer."""
    for k in list(event_dict.keys()):
        if any(s in k.lower() for s in ("password", "secret", "token", "authorization")):
            event_dict[k] = "***REDACTED***"
    return event_dict


def configure_logging(level: str = "INFO") -> None:
    """Configure structlog + stdlib so uvicorn/celery logs route through structlog."""
    level_int = logging.getLevelName(level.upper())
    if not isinstance(level_int, int):
        level_int = logging.INFO

    shared_processors: list[structlog.types.Processor] = [
        merge_contextvars,
        add_log_level,
        TimeStamper(fmt="iso", utc=True),
        format_exc_info,
        _drop_secrets,
    ]

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    formatter = ProcessorFormatter(
        foreign_pre_chain=shared_processors,
        processors=[
            ProcessorFormatter.remove_processors_meta,
            JSONRenderer(),
        ],
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level_int)

    # Tame noisy libraries
    for noisy in ("uvicorn.access",):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Helper to grab a bound logger."""
    return structlog.get_logger(name)  # type: ignore[no-any-return]
