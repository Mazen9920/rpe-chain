"""Settings validation tests."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_short_secret_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(
            secret_key="too-short",
            database_url="postgresql+asyncpg://x:y@localhost/z",
        )  # type: ignore[call-arg]


def test_cors_origins_csv_split() -> None:
    s = Settings(
        secret_key="x" * 40,
        database_url="postgresql+asyncpg://x:y@localhost/z",
        cors_origins="http://a.com,http://b.com",
    )  # type: ignore[call-arg]
    assert s.cors_origins_list == ["http://a.com", "http://b.com"]


def test_cors_origins_single() -> None:
    s = Settings(
        secret_key="x" * 40,
        database_url="postgresql+asyncpg://x:y@localhost/z",
        cors_origins="http://only.com",
    )  # type: ignore[call-arg]
    assert s.cors_origins_list == ["http://only.com"]
