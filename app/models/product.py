"""Product model — minimal v0.1.1 catalog stub for the costing engine.

Catalog/inventory will expand in v0.2.0; only fields the standard-cost engine needs are here.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.costing import BillOfMaterials


class ProductType(enum.StrEnum):
    RAW = "RAW"
    PACKAGING = "PACKAGING"
    FINISHED = "FINISHED"
    BUNDLE = "BUNDLE"


class Product(Base):
    __tablename__ = "products"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    sku: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    uom: Mapped[str] = mapped_column(String(16), nullable=False, default="EA")
    product_type: Mapped[ProductType] = mapped_column(
        SQLEnum(ProductType, native_enum=False, length=16, name="product_type"),
        nullable=False,
        default=ProductType.RAW,
    )
    is_manufactured: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
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

    boms: Mapped[list[BillOfMaterials]] = relationship(
        back_populates="product",
        cascade="all, delete-orphan",
        foreign_keys="BillOfMaterials.product_id",
    )


__all__ = ["Product", "ProductType"]
