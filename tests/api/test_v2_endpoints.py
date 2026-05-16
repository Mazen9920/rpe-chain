"""API smoke for v0.2.0 endpoints (catalog, inventory, sales)."""

from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models.inventory import Warehouse
from app.models.product import Product, ProductType
from app.models.sales import Customer

pytestmark = pytest.mark.asyncio


async def test_list_warehouses_requires_auth(client):
    r = await client.get("/api/v1/warehouses")
    assert r.status_code == 401


async def test_bundle_atp_endpoint(db_session, client, monkeypatch):
    # bypass auth by directly hitting service-level logic — instead just create data and
    # call the function-style approach: skip auth via dependency override below.
    from app.core.users import current_active_user
    from app.main import app

    async def _u():
        from app.models.user import User

        u = User(email="x@example.com", hashed_password="!", is_active=True, is_superuser=True)
        return u

    app.dependency_overrides[current_active_user] = _u

    a = Product(
        sku="AA", name="A", product_type=ProductType.FINISHED, uom="EA", selling_price=Decimal("1")
    )
    b = Product(
        sku="BB", name="B", product_type=ProductType.FINISHED, uom="EA", selling_price=Decimal("1")
    )
    bundle = Product(sku="BX", name="BX", product_type=ProductType.BUNDLE, uom="EA")
    wh = Warehouse(code="WX", name="X")
    db_session.add_all([a, b, bundle, wh])
    await db_session.flush()

    from app.services import catalog as cat_svc

    await cat_svc.set_bundle_components(
        db_session,
        bundle_id=bundle.id,
        components=[
            {"component_product_id": a.id, "qty_per": Decimal("1")},
            {"component_product_id": b.id, "qty_per": Decimal("1")},
        ],
    )
    await db_session.commit()

    r = await client.get(
        f"/api/v1/catalog/bundles/{bundle.id}/atp",
        params={"warehouse_id": str(wh.id)},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["atp"] == 0
    _ = Customer
    _ = select
    app.dependency_overrides.pop(current_active_user, None)
