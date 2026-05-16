"""Standard-cost engine: products, BOM, monthly cost inputs, standard_costs, costing_settings.

Revision ID: 0002_standard_cost_engine
Revises: 0001_initial
Create Date: 2026-05-16 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002_standard_cost_engine"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


PRODUCT_TYPE = ("RAW", "PACKAGING", "FINISHED", "BUNDLE")
COST_SOURCE = ("MANUAL", "IMPORT", "API")
OTHER_COST_TYPE = ("PACKAGING", "LABOR", "OVERHEAD", "OTHER")
STD_STATUS = ("OK", "MISSING_RM_PRICES", "MISSING_MFG_FEE", "STALE", "LOCKED")


def upgrade() -> None:
    op.create_table(
        "products",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("sku", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("uom", sa.String(length=16), nullable=False, server_default="EA"),
        sa.Column(
            "product_type",
            sa.Enum(*PRODUCT_TYPE, name="product_type", native_enum=False, length=16),
            nullable=False,
            server_default="RAW",
        ),
        sa.Column("is_manufactured", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_products_sku", "products", ["sku"], unique=True)

    op.create_table(
        "bill_of_materials",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("product_id", "version", name="uq_bom_product_version"),
    )
    op.create_index("ix_bill_of_materials_product_id", "bill_of_materials", ["product_id"])

    op.create_table(
        "bom_lines",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("bom_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("component_product_id", sa.Uuid(), nullable=False),
        sa.Column("qty_per", sa.Numeric(12, 4), nullable=False),
        sa.Column("scrap_factor_pct", sa.Numeric(5, 4), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["bom_id"], ["bill_of_materials.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["component_product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("qty_per > 0", name="ck_bom_line_qty_positive"),
        sa.CheckConstraint(
            "scrap_factor_pct >= 0 AND scrap_factor_pct < 1",
            name="ck_bom_line_scrap_fraction",
        ),
    )
    op.create_index("ix_bom_lines_bom_id", "bom_lines", ["bom_id"])
    op.create_index("ix_bom_lines_component_product_id", "bom_lines", ["component_product_id"])

    op.create_table(
        "rm_cost_months",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("month_start", sa.Date(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EGP"),
        sa.Column("is_locked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("unit_cost", sa.Numeric(18, 4), nullable=False),
        sa.Column("fx_rate", sa.Numeric(14, 6), nullable=True),
        sa.Column(
            "source",
            sa.Enum(*COST_SOURCE, name="cost_source", native_enum=False, length=16),
            nullable=False,
            server_default="MANUAL",
        ),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("product_id", "month_start", name="uq_rm_cost_product_month"),
        sa.CheckConstraint("unit_cost >= 0", name="ck_rm_unit_cost_nonneg"),
    )
    op.create_index("ix_rm_cost_months_month_start", "rm_cost_months", ["month_start"])
    op.create_index("ix_rm_cost_months_product_id", "rm_cost_months", ["product_id"])

    op.create_table(
        "mfg_fee_months",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("month_start", sa.Date(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EGP"),
        sa.Column("is_locked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("fee_amount", sa.Numeric(18, 4), nullable=False),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("product_id", "month_start", name="uq_mfg_fee_product_month"),
        sa.CheckConstraint("fee_amount >= 0", name="ck_mfg_fee_nonneg"),
    )
    op.create_index("ix_mfg_fee_months_month_start", "mfg_fee_months", ["month_start"])
    op.create_index("ix_mfg_fee_months_product_id", "mfg_fee_months", ["product_id"])

    op.create_table(
        "other_cost_months",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("month_start", sa.Date(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EGP"),
        sa.Column("is_locked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column(
            "cost_type",
            sa.Enum(*OTHER_COST_TYPE, name="other_cost_type", native_enum=False, length=16),
            nullable=False,
        ),
        sa.Column("amount", sa.Numeric(18, 4), nullable=False),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "product_id", "month_start", "cost_type", name="uq_other_cost_product_month_type"
        ),
        sa.CheckConstraint("amount >= 0", name="ck_other_amount_nonneg"),
    )
    op.create_index("ix_other_cost_months_month_start", "other_cost_months", ["month_start"])
    op.create_index("ix_other_cost_months_product_id", "other_cost_months", ["product_id"])

    op.create_table(
        "standard_costs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("month_start", sa.Date(), nullable=False),
        sa.Column("unit_cost", sa.Numeric(18, 4), nullable=True),
        sa.Column("rm_subtotal", sa.Numeric(18, 4), nullable=True),
        sa.Column("mfg_fee", sa.Numeric(18, 4), nullable=True),
        sa.Column("other_subtotal", sa.Numeric(18, 4), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                *STD_STATUS, name="standard_cost_status", native_enum=False, length=24
            ),
            nullable=False,
            server_default="OK",
        ),
        sa.Column("is_locked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "computed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("missing_inputs", sa.JSON(), nullable=True),
        sa.Column("breakdown", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("product_id", "month_start", name="uq_std_cost_product_month"),
    )
    op.create_index("ix_standard_costs_month_start", "standard_costs", ["month_start"])
    op.create_index("ix_standard_costs_product_id", "standard_costs", ["product_id"])

    op.create_table(
        "costing_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("cutover_date", sa.Date(), nullable=True),
        sa.Column("stale_after_days", sa.Integer(), nullable=False, server_default="7"),
        sa.Column("default_currency", sa.String(length=3), nullable=False, server_default="EGP"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("id = 1", name="ck_costing_settings_singleton"),
    )


def downgrade() -> None:
    op.drop_table("costing_settings")
    op.drop_index("ix_standard_costs_product_id", table_name="standard_costs")
    op.drop_index("ix_standard_costs_month_start", table_name="standard_costs")
    op.drop_table("standard_costs")
    op.drop_index("ix_other_cost_months_product_id", table_name="other_cost_months")
    op.drop_index("ix_other_cost_months_month_start", table_name="other_cost_months")
    op.drop_table("other_cost_months")
    op.drop_index("ix_mfg_fee_months_product_id", table_name="mfg_fee_months")
    op.drop_index("ix_mfg_fee_months_month_start", table_name="mfg_fee_months")
    op.drop_table("mfg_fee_months")
    op.drop_index("ix_rm_cost_months_product_id", table_name="rm_cost_months")
    op.drop_index("ix_rm_cost_months_month_start", table_name="rm_cost_months")
    op.drop_table("rm_cost_months")
    op.drop_index("ix_bom_lines_component_product_id", table_name="bom_lines")
    op.drop_index("ix_bom_lines_bom_id", table_name="bom_lines")
    op.drop_table("bom_lines")
    op.drop_index("ix_bill_of_materials_product_id", table_name="bill_of_materials")
    op.drop_table("bill_of_materials")
    op.drop_index("ix_products_sku", table_name="products")
    op.drop_table("products")
