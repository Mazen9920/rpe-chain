"""Catalog endpoints: categories, products, bundle composition + ATP."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.users import current_active_user, current_superuser
from app.errors import NotFoundError
from app.models.product import Product
from app.models.user import User
from app.schemas.v2 import (
    BundleAtpRead,
    BundleComponentRead,
    BundleComponentUpsert,
    CategoryCreate,
    CategoryRead,
    ProductCreate,
    ProductRead,
)
from app.services import bundle as bundle_svc
from app.services import catalog as cat_svc

router = APIRouter(tags=["catalog"])


# ----- categories -----


@router.get("/categories", response_model=list[CategoryRead])
async def list_categories(
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[CategoryRead]:
    rows = await cat_svc.list_categories(db)
    return [CategoryRead.model_validate(r) for r in rows]


@router.post("/categories", response_model=CategoryRead, status_code=201)
async def create_category(
    body: CategoryCreate,
    _: User = Depends(current_superuser),
    db: AsyncSession = Depends(get_db),
) -> CategoryRead:
    row = await cat_svc.create_category(
        db, code=body.code, name=body.name, parent_id=body.parent_id
    )
    return CategoryRead.model_validate(row)


# ----- products -----


@router.get("/products", response_model=list[ProductRead])
async def list_products(
    sku: str | None = None,
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[ProductRead]:
    stmt = select(Product)
    if sku is not None:
        stmt = stmt.where(Product.sku == sku)
    rows = list((await db.execute(stmt)).scalars().all())
    return [ProductRead.model_validate(r) for r in rows]


@router.post("/products", response_model=ProductRead, status_code=201)
async def create_product(
    body: ProductCreate,
    _: User = Depends(current_superuser),
    db: AsyncSession = Depends(get_db),
) -> ProductRead:
    p = Product(
        sku=body.sku,
        name=body.name,
        uom=body.uom,
        product_type=body.product_type,
        is_manufactured=body.is_manufactured,
        category_id=body.category_id,
        selling_price=body.selling_price,
        external_id=body.external_id,
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return ProductRead.model_validate(p)


# ----- bundle composition -----


@router.get(
    "/catalog/bundles/{bundle_id}/components",
    response_model=list[BundleComponentRead],
)
async def list_components(
    bundle_id: uuid.UUID,
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[BundleComponentRead]:
    rows = await cat_svc.list_bundle_components(db, bundle_id)
    return [BundleComponentRead.model_validate(r) for r in rows]


@router.post(
    "/catalog/bundles/{bundle_id}/components",
    response_model=list[BundleComponentRead],
)
async def set_components(
    bundle_id: uuid.UUID,
    body: list[BundleComponentUpsert],
    _: User = Depends(current_superuser),
    db: AsyncSession = Depends(get_db),
) -> list[BundleComponentRead]:
    payload = [c.model_dump() for c in body]
    rows = await cat_svc.set_bundle_components(db, bundle_id=bundle_id, components=payload)
    return [BundleComponentRead.model_validate(r) for r in rows]


@router.get(
    "/catalog/bundles/{bundle_id}/atp",
    response_model=BundleAtpRead,
)
async def bundle_atp(
    bundle_id: uuid.UUID,
    warehouse_id: uuid.UUID = Query(...),
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> BundleAtpRead:
    p = await db.get(Product, bundle_id)
    if p is None:
        raise NotFoundError(f"Bundle {bundle_id} not found")
    atp = await bundle_svc.compute_bundle_atp(db, bundle_id, warehouse_id)
    return BundleAtpRead(bundle_product_id=bundle_id, warehouse_id=warehouse_id, atp=atp)
