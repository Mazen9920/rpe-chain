"""Idempotent dev seed: F8-V2 finished good with realistic BOM + Jan-2026 cost inputs."""

from __future__ import annotations

import asyncio
from datetime import date
from decimal import Decimal

from sqlalchemy import select

from app.core.db import SessionLocal
from app.models.costing import (
    BillOfMaterials,
    BomLine,
    CostingSettings,
    MfgFeeMonth,
    OtherCostMonth,
    OtherCostType,
    RmCostMonth,
)
from app.models.product import Product, ProductType

JAN_2026 = date(2026, 1, 1)


async def _get_or_create_product(session, sku: str, **kwargs) -> Product:
    row = (await session.execute(select(Product).where(Product.sku == sku))).scalar_one_or_none()
    if row is None:
        row = Product(sku=sku, **kwargs)
        session.add(row)
        await session.flush()
    return row


async def _ensure_rm_cost(session, product_id, month, unit_cost: Decimal) -> None:
    row = (
        await session.execute(
            select(RmCostMonth).where(
                RmCostMonth.product_id == product_id, RmCostMonth.month_start == month
            )
        )
    ).scalar_one_or_none()
    if row is None:
        session.add(
            RmCostMonth(
                product_id=product_id,
                month_start=month,
                unit_cost=unit_cost,
                currency="EGP",
            )
        )


async def _ensure_mfg_fee(session, product_id, month, amount: Decimal) -> None:
    row = (
        await session.execute(
            select(MfgFeeMonth).where(
                MfgFeeMonth.product_id == product_id, MfgFeeMonth.month_start == month
            )
        )
    ).scalar_one_or_none()
    if row is None:
        session.add(
            MfgFeeMonth(
                product_id=product_id,
                month_start=month,
                fee_amount=amount,
                currency="EGP",
            )
        )


async def _ensure_other_cost(
    session, product_id, month, cost_type: OtherCostType, amount: Decimal
) -> None:
    row = (
        await session.execute(
            select(OtherCostMonth).where(
                OtherCostMonth.product_id == product_id,
                OtherCostMonth.month_start == month,
                OtherCostMonth.cost_type == cost_type,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        session.add(
            OtherCostMonth(
                product_id=product_id,
                month_start=month,
                cost_type=cost_type,
                amount=amount,
                currency="EGP",
            )
        )


async def seed() -> dict:
    async with SessionLocal() as session:
        # Singleton settings
        settings = await session.get(CostingSettings, 1)
        if settings is None:
            session.add(
                CostingSettings(id=1, cutover_date=None, stale_after_days=7, default_currency="EGP")
            )

        # Raw materials
        shell = await _get_or_create_product(
            session,
            sku="RM-SHELL",
            name="Half-mask shell",
            uom="EA",
            product_type=ProductType.RAW,
        )
        filt = await _get_or_create_product(
            session,
            sku="RM-FILTER",
            name="P100 filter cartridge",
            uom="EA",
            product_type=ProductType.RAW,
        )
        box = await _get_or_create_product(
            session,
            sku="PKG-BOX",
            name="Retail box",
            uom="EA",
            product_type=ProductType.PACKAGING,
        )

        # Finished good
        f8v2 = await _get_or_create_product(
            session,
            sku="F8-V2",
            name="F8-V2 Half-Mask Respirator Kit",
            uom="EA",
            product_type=ProductType.FINISHED,
            is_manufactured=True,
        )

        # BOM for F8-V2 (active version 1)
        bom = (
            await session.execute(
                select(BillOfMaterials).where(
                    BillOfMaterials.product_id == f8v2.id,
                    BillOfMaterials.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()
        if bom is None:
            bom = BillOfMaterials(product_id=f8v2.id, version=1, is_active=True)
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

        # Jan 2026 cost inputs
        await _ensure_rm_cost(session, shell.id, JAN_2026, Decimal("30.0000"))
        await _ensure_rm_cost(session, filt.id, JAN_2026, Decimal("15.0000"))
        await _ensure_rm_cost(session, box.id, JAN_2026, Decimal("5.0000"))
        await _ensure_mfg_fee(session, f8v2.id, JAN_2026, Decimal("8.5000"))
        await _ensure_other_cost(
            session, f8v2.id, JAN_2026, OtherCostType.PACKAGING, Decimal("2.0000")
        )
        await _ensure_other_cost(
            session, f8v2.id, JAN_2026, OtherCostType.LABOR, Decimal("12.0000")
        )

        await session.commit()
        return {"products_seeded": 4, "month_start": JAN_2026.isoformat()}


def main() -> None:
    result = asyncio.run(seed())
    print(result)


if __name__ == "__main__":
    main()
