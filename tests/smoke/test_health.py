"""Smoke tests for v0.1.0 — health endpoint and app boot."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_ok(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_openapi_served(client: AsyncClient) -> None:
    resp = await client.get("/openapi.json")
    assert resp.status_code == 200
    body = resp.json()
    assert body["info"]["title"] == "RPE Gear"
    assert body["info"]["version"] == "0.1.1"


@pytest.mark.asyncio
async def test_request_id_header(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/health")
    assert "x-request-id" in resp.headers
    assert len(resp.headers["x-request-id"]) > 0


@pytest.mark.asyncio
async def test_request_id_propagates(client: AsyncClient) -> None:
    rid = "test-request-id-12345"
    resp = await client.get("/api/v1/health", headers={"x-request-id": rid})
    assert resp.headers["x-request-id"] == rid
