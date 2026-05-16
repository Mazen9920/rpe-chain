"""Production orders + RMA (v0.4.1).

Revision ID: 0007_production_orders_rma
Revises: 0006_paymob_bosta_bank_chargebacks
Create Date: 2026-05-16 23:50:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007_production_orders_rma"
down_revision = "0006_paymob_bosta_bank_chargebacks"
branch_labels = None
depends_on = None


MO_STATUS = ("DRAFT", "RELEASED", "IN_PROGRESS", "DONE", "CLOSED", "CANCELLED")
RMA_STATUS = ("REQUESTED", "AUTHORIZED", "RECEIVED", "CLOSED", "CANCELLED")
RMA_REFUND_METHOD = ("BANK", "CASH", "CREDIT_NOTE")
RMA_LINE_DISPOSITION = ("RESTOCK", "SCRAP")


def upgrade() -> None:
    # ---- work_centers ----
    op.create_table(
        "work_centers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("hourly_rate", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column(
            "capacity_hours_per_day", sa.Numeric(8, 2), nullable=False, server_default="8"
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("hourly_rate >= 0", name="ck_wc_hourly_rate_positive"),
        sa.CheckConstraint("capacity_hours_per_day > 0", name="ck_wc_capacity_positive"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_work_centers_code", "work_centers", ["code"], unique=True)

    # ---- production_orders ----
    op.create_table(
        "production_orders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("mo_number", sa.String(length=32), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("bom_id", sa.Uuid(), nullable=True),
        sa.Column("warehouse_id", sa.Uuid(), nullable=False),
        sa.Column("qty_planned", sa.Numeric(12, 4), nullable=False),
        sa.Column("qty_produced", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column(
            "status",
            sa.Enum(*MO_STATUS, name="mo_status", native_enum=False, length=16),
            nullable=False,
            server_default="DRAFT",
        ),
        sa.Column("std_cost_per_unit", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("total_std_cost", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("total_actual_cost", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("variance", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EGP"),
        sa.Column("planned_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("planned_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actual_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actual_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("issue_journal_id", sa.Uuid(), nullable=True),
        sa.Column("completion_journal_id", sa.Uuid(), nullable=True),
        sa.Column("variance_journal_id", sa.Uuid(), nullable=True),
        sa.Column("notes", sa.String(length=1000), nullable=True),
        sa.Column("raw_payload", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("qty_planned > 0", name="ck_mo_qty_planned_positive"),
        sa.CheckConstraint("qty_produced >= 0", name="ck_mo_qty_produced_nonneg"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["bom_id"], ["bill_of_materials.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["issue_journal_id"], ["gl_journals.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["completion_journal_id"], ["gl_journals.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["variance_journal_id"], ["gl_journals.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_production_orders_mo_number", "production_orders", ["mo_number"], unique=True
    )
    op.create_index("ix_production_orders_product_id", "production_orders", ["product_id"])
    op.create_index("ix_production_orders_warehouse_id", "production_orders", ["warehouse_id"])
    op.create_index("ix_production_orders_status", "production_orders", ["status"])

    # ---- mo_components ----
    op.create_table(
        "mo_components",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("mo_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("component_product_id", sa.Uuid(), nullable=False),
        sa.Column("qty_required", sa.Numeric(12, 4), nullable=False),
        sa.Column("qty_issued", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("std_unit_cost", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("actual_unit_cost", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.CheckConstraint("qty_required > 0", name="ck_moc_qty_required_positive"),
        sa.CheckConstraint("qty_issued >= 0", name="ck_moc_qty_issued_nonneg"),
        sa.ForeignKeyConstraint(["mo_id"], ["production_orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["component_product_id"], ["products.id"], ondelete="RESTRICT"
        ),
        sa.UniqueConstraint("mo_id", "component_product_id", name="uq_mo_component"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_mo_components_mo_id", "mo_components", ["mo_id"])
    op.create_index(
        "ix_mo_components_component_product_id", "mo_components", ["component_product_id"]
    )

    # ---- mo_operations ----
    op.create_table(
        "mo_operations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("mo_id", sa.Uuid(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("work_center_id", sa.Uuid(), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("std_hours", sa.Numeric(10, 4), nullable=False, server_default="0"),
        sa.Column("actual_hours", sa.Numeric(10, 4), nullable=False, server_default="0"),
        sa.CheckConstraint("std_hours >= 0", name="ck_moo_std_hours_nonneg"),
        sa.CheckConstraint("actual_hours >= 0", name="ck_moo_actual_hours_nonneg"),
        sa.ForeignKeyConstraint(["mo_id"], ["production_orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["work_center_id"], ["work_centers.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_mo_operations_mo_id", "mo_operations", ["mo_id"])
    op.create_index("ix_mo_operations_work_center_id", "mo_operations", ["work_center_id"])

    # ---- rmas ----
    op.create_table(
        "rmas",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("rma_number", sa.String(length=32), nullable=False),
        sa.Column("customer_id", sa.Uuid(), nullable=False),
        sa.Column("customer_invoice_id", sa.Uuid(), nullable=True),
        sa.Column("sales_order_id", sa.Uuid(), nullable=True),
        sa.Column("warehouse_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(*RMA_STATUS, name="rma_status", native_enum=False, length=16),
            nullable=False,
            server_default="REQUESTED",
        ),
        sa.Column("reason", sa.String(length=500), nullable=True),
        sa.Column(
            "refund_method",
            sa.Enum(
                *RMA_REFUND_METHOD,
                name="rma_refund_method",
                native_enum=False,
                length=16,
            ),
            nullable=False,
            server_default="BANK",
        ),
        sa.Column(
            "refund_account_code", sa.String(length=16), nullable=False, server_default="1020"
        ),
        sa.Column(
            "total_refund_amount", sa.Numeric(18, 4), nullable=False, server_default="0"
        ),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EGP"),
        sa.Column("requested_at", sa.Date(), nullable=False),
        sa.Column("authorized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("refund_journal_id", sa.Uuid(), nullable=True),
        sa.Column("cogs_reversal_journal_id", sa.Uuid(), nullable=True),
        sa.Column("notes", sa.String(length=1000), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("total_refund_amount >= 0", name="ck_rma_refund_nonneg"),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["customer_invoice_id"], ["customer_invoices.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["sales_order_id"], ["sales_orders.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["refund_journal_id"], ["gl_journals.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["cogs_reversal_journal_id"], ["gl_journals.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_rmas_rma_number", "rmas", ["rma_number"], unique=True)
    op.create_index("ix_rmas_customer_id", "rmas", ["customer_id"])
    op.create_index("ix_rmas_customer_invoice_id", "rmas", ["customer_invoice_id"])
    op.create_index("ix_rmas_sales_order_id", "rmas", ["sales_order_id"])
    op.create_index("ix_rmas_warehouse_id", "rmas", ["warehouse_id"])
    op.create_index("ix_rmas_status", "rmas", ["status"])

    # ---- rma_lines ----
    op.create_table(
        "rma_lines",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("rma_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("qty_requested", sa.Numeric(12, 4), nullable=False),
        sa.Column("qty_received", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("qty_restocked", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("qty_scrapped", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("original_unit_price", sa.Numeric(18, 4), nullable=False),
        sa.Column(
            "original_unit_cost", sa.Numeric(18, 4), nullable=False, server_default="0"
        ),
        sa.Column(
            "disposition",
            sa.Enum(
                *RMA_LINE_DISPOSITION,
                name="rma_line_disposition",
                native_enum=False,
                length=16,
            ),
            nullable=False,
            server_default="RESTOCK",
        ),
        sa.CheckConstraint("qty_requested > 0", name="ck_rmal_qty_requested_positive"),
        sa.CheckConstraint("qty_received >= 0", name="ck_rmal_qty_received_nonneg"),
        sa.CheckConstraint("qty_restocked >= 0", name="ck_rmal_qty_restocked_nonneg"),
        sa.CheckConstraint("qty_scrapped >= 0", name="ck_rmal_qty_scrapped_nonneg"),
        sa.ForeignKeyConstraint(["rma_id"], ["rmas.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_rma_lines_rma_id", "rma_lines", ["rma_id"])
    op.create_index("ix_rma_lines_product_id", "rma_lines", ["product_id"])


def downgrade() -> None:
    op.drop_index("ix_rma_lines_product_id", table_name="rma_lines")
    op.drop_index("ix_rma_lines_rma_id", table_name="rma_lines")
    op.drop_table("rma_lines")

    op.drop_index("ix_rmas_status", table_name="rmas")
    op.drop_index("ix_rmas_warehouse_id", table_name="rmas")
    op.drop_index("ix_rmas_sales_order_id", table_name="rmas")
    op.drop_index("ix_rmas_customer_invoice_id", table_name="rmas")
    op.drop_index("ix_rmas_customer_id", table_name="rmas")
    op.drop_index("ix_rmas_rma_number", table_name="rmas")
    op.drop_table("rmas")

    op.drop_index("ix_mo_operations_work_center_id", table_name="mo_operations")
    op.drop_index("ix_mo_operations_mo_id", table_name="mo_operations")
    op.drop_table("mo_operations")

    op.drop_index("ix_mo_components_component_product_id", table_name="mo_components")
    op.drop_index("ix_mo_components_mo_id", table_name="mo_components")
    op.drop_table("mo_components")

    op.drop_index("ix_production_orders_status", table_name="production_orders")
    op.drop_index("ix_production_orders_warehouse_id", table_name="production_orders")
    op.drop_index("ix_production_orders_product_id", table_name="production_orders")
    op.drop_index("ix_production_orders_mo_number", table_name="production_orders")
    op.drop_table("production_orders")

    op.drop_index("ix_work_centers_code", table_name="work_centers")
    op.drop_table("work_centers")
