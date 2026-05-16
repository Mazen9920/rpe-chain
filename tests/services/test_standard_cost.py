"""Unit tests for the standard-cost engine.

These exercise Decimal math exactness, all 5 statuses, idempotency, locking, cycle
detection, scrap math, and the COGS selector. SQLite in-memory via conftest fixtures.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.errors import BomCycleError, MonthLockedError
from app.models.costing import (
    BillOfMaterials,
    BomLine,
    CostingSettings,
    MfgFeeMonth,
    OtherCostMonth,
    OtherCostType,
    RmCostMonth,
    StandardCost,
    StandardCostStatus,
)
from app.models.product import Product, ProductType
from app.services.standard_cost import (
    compute_standard_cost,
    get_cost_for_cogs,
    lock_month,
    mark_stale_if_needed,
    quantize_money,
    recompute_all_for_month,
    unlock_month,
)

JAN = date(2026, 1, 1)
FEB = date(2026, 2, 1)


async def _make_f8v2(session) -> dict:
    """Build the canonical F8-V2 fixture used across tests."""
    shell = Product(sku="RM-SHELL", name="Shell", product_type=ProductType.RAW)
    filt = Product(sku="RM-FILTER", name="Filter", product_type=ProductType.RAW)
    box = Product(sku="PKG-BOX", name="Box", product_type=ProductType.PACKAGING)
    f8 = Product(
        sku="F8-V2",
        name="F8-V2 Kit",
        product_type=ProductType.FINISHED,
        is_manufactured=True,
    )
    session.add_all([shell, filt, box, f8])
    await session.flush()

    bom = BillOfMaterials(product_id=f8.id, version=1, is_active=True)
    session.add(bom)
    await session.flush()
    session.add_all(
        [
            BomLine(
                bom_id=bom.id,
                position=0,
                component_product_id=shell.id,
                qty_per=Decimal("1"),
                scrap_factor_pct=Decimal("0.0000"),
            ),
            BomLine(
                bom_id=bom.id,
                position=1,
                component_product_id=filt.id,
                qty_per=Decimal("2"),
                scrap_factor_pct=Decimal("0.0250"),
            ),
            BomLine(
                bom_id=bom.id,
                position=2,
                component_product_id=box.id,
                qty_per=Decimal("1"),
                scrap_factor_pct=Decimal("0.0100"),
            ),
        ]
    )
    session.add_all(
        [
            RmCostMonth(product_id=shell.id, month_start=JAN, unit_cost=Decimal("30.0000")),
            RmCostMonth(product_id=filt.id, month_start=JAN, unit_cost=Decimal("15.0000")),
            RmCostMonth(product_id=box.id, month_start=JAN, unit_cost=Decimal("5.0000")),
            MfgFeeMonth(product_id=f8.id, month_start=JAN, fee_amount=Decimal("8.5000")),
            OtherCostMonth(
                product_id=f8.id,
                month_start=JAN,
                cost_type=OtherCostType.PACKAGING,
                amount=Decimal("2.0000"),
            ),
            OtherCostMonth(
                product_id=f8.id,
                month_start=JAN,
                cost_type=OtherCostType.LABOR,
                amount=Decimal("12.0000"),
            ),
        ]
    )
    await session.flush()
    return {"shell": shell, "filt": filt, "box": box, "f8": f8}


async def test_compute_status_ok_with_exact_decimal_math(db_session):
    f = await _make_f8v2(db_session)
    row = await compute_standard_cost(db_session, f["f8"].id, JAN)

    # Expected (Decimal, no float drift):
    #   shell line = 1     * (1+0.0000) * 30 = 30.0000
    #   filter line = 2    * (1+0.0250) * 15 = 30.7500
    #   box line = 1       * (1+0.0100) * 5  =  5.0500
    #   rm_subtotal                            65.8000
    #   mfg_fee                                 8.5000
    #   other (pkg+labor)                      14.0000
    #   unit_cost                              88.3000
    expected_rm = Decimal("30.0000") + Decimal("30.7500") + Decimal("5.0500")
    expected_unit = quantize_money(expected_rm + Decimal("8.5000") + Decimal("14.0000"))

    assert row.status == StandardCostStatus.OK
    assert row.rm_subtotal == quantize_money(expected_rm)
    assert row.mfg_fee == Decimal("8.5000")
    assert row.other_subtotal == Decimal("14.0000")
    assert row.unit_cost == expected_unit
    assert row.breakdown is not None
    assert isinstance(row.breakdown, dict)
    assert row.breakdown["sku"] == "F8-V2"
    assert len(row.breakdown["lines"]) == 3


async def test_status_missing_rm_prices(db_session):
    f = await _make_f8v2(db_session)
    # Wipe filter's RM cost
    await db_session.delete(
        (
            await db_session.execute(
                select(RmCostMonth).where(RmCostMonth.product_id == f["filt"].id)
            )
        ).scalar_one()
    )
    await db_session.flush()
    row = await compute_standard_cost(db_session, f["f8"].id, JAN)
    assert row.status == StandardCostStatus.MISSING_RM_PRICES
    assert row.unit_cost is None
    assert any(m["sku"] == "RM-FILTER" for m in row.missing_inputs)


async def test_status_missing_mfg_fee(db_session):
    f = await _make_f8v2(db_session)
    await db_session.delete(
        (
            await db_session.execute(
                select(MfgFeeMonth).where(MfgFeeMonth.product_id == f["f8"].id)
            )
        ).scalar_one()
    )
    await db_session.flush()
    row = await compute_standard_cost(db_session, f["f8"].id, JAN)
    assert row.status == StandardCostStatus.MISSING_MFG_FEE
    assert row.unit_cost is None
    assert row.rm_subtotal is not None


async def test_status_stale_via_mark(db_session):
    f = await _make_f8v2(db_session)
    row = await compute_standard_cost(db_session, f["f8"].id, JAN)
    # Backdate computed_at well past stale threshold
    settings = await db_session.get(CostingSettings, 1)
    if settings is None:
        settings = CostingSettings(id=1)
        db_session.add(settings)
        await db_session.flush()
    row.computed_at = datetime.now(UTC) - timedelta(days=settings.stale_after_days + 1)
    await db_session.flush()

    affected = await mark_stale_if_needed(db_session)
    assert affected >= 1
    refreshed = await db_session.get(StandardCost, row.id)
    assert refreshed.status == StandardCostStatus.STALE


async def test_status_locked(db_session):
    f = await _make_f8v2(db_session)
    await compute_standard_cost(db_session, f["f8"].id, JAN)
    await db_session.flush()
    counts = await lock_month(db_session, JAN)
    assert counts["standard_costs"] >= 1
    refreshed = (
        await db_session.execute(
            select(StandardCost).where(
                StandardCost.product_id == f["f8"].id, StandardCost.month_start == JAN
            )
        )
    ).scalar_one()
    assert refreshed.is_locked is True
    assert refreshed.status == StandardCostStatus.LOCKED


async def test_compute_is_idempotent(db_session):
    f = await _make_f8v2(db_session)
    r1 = await compute_standard_cost(db_session, f["f8"].id, JAN)
    r2 = await compute_standard_cost(db_session, f["f8"].id, JAN)
    assert r1.id == r2.id
    assert r1.unit_cost == r2.unit_cost


async def test_locked_month_blocks_upserts(db_session):
    from app.crud import standard_cost as crud

    f = await _make_f8v2(db_session)
    await lock_month(db_session, JAN)
    with pytest.raises(MonthLockedError):
        await crud.upsert_rm_cost(
            db_session,
            f["shell"].id,
            JAN,
            {"unit_cost": Decimal("99.0000"), "currency": "EGP"},
        )


async def test_bom_cycle_detected(db_session):
    # A → B → A
    a = Product(sku="A", name="A", product_type=ProductType.FINISHED, is_manufactured=True)
    b = Product(sku="B", name="B", product_type=ProductType.FINISHED, is_manufactured=True)
    db_session.add_all([a, b])
    await db_session.flush()
    bom_a = BillOfMaterials(product_id=a.id, version=1, is_active=True)
    bom_b = BillOfMaterials(product_id=b.id, version=1, is_active=True)
    db_session.add_all([bom_a, bom_b])
    await db_session.flush()
    db_session.add_all(
        [
            BomLine(
                bom_id=bom_a.id,
                position=0,
                component_product_id=b.id,
                qty_per=Decimal("1"),
                scrap_factor_pct=Decimal("0"),
            ),
            BomLine(
                bom_id=bom_b.id,
                position=0,
                component_product_id=a.id,
                qty_per=Decimal("1"),
                scrap_factor_pct=Decimal("0"),
            ),
        ]
    )
    db_session.add_all(
        [
            MfgFeeMonth(product_id=a.id, month_start=JAN, fee_amount=Decimal("1")),
            MfgFeeMonth(product_id=b.id, month_start=JAN, fee_amount=Decimal("1")),
        ]
    )
    await db_session.flush()
    with pytest.raises(BomCycleError):
        await compute_standard_cost(db_session, a.id, JAN)


async def test_scrap_math_decimal_exact(db_session):
    p = Product(sku="X", name="X", product_type=ProductType.RAW)
    db_session.add(p)
    await db_session.flush()
    db_session.add(RmCostMonth(product_id=p.id, month_start=JAN, unit_cost=Decimal("100.0000")))
    await db_session.flush()
    row = await compute_standard_cost(db_session, p.id, JAN)
    # Leaf RAW with no BOM and no fee → unit_cost = RM cost exactly
    assert row.unit_cost == Decimal("100.0000")


async def test_get_cost_for_cogs_walks_back(db_session):
    f = await _make_f8v2(db_session)
    await compute_standard_cost(db_session, f["f8"].id, JAN)
    await db_session.flush()
    # No Feb compute yet — selector with Feb date should walk back to Jan
    feb15 = date(2026, 2, 15)
    cost = await get_cost_for_cogs(db_session, f["f8"].id, feb15)
    # 30 + (2 * 1.025 * 15) + (1 * 1.01 * 5) + 8.5 + (2 + 12) = 88.3000
    assert cost == Decimal("88.3000")


async def test_get_cost_for_cogs_returns_none(db_session):
    p = Product(sku="ZZ", name="ZZ", product_type=ProductType.RAW)
    db_session.add(p)
    await db_session.flush()
    cost = await get_cost_for_cogs(db_session, p.id, JAN)
    assert cost is None


async def test_recompute_all_for_month_topo(db_session):
    await _make_f8v2(db_session)
    summary = await recompute_all_for_month(db_session, JAN)
    assert summary["count"] == 4
    # 3 RAW/PACKAGING leaves OK + 1 FINISHED OK
    assert summary["by_status"]["OK"] == 4


async def test_unlock_month_idempotent(db_session):
    f = await _make_f8v2(db_session)
    await compute_standard_cost(db_session, f["f8"].id, JAN)
    await lock_month(db_session, JAN)
    counts = await unlock_month(db_session, JAN, force=True, actor_id=f["f8"].id)
    assert counts["standard_costs"] >= 1
