"""Catalog, inventory, sales, bundles, integrations, pending journals (v0.2.0).

Revision ID: 0003_catalog_inventory_sales_bundles
Revises: 0002_standard_cost_engine
Create Date: 2026-05-16 12:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003_catalog_inventory_sales_bundles"
down_revision = "0002_standard_cost_engine"
branch_labels = None
depends_on = None


MOVEMENT_TYPE = ("RECEIVE", "SHIP", "TRANSFER_OUT", "TRANSFER_IN", "ADJUST", "RESERVE", "RELEASE")
COST_LAYER_STATUS = ("ACTIVE", "DEPLETED", "LOCKED")
RESERVATION_STATUS = ("ACTIVE", "RELEASED", "CONSUMED")
SO_SOURCE = ("SHOPIFY", "MANUAL", "B2B")
SO_STATUS = (
    "RECEIVED",
    "CONFIRMED",
    "ALLOCATED",
    "PICKED",
    "PACKED",
    "SHIPPED",
    "DELIVERED",
    "CANCELLED",
)
SHIPMENT_STATUS = ("DRAFT", "DISPATCHED", "DELIVERED", "CANCELLED")
PENDING_STATUS = ("PENDING", "POSTED", "REJECTED")
INTEGRATION_SOURCE = ("SHOPIFY", "BOSTA", "PAYMOB", "BANK")
OUTBOX_STATUS = ("PENDING", "IN_FLIGHT", "SUCCEEDED", "FAILED")


def upgrade() -> None:
    # ---- categories ----
    op.create_table(
        "categories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column("abc_default", sa.String(length=1), nullable=True),
        sa.Column("default_service_level", sa.Numeric(5, 4), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["parent_id"], ["categories.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "abc_default IS NULL OR abc_default IN ('A','B','C')", name="ck_category_abc"
        ),
    )
    op.create_index("ix_categories_code", "categories", ["code"], unique=True)
    op.create_index("ix_categories_parent_id", "categories", ["parent_id"])

    # ---- extend products ----
    op.add_column("products", sa.Column("category_id", sa.Uuid(), nullable=True))
    op.add_column("products", sa.Column("selling_price", sa.Numeric(18, 4), nullable=True))
    op.add_column("products", sa.Column("external_id", sa.String(length=64), nullable=True))
    op.create_foreign_key(
        "fk_products_category", "products", "categories", ["category_id"], ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_products_category_id", "products", ["category_id"])
    op.create_index("ix_products_external_id", "products", ["external_id"])

    # ---- bundle_components ----
    op.create_table(
        "bundle_components",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("bundle_product_id", sa.Uuid(), nullable=False),
        sa.Column("component_product_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("qty_per", sa.Numeric(12, 4), nullable=False),
        sa.Column("allocation_weight", sa.Numeric(12, 4), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["bundle_product_id"], ["products.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["component_product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "bundle_product_id", "component_product_id", name="uq_bundle_component_pair"
        ),
        sa.CheckConstraint("qty_per > 0", name="ck_bundle_component_qty_positive"),
        sa.CheckConstraint(
            "bundle_product_id <> component_product_id", name="ck_bundle_component_not_self"
        ),
    )
    op.create_index("ix_bundle_components_bundle_product_id", "bundle_components", ["bundle_product_id"])
    op.create_index(
        "ix_bundle_components_component_product_id", "bundle_components", ["component_product_id"]
    )

    # ---- warehouses ----
    op.create_table(
        "warehouses",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("country", sa.String(length=2), nullable=True),
        sa.Column("city", sa.String(length=64), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_warehouses_code", "warehouses", ["code"], unique=True)

    # ---- lots ----
    op.create_table(
        "lots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("lot_code", sa.String(length=64), nullable=False),
        sa.Column("received_at", sa.Date(), nullable=True),
        sa.Column("expires_at", sa.Date(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("product_id", "lot_code", name="uq_lot_product_code"),
    )
    op.create_index("ix_lots_product_id", "lots", ["product_id"])

    # ---- stock_levels ----
    op.create_table(
        "stock_levels",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("warehouse_id", sa.Uuid(), nullable=False),
        sa.Column("on_hand", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("reserved", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("product_id", "warehouse_id", name="uq_stock_product_wh"),
        sa.CheckConstraint("on_hand >= 0", name="ck_stock_on_hand_nonneg"),
        sa.CheckConstraint("reserved >= 0", name="ck_stock_reserved_nonneg"),
        sa.CheckConstraint("reserved <= on_hand", name="ck_stock_reserved_le_on_hand"),
    )
    op.create_index("ix_stock_levels_product_id", "stock_levels", ["product_id"])
    op.create_index("ix_stock_levels_warehouse_id", "stock_levels", ["warehouse_id"])

    # ---- stock_movements ----
    op.create_table(
        "stock_movements",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("warehouse_id", sa.Uuid(), nullable=False),
        sa.Column("lot_id", sa.Uuid(), nullable=True),
        sa.Column(
            "movement_type",
            sa.Enum(*MOVEMENT_TYPE, name="movement_type", native_enum=False, length=16),
            nullable=False,
        ),
        sa.Column("qty", sa.Numeric(12, 4), nullable=False),
        sa.Column("unit_cost", sa.Numeric(18, 4), nullable=True),
        sa.Column("ref_type", sa.String(length=32), nullable=True),
        sa.Column("ref_id", sa.Uuid(), nullable=True),
        sa.Column("note", sa.String(length=255), nullable=True),
        sa.Column(
            "occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["lot_id"], ["lots.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("qty <> 0", name="ck_movement_qty_nonzero"),
    )
    op.create_index("ix_stock_movements_product_id", "stock_movements", ["product_id"])
    op.create_index("ix_stock_movements_warehouse_id", "stock_movements", ["warehouse_id"])
    op.create_index("ix_stock_movements_lot_id", "stock_movements", ["lot_id"])

    # ---- cost_layers ----
    op.create_table(
        "cost_layers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("warehouse_id", sa.Uuid(), nullable=False),
        sa.Column("lot_id", sa.Uuid(), nullable=True),
        sa.Column(
            "received_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("qty_received", sa.Numeric(12, 4), nullable=False),
        sa.Column("qty_remaining", sa.Numeric(12, 4), nullable=False),
        sa.Column("unit_cost", sa.Numeric(18, 4), nullable=False),
        sa.Column("landed_cost_per_unit", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EGP"),
        sa.Column(
            "status",
            sa.Enum(*COST_LAYER_STATUS, name="cost_layer_status", native_enum=False, length=16),
            nullable=False,
            server_default="ACTIVE",
        ),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["lot_id"], ["lots.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("qty_received > 0", name="ck_layer_received_positive"),
        sa.CheckConstraint("qty_remaining >= 0", name="ck_layer_remaining_nonneg"),
        sa.CheckConstraint("qty_remaining <= qty_received", name="ck_layer_remaining_le_received"),
        sa.CheckConstraint("unit_cost >= 0", name="ck_layer_unit_cost_nonneg"),
    )
    op.create_index("ix_cost_layers_product_id", "cost_layers", ["product_id"])
    op.create_index("ix_cost_layers_warehouse_id", "cost_layers", ["warehouse_id"])
    op.create_index("ix_cost_layers_received_at", "cost_layers", ["received_at"])

    # ---- reservations ----
    op.create_table(
        "reservations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("warehouse_id", sa.Uuid(), nullable=False),
        sa.Column("qty", sa.Numeric(12, 4), nullable=False),
        sa.Column("ref_type", sa.String(length=32), nullable=False),
        sa.Column("ref_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(*RESERVATION_STATUS, name="reservation_status", native_enum=False, length=16),
            nullable=False,
            server_default="ACTIVE",
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("qty > 0", name="ck_reservation_qty_positive"),
    )
    op.create_index("ix_reservations_product_id", "reservations", ["product_id"])
    op.create_index("ix_reservations_warehouse_id", "reservations", ["warehouse_id"])
    op.create_index("ix_reservations_ref_id", "reservations", ["ref_id"])

    # ---- customers ----
    op.create_table(
        "customers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=32), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EGP"),
        sa.Column("payment_terms_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("credit_limit", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("external_id", sa.String(length=64), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_customers_code", "customers", ["code"], unique=True)
    op.create_index("ix_customers_external_id", "customers", ["external_id"])

    # ---- sales_orders ----
    op.create_table(
        "sales_orders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("order_number", sa.String(length=64), nullable=False),
        sa.Column("customer_id", sa.Uuid(), nullable=False),
        sa.Column("warehouse_id", sa.Uuid(), nullable=True),
        sa.Column(
            "source",
            sa.Enum(*SO_SOURCE, name="sales_order_source", native_enum=False, length=16),
            nullable=False,
            server_default="MANUAL",
        ),
        sa.Column("external_id", sa.String(length=64), nullable=True),
        sa.Column(
            "status",
            sa.Enum(*SO_STATUS, name="sales_order_status", native_enum=False, length=16),
            nullable=False,
            server_default="RECEIVED",
        ),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EGP"),
        sa.Column("order_date", sa.Date(), nullable=False),
        sa.Column("notes", sa.String(length=512), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source", "external_id", name="uq_sales_order_source_external"),
    )
    op.create_index("ix_sales_orders_order_number", "sales_orders", ["order_number"], unique=True)
    op.create_index("ix_sales_orders_customer_id", "sales_orders", ["customer_id"])
    op.create_index("ix_sales_orders_warehouse_id", "sales_orders", ["warehouse_id"])
    op.create_index("ix_sales_orders_external_id", "sales_orders", ["external_id"])

    # ---- sales_order_lines ----
    op.create_table(
        "sales_order_lines",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("parent_line_id", sa.Uuid(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column(
            "is_bundle_parent", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column(
            "is_bundle_component", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("qty", sa.Numeric(12, 4), nullable=False),
        sa.Column("qty_allocated", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("qty_picked", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("qty_shipped", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("unit_price", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("line_total", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["order_id"], ["sales_orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["parent_line_id"], ["sales_order_lines.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("qty > 0", name="ck_sol_qty_positive"),
        sa.CheckConstraint(
            "qty_allocated >= 0 AND qty_allocated <= qty", name="ck_sol_alloc_range"
        ),
        sa.CheckConstraint("qty_picked >= 0 AND qty_picked <= qty", name="ck_sol_picked_range"),
        sa.CheckConstraint("qty_shipped >= 0 AND qty_shipped <= qty", name="ck_sol_shipped_range"),
    )
    op.create_index("ix_sol_order_id", "sales_order_lines", ["order_id"])
    op.create_index("ix_sol_parent_line_id", "sales_order_lines", ["parent_line_id"])
    op.create_index("ix_sol_product_id", "sales_order_lines", ["product_id"])

    # ---- shipments ----
    op.create_table(
        "shipments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("shipment_number", sa.String(length=64), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("warehouse_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(*SHIPMENT_STATUS, name="shipment_status", native_enum=False, length=16),
            nullable=False,
            server_default="DRAFT",
        ),
        sa.Column("carrier", sa.String(length=64), nullable=True),
        sa.Column("tracking_number", sa.String(length=128), nullable=True),
        sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["order_id"], ["sales_orders.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_shipments_shipment_number", "shipments", ["shipment_number"], unique=True
    )
    op.create_index("ix_shipments_order_id", "shipments", ["order_id"])
    op.create_index("ix_shipments_warehouse_id", "shipments", ["warehouse_id"])

    # ---- shipment_lines ----
    op.create_table(
        "shipment_lines",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("shipment_id", sa.Uuid(), nullable=False),
        sa.Column("order_line_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("qty", sa.Numeric(12, 4), nullable=False),
        sa.Column("unit_cost", sa.Numeric(18, 4), nullable=False),
        sa.Column("cost_source", sa.String(length=16), nullable=False, server_default="standard"),
        sa.ForeignKeyConstraint(["shipment_id"], ["shipments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["order_line_id"], ["sales_order_lines.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("qty > 0", name="ck_shipline_qty_positive"),
    )
    op.create_index("ix_shipment_lines_shipment_id", "shipment_lines", ["shipment_id"])
    op.create_index("ix_shipment_lines_order_line_id", "shipment_lines", ["order_line_id"])
    op.create_index("ix_shipment_lines_product_id", "shipment_lines", ["product_id"])

    # ---- pending_journals ----
    op.create_table(
        "pending_journals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("source_doc_type", sa.String(length=32), nullable=False),
        sa.Column("source_doc_id", sa.Uuid(), nullable=False),
        sa.Column("event_date", sa.Date(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EGP"),
        sa.Column("memo", sa.String(length=255), nullable=True),
        sa.Column(
            "status",
            sa.Enum(*PENDING_STATUS, name="pending_journal_status", native_enum=False, length=16),
            nullable=False,
            server_default="PENDING",
        ),
        sa.Column("posted_journal_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_pending_journals_source_doc_id", "pending_journals", ["source_doc_id"])

    op.create_table(
        "pending_journal_lines",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entry_id", sa.Uuid(), nullable=False),
        sa.Column("account_code", sa.String(length=16), nullable=False),
        sa.Column("debit", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("credit", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EGP"),
        sa.Column("dimensions", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["entry_id"], ["pending_journals.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "(debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)",
            name="ck_pjline_debit_xor_credit",
        ),
    )
    op.create_index("ix_pending_journal_lines_entry_id", "pending_journal_lines", ["entry_id"])
    op.create_index(
        "ix_pending_journal_lines_account_code", "pending_journal_lines", ["account_code"]
    )

    # ---- idempotency_keys ----
    op.create_table(
        "idempotency_keys",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("scope", sa.String(length=64), nullable=False),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("scope", "key", name="uq_idempotency_scope_key"),
    )

    # ---- integration_events ----
    op.create_table(
        "integration_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "source",
            sa.Enum(*INTEGRATION_SOURCE, name="integration_source", native_enum=False, length=16),
            nullable=False,
        ),
        sa.Column("topic", sa.String(length=128), nullable=False),
        sa.Column("external_id", sa.String(length=128), nullable=True),
        sa.Column("raw_payload", sa.JSON(), nullable=False),
        sa.Column("signature_ok", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "received_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.String(length=1024), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_integration_events_topic", "integration_events", ["topic"])
    op.create_index("ix_integration_events_external_id", "integration_events", ["external_id"])

    # ---- integration_outbox ----
    op.create_table(
        "integration_outbox",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "target",
            sa.Enum(*INTEGRATION_SOURCE, name="outbox_target", native_enum=False, length=16),
            nullable=False,
        ),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column(
            "status",
            sa.Enum(*OUTBOX_STATUS, name="outbox_status", native_enum=False, length=16),
            nullable=False,
            server_default="PENDING",
        ),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "next_attempt_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("last_error", sa.String(length=1024), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("succeeded_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("target", "idempotency_key", name="uq_outbox_target_idem"),
        sa.CheckConstraint("attempts >= 0", name="ck_outbox_attempts_nonneg"),
    )
    op.create_index("ix_integration_outbox_target", "integration_outbox", ["target"])
    op.create_index("ix_integration_outbox_status", "integration_outbox", ["status"])
    op.create_index(
        "ix_integration_outbox_next_attempt_at", "integration_outbox", ["next_attempt_at"]
    )


def downgrade() -> None:
    op.drop_table("integration_outbox")
    op.drop_table("integration_events")
    op.drop_table("idempotency_keys")
    op.drop_table("pending_journal_lines")
    op.drop_table("pending_journals")
    op.drop_table("shipment_lines")
    op.drop_table("shipments")
    op.drop_table("sales_order_lines")
    op.drop_table("sales_orders")
    op.drop_table("customers")
    op.drop_table("reservations")
    op.drop_table("cost_layers")
    op.drop_table("stock_movements")
    op.drop_table("stock_levels")
    op.drop_table("lots")
    op.drop_table("warehouses")
    op.drop_table("bundle_components")

    op.drop_index("ix_products_external_id", table_name="products")
    op.drop_index("ix_products_category_id", table_name="products")
    op.drop_constraint("fk_products_category", "products", type_="foreignkey")
    op.drop_column("products", "external_id")
    op.drop_column("products", "selling_price")
    op.drop_column("products", "category_id")

    op.drop_table("categories")
