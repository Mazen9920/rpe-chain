"""Bundle composition + ATP + line expansion tests."""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.errors import BundleCycleError
from app.models.catalog import BundleComponent
from app.models.inventory import Warehouse
from app.models.product import Product, ProductType
from app.services import bundle as bundle_svc
from app.services import catalog as cat_svc
from app.services import inventory as inv

pytestmark = pytest.mark.asyncio


async def _bundle_setup(db):
    bundle = Product(sku="BNDL", name="All Wraps Bundle", product_type=ProductType.BUNDLE, uom="EA")
    a = Product(
        sku="A", name="A", product_type=ProductType.FINISHED, uom="EA", selling_price=Decimal("10")
    )
    b = Product(
        sku="B", name="B", product_type=ProductType.FINISHED, uom="EA", selling_price=Decimal("20")
    )
    w = Warehouse(code="WH", name="Main")
    db.add_all([bundle, a, b, w])
    await db.flush()
    await cat_svc.set_bundle_components(
        db,
        bundle_id=bundle.id,
        components=[
            {"component_product_id": a.id, "qty_per": Decimal("2"), "position": 0},
            {"component_product_id": b.id, "qty_per": Decimal("1"), "position": 1},
        ],
    )
    await db.flush()
    return bundle, a, b, w


async def test_set_bundle_components_rejects_nested_bundle(db_session):
    bundle = Product(sku="BX", name="X", product_type=ProductType.BUNDLE, uom="EA")
    nested = Product(sku="BN", name="N", product_type=ProductType.BUNDLE, uom="EA")
    db_session.add_all([bundle, nested])
    await db_session.flush()
    with pytest.raises(BundleCycleError):
        await cat_svc.set_bundle_components(
            db_session,
            bundle_id=bundle.id,
            components=[
                {"component_product_id": nested.id, "qty_per": Decimal("1"), "position": 0}
            ],
        )


async def test_set_bundle_components_rejects_self(db_session):
    b = Product(sku="BS", name="S", product_type=ProductType.BUNDLE, uom="EA")
    db_session.add(b)
    await db_session.flush()
    with pytest.raises(BundleCycleError):
        await cat_svc.set_bundle_components(
            db_session,
            bundle_id=b.id,
            components=[{"component_product_id": b.id, "qty_per": Decimal("1"), "position": 0}],
        )


async def test_compute_bundle_atp_floor(db_session):
    bundle, a, b, w = await _bundle_setup(db_session)
    await inv.receive(
        db_session,
        product_id=a.id,
        warehouse_id=w.id,
        qty=Decimal("9"),
        unit_cost=Decimal("1"),
    )
    await inv.receive(
        db_session,
        product_id=b.id,
        warehouse_id=w.id,
        qty=Decimal("5"),
        unit_cost=Decimal("1"),
    )
    await db_session.flush()
    # A: 9 / 2 = 4   B: 5 / 1 = 5   min = 4
    atp = await bundle_svc.compute_bundle_atp(db_session, bundle.id, w.id)
    assert atp == 4


async def test_expand_bundle_lines_creates_children(db_session):

    from app.models.sales import Customer, SalesOrder, SalesOrderLine, SalesOrderStatus

    bundle, _a, _b, w = await _bundle_setup(db_session)
    cust = Customer(code="C1", name="Cust")
    db_session.add(cust)
    await db_session.flush()
    order = SalesOrder(
        order_number="SO-T1",
        customer_id=cust.id,
        warehouse_id=w.id,
        status=SalesOrderStatus.RECEIVED,
        currency="EGP",
    )
    db_session.add(order)
    await db_session.flush()
    parent = SalesOrderLine(
        order_id=order.id,
        position=0,
        product_id=bundle.id,
        qty=Decimal("3"),
        unit_price=Decimal("40"),
        line_total=Decimal("120"),
    )
    db_session.add(parent)
    await db_session.flush()
    children = await bundle_svc.expand_bundle_lines(db_session, parent)
    await db_session.flush()
    assert len(children) == 2
    # children qty: a*qty_per*parent.qty = 2*3=6, b=1*3=3
    qtys = sorted(int(c.qty) for c in children)
    assert qtys == [3, 6]
    # revenue allocation sums to parent line_total
    total = sum(c.line_total for c in children)
    assert total == Decimal("120.0000")
    # parent flagged
    await db_session.refresh(parent)
    assert parent.is_bundle_parent is True
    _ = BundleComponent  # silence unused
