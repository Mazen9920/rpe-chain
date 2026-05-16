"""Paymob async httpx client. Reads creds from settings.

Paymob's public API uses an auth-token flow (POST /auth/tokens with `api_key`
returns a JWT). Transactions are paginated via /acceptance/transactions.

This client is intentionally minimal — we only ship endpoints the recon service
needs. Real settlement statements arrive as CSV downloads (see
`settlement_csv.py`).
"""

from __future__ import annotations

from typing import Any

import httpx

from app.core.config import get_settings

API_BASE = "https://accept.paymob.com/api"


class PaymobClient:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> None:
        settings = get_settings()
        self.api_key = api_key or getattr(settings, "paymob_api_key", None) or ""
        self.base_url = base_url or API_BASE
        self._token: str | None = None

    async def _auth(self) -> str:
        if self._token:
            return self._token
        async with httpx.AsyncClient(timeout=20.0) as c:
            r = await c.post(
                f"{self.base_url}/auth/tokens",
                json={"api_key": self.api_key},
            )
            r.raise_for_status()
            self._token = str(r.json()["token"])
            return self._token

    def _headers(self, token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    async def list_transactions(
        self, *, page: int = 1, page_size: int = 100
    ) -> list[dict[str, Any]]:
        token = await self._auth()
        async with httpx.AsyncClient(timeout=30.0) as c:
            r = await c.get(
                f"{self.base_url}/acceptance/transactions",
                params={"page": page, "page_size": page_size},
                headers=self._headers(token),
            )
            r.raise_for_status()
            data = r.json()
            results = data.get("results") if isinstance(data, dict) else data
            return list(results or [])

    async def get_transaction(self, external_id: str) -> dict[str, Any]:
        token = await self._auth()
        async with httpx.AsyncClient(timeout=20.0) as c:
            r = await c.get(
                f"{self.base_url}/acceptance/transactions/{external_id}",
                headers=self._headers(token),
            )
            r.raise_for_status()
            payload: dict[str, Any] = r.json()
            return payload


__all__ = ["API_BASE", "PaymobClient"]
