"""API smoke tests for standard-cost routes (auth, lock guard, basic round-trip)."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from app.models.costing import RmCostMonth
from app.models.product import Product, ProductType


async def _promote_to_superuser(db_session, email: str) -> None:
    from sqlalchemy import select

    from app.models.user import User

    user = (await db_session.execute(select(User).where(User.email == email))).scalar_one()
    user.is_superuser = True
    await db_session.commit()


async def _login(client, email: str, password: str) -> str:
    r = await client.post(
        "/api/v1/auth/jwt/login",
        data={"username": email, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def test_standard_costs_requires_auth(client):
    r = await client.get("/api/v1/standard-costs")
    assert r.status_code == 401


async def test_rm_costs_put_requires_superuser(client, db_session):
    email = "user@test.example"
    password = "ReallyStrongPass-1"
    r = await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    assert r.status_code in (200, 201), r.text
    token = await _login(client, email, password)
    pid = uuid.uuid4()
    r = await client.put(
        f"/api/v1/rm-costs/{pid}/2026-01-01",
        json={"unitCost": "10.0000"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403


async def test_full_flow_compute_lock_409(client, db_session):
    shell = Product(sku="RM-SHELL", name="Shell", product_type=ProductType.RAW)
    db_session.add(shell)
    await db_session.flush()
    db_session.add(
        RmCostMonth(product_id=shell.id, month_start=date(2026, 1, 1), unit_cost=Decimal("30.0000"))
    )
    await db_session.commit()

    email = "admin@test.example"
    password = "ReallyStrongPass-1"
    r = await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    assert r.status_code in (200, 201), r.text
    await _promote_to_superuser(db_session, email)
    token = await _login(client, email, password)
    h = {"Authorization": f"Bearer {token}"}

    # Recompute
    r = await client.post(
        "/api/v1/standard-costs/recompute",
        json={"monthStart": "2026-01-01"},
        headers=h,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["count"] == 1
    assert body["byStatus"]["OK"] == 1

    # List
    r = await client.get("/api/v1/standard-costs?month=2026-01-01", headers=h)
    assert r.status_code == 200
    assert len(r.json()) == 1

    # Lock
    r = await client.post(
        "/api/v1/standard-costs/lock",
        json={"monthStart": "2026-01-01"},
        headers=h,
    )
    assert r.status_code == 200

    # PUT against locked month → 409
    r = await client.put(
        f"/api/v1/rm-costs/{shell.id}/2026-01-01",
        json={"unitCost": "99.0000"},
        headers=h,
    )
    assert r.status_code == 409
    assert r.json()["code"] == "month_locked"
