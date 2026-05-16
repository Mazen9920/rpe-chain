"""Production order lifecycle tests (v0.4.1)."""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.errors import InvalidStateError
from app.models.costing import BillOfMaterials, BomLine
from app.models.inventory import StockLevel, Warehouse
from app.models.manufacturing import MOStatus, ProductionOrder
from app.models.product import Product, ProductType
from app.services import inventory as inv_svc
from app.services import production as prod_svc

pytestmark = pytest.mark.asyncio


async def _seed(db) -> dict:
    rm1 = Product(sku="RM-A", name="Raw A", product_type=ProductType.RAW)
    rm2 = Product(sku="RM-B", name="Raw B", product_type=ProductType.RAW)
    fg = Product(
        sku="FG-1",
        name="Finished",
        product_type=ProductType.FINISHED,
        is_manufactured=True,
    )
    wh = Warehouse(code="W1", name="Main")
    db.add_all([rm1, rm2, fg, wh])
    await db.flush()

    bom = BillOfMaterials(product_id=fg.id, version=1, is_active=True)
    db.add(bom)
    await db.flush()
    db.add_all(
        [
            BomLine(
                bom_id=bom.id,
                position=0,
                component_product_id=rm1.id,
                qty_per=Decimal("2"),
                scrap_factor_pct=Decimal("0.0000"),
            ),
            BomLine(
                bom_id=bom.id,
                position=1,
                component_product_id=rm2.id,
                qty_per=Decimal("1"),
                scrap_factor_pct=Decimal("0.0000"),
            ),
        ]
    )
    # stock RM at known cost
    await inv_svc.receive(
        db, product_id=rm1.id, warehouse_id=wh.id, qty=Decimal("100"), unit_cost=Decimal("3")
    )
    await inv_svc.receive(
        db, product_id=rm2.id, warehouse_id=wh.id, qty=Decimal("100"), unit_cost=Decimal("5")
    )
    await db.flush()
    return {"rm1": rm1, "rm2": rm2, "fg": fg, "wh": wh, "bom": bom}


async def test_create_mo_explodes_bom(db_session):
    s = await _seed(db_session)
    mo = await prod_svc.create_mo(
        db_session,
        product_id=s["fg"].id,
        qty_planned=Decimal("10"),
        warehouse_id=s["wh"].id,
    )
    assert mo.status == MOStatus.DRAFT
    assert mo.mo_number.startswith("MO")
    components = await prod_svc._components(db_session, mo.id)
    assert len(components) == 2
    qtys = {c.component_product_id: c.qty_required for c in components}
    assert qtys[s["rm1"].id] == Decimal("20.0000")
    assert qtys[s["rm2"].id] == Decimal("10.0000")


async def test_create_mo_requires_active_bom(db_session):
    fg = Product(
        sku="NOBOM",
        name="NoBom",
        product_type=ProductType.FINISHED,
        is_manufactured=True,
    )
    wh = Warehouse(code="W1", name="Main")
    db_session.add_all([fg, wh])
    await db_session.flush()
    with pytest.raises(InvalidStateError):
        await prod_svc.create_mo(
            db_session, product_id=fg.id, qty_planned=Decimal("1"), warehouse_id=wh.id
        )


async def test_release_requires_draft(db_session):
    s = await _seed(db_session)
    mo = await prod_svc.create_mo(
        db_session,
        product_id=s["fg"].id,
        qty_planned=Decimal("5"),
        warehouse_id=s["wh"].id,
    )
    await prod_svc.release_mo(db_session, mo.id)
    assert mo.status == MOStatus.RELEASED
    with pytest.raises(InvalidStateError):
        await prod_svc.release_mo(db_session, mo.id)


async def test_issue_materials_consumes_rm_and_updates_actual_cost(db_session):
    s = await _seed(db_session)
    mo = await prod_svc.create_mo(
        db_session,
        product_id=s["fg"].id,
        qty_planned=Decimal("10"),
        warehouse_id=s["wh"].id,
    )
    await prod_svc.release_mo(db_session, mo.id)
    await prod_svc.issue_materials(db_session, mo.id)
    assert mo.status == MOStatus.IN_PROGRESS
    # 20 of RM1 @3 + 10 of RM2 @5 = 60 + 50 = 110
    assert Decimal(mo.total_actual_cost) == Decimal("110.0000")
    # Stock decremented
    from sqlalchemy import select

    lvl_rm1 = (
        await db_session.execute(select(StockLevel).where(StockLevel.product_id == s["rm1"].id))
    ).scalar_one()
    assert lvl_rm1.on_hand == Decimal("80.0000")


async def test_issue_is_idempotent(db_session):
    s = await _seed(db_session)
    mo = await prod_svc.create_mo(
        db_session,
        product_id=s["fg"].id,
        qty_planned=Decimal("5"),
        warehouse_id=s["wh"].id,
    )
    await prod_svc.release_mo(db_session, mo.id)
    await prod_svc.issue_materials(db_session, mo.id)
    # simulate that journal was posted by stamping issue_journal_id
    import uuid

    mo.issue_journal_id = uuid.uuid4()
    cost_before = Decimal(mo.total_actual_cost)
    await prod_svc.issue_materials(db_session, mo.id)
    assert Decimal(mo.total_actual_cost) == cost_before


async def test_complete_mo_receives_fg_at_std_cost(db_session):
    s = await _seed(db_session)
    mo = await prod_svc.create_mo(
        db_session,
        product_id=s["fg"].id,
        qty_planned=Decimal("10"),
        warehouse_id=s["wh"].id,
    )
    await prod_svc.release_mo(db_session, mo.id)
    await prod_svc.issue_materials(db_session, mo.id)
    await prod_svc.complete_mo(db_session, mo.id, qty_produced=Decimal("10"))
    assert mo.status == MOStatus.DONE
    assert mo.qty_produced == Decimal("10.0000")
    # FG stock should now have 10 units
    from sqlalchemy import select

    lvl_fg = (
        await db_session.execute(select(StockLevel).where(StockLevel.product_id == s["fg"].id))
    ).scalar_one()
    assert lvl_fg.on_hand == Decimal("10.0000")


async def test_close_mo_records_variance_favorable(db_session):
    """If std cost is 0 (no RmCostMonth seeded), variance = actual - 0 = unfavorable."""
    s = await _seed(db_session)
    mo = await prod_svc.create_mo(
        db_session,
        product_id=s["fg"].id,
        qty_planned=Decimal("10"),
        warehouse_id=s["wh"].id,
    )
    await prod_svc.release_mo(db_session, mo.id)
    await prod_svc.issue_materials(db_session, mo.id)
    await prod_svc.complete_mo(db_session, mo.id, qty_produced=Decimal("10"))
    await prod_svc.close_mo(db_session, mo.id)
    assert mo.status == MOStatus.CLOSED
    # std cost 0 -> variance = total_actual_cost - 0 = 110 (unfavorable)
    assert Decimal(mo.variance) == Decimal("110.0000")


async def test_cancel_mo_only_from_draft_or_released(db_session):
    s = await _seed(db_session)
    mo = await prod_svc.create_mo(
        db_session,
        product_id=s["fg"].id,
        qty_planned=Decimal("5"),
        warehouse_id=s["wh"].id,
    )
    await prod_svc.cancel_mo(db_session, mo.id)
    assert mo.status == MOStatus.CANCELLED

    mo2 = await prod_svc.create_mo(
        db_session,
        product_id=s["fg"].id,
        qty_planned=Decimal("5"),
        warehouse_id=s["wh"].id,
    )
    await prod_svc.release_mo(db_session, mo2.id)
    await prod_svc.issue_materials(db_session, mo2.id)
    with pytest.raises(InvalidStateError):
        await prod_svc.cancel_mo(db_session, mo2.id)


async def test_full_lifecycle_wip_balance(db_session):
    s = await _seed(db_session)
    mo = await prod_svc.create_mo(
        db_session,
        product_id=s["fg"].id,
        qty_planned=Decimal("10"),
        warehouse_id=s["wh"].id,
    )
    await prod_svc.release_mo(db_session, mo.id)
    await prod_svc.issue_materials(db_session, mo.id)
    # In progress, no completion yet -> WIP balance = 110
    wip = await prod_svc.wip_balance(db_session)
    assert wip == Decimal("110.0000")
    await prod_svc.complete_mo(db_session, mo.id, qty_produced=Decimal("10"))
    await prod_svc.close_mo(db_session, mo.id)
    # CLOSED -> no longer counts toward open WIP
    wip_after = await prod_svc.wip_balance(db_session)
    assert wip_after == Decimal("0")
    summary = await prod_svc.open_mo_summary(db_session)
    assert summary["CLOSED"] == 1


async def test_summary_counts(db_session):
    s = await _seed(db_session)
    for _ in range(3):
        await prod_svc.create_mo(
            db_session,
            product_id=s["fg"].id,
            qty_planned=Decimal("1"),
            warehouse_id=s["wh"].id,
        )
    counts = await prod_svc.open_mo_summary(db_session)
    assert counts["DRAFT"] == 3
    # Verify ProductionOrder query works
    from sqlalchemy import select

    rows = (await db_session.execute(select(ProductionOrder))).scalars().all()
    assert len(list(rows)) == 3
