"""Bosta async httpx client.

Bosta's merchant API uses a simple API-key bearer header. We expose only the
endpoints the COD ledger needs: list deliveries (status sync) and fetch a
single delivery by tracking number.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.core.config import get_settings

API_BASE = "https://app.bosta.co/api/v2"


class BostaClient:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> None:
        settings = get_settings()
        self.api_key = api_key or getattr(settings, "bosta_api_key", None) or ""
        self.base_url = base_url or API_BASE

    def _headers(self) -> dict[str, str]:
        return {"Authorization": self.api_key, "Content-Type": "application/json"}

    async def list_deliveries(
        self, *, page: int = 1, page_size: int = 100, status: str | None = None
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"pageNumber": page, "pageSize": page_size}
        if status:
            params["state"] = status
        async with httpx.AsyncClient(timeout=30.0) as c:
            r = await c.get(
                f"{self.base_url}/deliveries",
                params=params,
                headers=self._headers(),
            )
            r.raise_for_status()
            data = r.json()
            results = data.get("data", {}).get("list") if isinstance(data, dict) else data
            return list(results or [])

    async def get_delivery(self, tracking_id: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=20.0) as c:
            r = await c.get(
                f"{self.base_url}/deliveries/business/{tracking_id}",
                headers=self._headers(),
            )
            r.raise_for_status()
            payload: dict[str, Any] = r.json()
            return payload


__all__ = ["API_BASE", "BostaClient"]
