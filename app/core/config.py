"""Application configuration via Pydantic Settings."""

from __future__ import annotations

from functools import cached_property, lru_cache
from typing import Literal

from pydantic import computed_field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Loaded once from environment + .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_env: Literal["dev", "test", "staging", "prod"] = "dev"
    secret_key: str
    encryption_key: str = ""  # Fernet key for symmetric encryption at rest

    database_url: str
    database_url_sync: str = ""

    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"

    access_token_ttl_seconds: int = 900
    refresh_token_ttl_seconds: int = 2_592_000
    totp_issuer: str = "RPE-Gear"

    log_level: str = "INFO"
    cors_origins: str = "http://localhost:5173"

    @computed_field  # type: ignore[prop-decorator]
    @cached_property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @field_validator("secret_key")
    @classmethod
    def _secret_min_length(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError("SECRET_KEY must be at least 32 characters")
        return v


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached settings instance."""
    return Settings()
