"""Catalog service: bundle composition CRUD with self-reference rejection.

Single-level bundles only — component cannot itself be a BUNDLE (enforced here).
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import BundleCycleError, NotFoundError
from app.models.catalog import BundleComponent, Category
from app.models.product import Product, ProductType


async def _require_product(session: AsyncSession, pid: uuid.UUID) -> Product:
    p = await session.get(Product, pid)
    if p is None:
        raise NotFoundError(f"Product {pid} not found")
    return p


async def list_categories(session: AsyncSession) -> list[Category]:
    return list((await session.execute(select(Category))).scalars().all())


async def create_category(
    session: AsyncSession,
    *,
    code: str,
    name: str,
    parent_id: uuid.UUID | None = None,
) -> Category:
    cat = Category(code=code, name=name, parent_id=parent_id)
    session.add(cat)
    await session.commit()
    await session.refresh(cat)
    return cat


async def list_bundle_components(
    session: AsyncSession, bundle_id: uuid.UUID
) -> list[BundleComponent]:
    stmt = (
        select(BundleComponent)
        .where(BundleComponent.bundle_product_id == bundle_id)
        .order_by(BundleComponent.position)
    )
    return list((await session.execute(stmt)).scalars().all())


async def set_bundle_components(
    session: AsyncSession,
    *,
    bundle_id: uuid.UUID,
    components: list[dict[str, Any]],
) -> list[BundleComponent]:
    """Replace the component set for a bundle.

    Each item: {component_product_id, qty_per, allocation_weight?, position?}
    """
    bundle = await _require_product(session, bundle_id)
    if bundle.product_type != ProductType.BUNDLE:
        raise BundleCycleError(
            f"Product {bundle.sku} is not a BUNDLE",
            details={"product_type": bundle.product_type.value},
        )
    # Wipe existing rows
    existing = await list_bundle_components(session, bundle_id)
    for row in existing:
        await session.delete(row)
    await session.flush()

    new_rows: list[BundleComponent] = []
    for i, item in enumerate(components):
        comp_id = uuid.UUID(str(item["component_product_id"]))
        comp = await _require_product(session, comp_id)
        if comp.id == bundle.id:
            raise BundleCycleError("Bundle cannot include itself as a component")
        if comp.product_type == ProductType.BUNDLE:
            raise BundleCycleError(
                f"Component {comp.sku} is a BUNDLE; nested bundles are not supported",
                details={"component_sku": comp.sku},
            )
        row = BundleComponent(
            bundle_product_id=bundle.id,
            component_product_id=comp.id,
            position=int(item.get("position", i)),
            qty_per=Decimal(str(item["qty_per"])),
            allocation_weight=(
                Decimal(str(item["allocation_weight"]))
                if item.get("allocation_weight") is not None
                else None
            ),
        )
        session.add(row)
        new_rows.append(row)
    await session.commit()
    return new_rows


__all__ = [
    "create_category",
    "list_bundle_components",
    "list_categories",
    "set_bundle_components",
]
