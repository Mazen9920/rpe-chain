"""Catalog: Category and BundleComponent. Extends Product with category + selling_price."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.product import Product


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True, index=True
    )
    abc_default: Mapped[str | None] = mapped_column(String(1), nullable=True)
    default_service_level: Mapped[Decimal | None] = mapped_column(Numeric(5, 4), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    parent: Mapped[Category | None] = relationship(
        "Category", remote_side="Category.id", back_populates="children"
    )
    children: Mapped[list[Category]] = relationship(
        "Category", back_populates="parent", cascade="all"
    )

    __table_args__ = (
        CheckConstraint(
            "abc_default IS NULL OR abc_default IN ('A','B','C')",
            name="ck_category_abc",
        ),
    )


class BundleComponent(Base):
    """One component line of a BUNDLE product. Single-level only (enforced in service)."""

    __tablename__ = "bundle_components"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    bundle_product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    component_product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    qty_per: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    allocation_weight: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    bundle: Mapped[Product] = relationship(Product, foreign_keys=[bundle_product_id])
    component: Mapped[Product] = relationship(Product, foreign_keys=[component_product_id])

    __table_args__ = (
        UniqueConstraint(
            "bundle_product_id", "component_product_id", name="uq_bundle_component_pair"
        ),
        CheckConstraint("qty_per > 0", name="ck_bundle_component_qty_positive"),
        CheckConstraint(
            "bundle_product_id <> component_product_id",
            name="ck_bundle_component_not_self",
        ),
    )


__all__ = ["BundleComponent", "Category"]
