"""Shopify httpx async client. Version-pinned. Reads creds from settings."""

from __future__ import annotations

from typing import Any

import httpx

from app.core.config import get_settings

API_VERSION = "2024-10"


class ShopifyClient:
    def __init__(self, *, shop_domain: str | None = None, access_token: str | None = None) -> None:
        settings = get_settings()
        self.shop_domain = shop_domain or getattr(settings, "shopify_shop_domain", None) or ""
        self.access_token = access_token or getattr(settings, "shopify_access_token", None) or ""

    @property
    def base_url(self) -> str:
        return f"https://{self.shop_domain}/admin/api/{API_VERSION}"

    def _headers(self) -> dict[str, str]:
        return {
            "X-Shopify-Access-Token": self.access_token,
            "Content-Type": "application/json",
        }

    async def post(self, path: str, payload: dict[str, Any]) -> httpx.Response:
        async with httpx.AsyncClient(timeout=20.0) as c:
            return await c.post(f"{self.base_url}{path}", json=payload, headers=self._headers())

    async def put(self, path: str, payload: dict[str, Any]) -> httpx.Response:
        async with httpx.AsyncClient(timeout=20.0) as c:
            return await c.put(f"{self.base_url}{path}", json=payload, headers=self._headers())

    async def get(self, path: str) -> httpx.Response:
        async with httpx.AsyncClient(timeout=20.0) as c:
            return await c.get(f"{self.base_url}{path}", headers=self._headers())


__all__ = ["API_VERSION", "ShopifyClient"]
