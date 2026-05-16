"""GL + FX + Procurement + AP (v0.3.0).

Revision ID: 0004_gl_fx_procurement_ap
Revises: 0003_catalog_inventory_sales_bundles
Create Date: 2026-05-16 18:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004_gl_fx_procurement_ap"
down_revision = "0003_catalog_inventory_sales_bundles"
branch_labels = None
depends_on = None


ACCOUNT_TYPE = ("ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE")
NORMAL_BALANCE = ("DEBIT", "CREDIT")
JOURNAL_STATUS = ("DRAFT", "POSTED", "REVERSED")
VENDOR_TYPE = ("SUPPLIER", "MANUFACTURER", "ADS_PLATFORM", "COURIER", "GATEWAY", "OTHER")
PO_STATUS = ("DRAFT", "SENT", "PARTIAL", "RECEIVED", "CLOSED", "CANCELLED")
GR_STATUS = ("DRAFT", "POSTED", "REVERSED")
SI_STATUS = ("DRAFT", "POSTED", "PAID", "PARTIALLY_PAID", "VOID")
PAYMENT_METHOD = ("CASH", "BANK", "OTHER")


def upgrade() -> None:
    # ---- gl_accounts ----
    op.create_table(
        "gl_accounts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column(
            "account_type",
            sa.Enum(*ACCOUNT_TYPE, name="gl_account_type", native_enum=False, length=16),
            nullable=False,
        ),
        sa.Column(
            "normal_balance",
            sa.Enum(*NORMAL_BALANCE, name="gl_normal_balance", native_enum=False, length=8),
            nullable=False,
        ),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column("bs_tag", sa.String(length=64), nullable=True),
        sa.Column("cf_tag", sa.String(length=64), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["parent_id"], ["gl_accounts.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_gl_accounts_code", "gl_accounts", ["code"], unique=True)

    # ---- gl_journals ----
    op.create_table(
        "gl_journals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("journal_number", sa.String(length=32), nullable=False),
        sa.Column("event_date", sa.Date(), nullable=False),
        sa.Column("source_doc_type", sa.String(length=32), nullable=False),
        sa.Column("source_doc_id", sa.Uuid(), nullable=False),
        sa.Column("memo", sa.String(length=255), nullable=True),
        sa.Column(
            "status",
            sa.Enum(*JOURNAL_STATUS, name="gl_journal_status", native_enum=False, length=16),
            nullable=False,
            server_default="POSTED",
        ),
        sa.Column("reversal_of_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["reversal_of_id"], ["gl_journals.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_gl_journals_journal_number", "gl_journals", ["journal_number"], unique=True)
    op.create_index("ix_gl_journals_event_date", "gl_journals", ["event_date"])
    op.create_index("ix_gl_journals_source_doc_id", "gl_journals", ["source_doc_id"])

    # ---- gl_journal_lines ----
    op.create_table(
        "gl_journal_lines",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("journal_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("debit", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("credit", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EGP"),
        sa.Column("fx_rate", sa.Numeric(18, 8), nullable=False, server_default="1"),
        sa.Column("base_debit", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("base_credit", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("dimensions", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["journal_id"], ["gl_journals.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["account_id"], ["gl_accounts.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "(debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)",
            name="ck_gl_line_debit_xor_credit",
        ),
    )
    op.create_index("ix_gl_journal_lines_journal_id", "gl_journal_lines", ["journal_id"])
    op.create_index("ix_gl_journal_lines_account_id", "gl_journal_lines", ["account_id"])

    # ---- fx_rates ----
    op.create_table(
        "fx_rates",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("from_ccy", sa.String(length=3), nullable=False),
        sa.Column("to_ccy", sa.String(length=3), nullable=False),
        sa.Column("as_of_date", sa.Date(), nullable=False),
        sa.Column("rate", sa.Numeric(18, 8), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("from_ccy", "to_ccy", "as_of_date", name="uq_fx_rate_date"),
        sa.CheckConstraint("rate > 0", name="ck_fx_rate_positive"),
    )
    op.create_index("ix_fx_rates_as_of_date", "fx_rates", ["as_of_date"])

    # ---- suppliers ----
    op.create_table(
        "suppliers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column(
            "vendor_type",
            sa.Enum(*VENDOR_TYPE, name="vendor_type", native_enum=False, length=16),
            nullable=False,
        ),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EGP"),
        sa.Column("payment_terms_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("ap_account_code", sa.String(length=16), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_suppliers_code", "suppliers", ["code"], unique=True)

    # ---- purchase_orders ----
    op.create_table(
        "purchase_orders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("po_number", sa.String(length=32), nullable=False),
        sa.Column("supplier_id", sa.Uuid(), nullable=False),
        sa.Column("warehouse_id", sa.Uuid(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EGP"),
        sa.Column("fx_rate", sa.Numeric(18, 8), nullable=False, server_default="1"),
        sa.Column(
            "status",
            sa.Enum(*PO_STATUS, name="po_status", native_enum=False, length=16),
            nullable=False,
            server_default="DRAFT",
        ),
        sa.Column("order_date", sa.Date(), nullable=False),
        sa.Column("expected_date", sa.Date(), nullable=True),
        sa.Column("landed_cost_total", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("notes", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_purchase_orders_po_number", "purchase_orders", ["po_number"], unique=True)
    op.create_index("ix_purchase_orders_supplier_id", "purchase_orders", ["supplier_id"])

    # ---- po_lines ----
    op.create_table(
        "po_lines",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("po_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("qty_ordered", sa.Numeric(12, 4), nullable=False),
        sa.Column("qty_received", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("qty_invoiced", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("unit_price", sa.Numeric(18, 4), nullable=False),
        sa.ForeignKeyConstraint(["po_id"], ["purchase_orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("qty_ordered > 0", name="ck_po_line_qty_positive"),
    )
    op.create_index("ix_po_lines_po_id", "po_lines", ["po_id"])

    # ---- goods_receipts ----
    op.create_table(
        "goods_receipts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("gr_number", sa.String(length=32), nullable=False),
        sa.Column("po_id", sa.Uuid(), nullable=False),
        sa.Column("warehouse_id", sa.Uuid(), nullable=False),
        sa.Column("received_at", sa.Date(), nullable=False),
        sa.Column("landed_cost_allocated", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column(
            "status",
            sa.Enum(*GR_STATUS, name="gr_status", native_enum=False, length=16),
            nullable=False,
            server_default="POSTED",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["po_id"], ["purchase_orders.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_goods_receipts_gr_number", "goods_receipts", ["gr_number"], unique=True)
    op.create_index("ix_goods_receipts_po_id", "goods_receipts", ["po_id"])

    # ---- goods_receipt_lines ----
    op.create_table(
        "goods_receipt_lines",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("gr_id", sa.Uuid(), nullable=False),
        sa.Column("po_line_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("qty", sa.Numeric(12, 4), nullable=False),
        sa.Column("unit_cost", sa.Numeric(18, 4), nullable=False),
        sa.Column("landed_per_unit", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("cost_layer_id", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(["gr_id"], ["goods_receipts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["po_line_id"], ["po_lines.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_goods_receipt_lines_gr_id", "goods_receipt_lines", ["gr_id"])

    # ---- supplier_invoices ----
    op.create_table(
        "supplier_invoices",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("invoice_number", sa.String(length=64), nullable=False),
        sa.Column("supplier_id", sa.Uuid(), nullable=False),
        sa.Column("po_id", sa.Uuid(), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EGP"),
        sa.Column("fx_rate", sa.Numeric(18, 8), nullable=False, server_default="1"),
        sa.Column("invoice_date", sa.Date(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("subtotal", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("tax", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("total", sa.Numeric(18, 4), nullable=False),
        sa.Column("amount_paid", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column(
            "status",
            sa.Enum(*SI_STATUS, name="si_status", native_enum=False, length=16),
            nullable=False,
            server_default="DRAFT",
        ),
        sa.Column("posted_journal_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["po_id"], ["purchase_orders.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("supplier_id", "invoice_number", name="uq_si_supplier_number"),
        sa.CheckConstraint("total >= 0", name="ck_si_total_nonneg"),
    )
    op.create_index("ix_supplier_invoices_invoice_number", "supplier_invoices", ["invoice_number"])
    op.create_index("ix_supplier_invoices_supplier_id", "supplier_invoices", ["supplier_id"])

    # ---- supplier_invoice_lines ----
    op.create_table(
        "supplier_invoice_lines",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("invoice_id", sa.Uuid(), nullable=False),
        sa.Column("po_line_id", sa.Uuid(), nullable=True),
        sa.Column("description", sa.String(length=255), nullable=False),
        sa.Column("account_code", sa.String(length=16), nullable=False),
        sa.Column("qty", sa.Numeric(12, 4), nullable=False, server_default="1"),
        sa.Column("unit_price", sa.Numeric(18, 4), nullable=False),
        sa.Column("amount", sa.Numeric(18, 4), nullable=False),
        sa.ForeignKeyConstraint(["invoice_id"], ["supplier_invoices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["po_line_id"], ["po_lines.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_supplier_invoice_lines_invoice_id", "supplier_invoice_lines", ["invoice_id"]
    )

    # ---- ap_payments ----
    op.create_table(
        "ap_payments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("payment_number", sa.String(length=32), nullable=False),
        sa.Column("supplier_id", sa.Uuid(), nullable=False),
        sa.Column("payment_date", sa.Date(), nullable=False),
        sa.Column(
            "method",
            sa.Enum(*PAYMENT_METHOD, name="payment_method", native_enum=False, length=8),
            nullable=False,
            server_default="BANK",
        ),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EGP"),
        sa.Column("fx_rate", sa.Numeric(18, 8), nullable=False, server_default="1"),
        sa.Column("amount", sa.Numeric(18, 4), nullable=False),
        sa.Column("cash_account_code", sa.String(length=16), nullable=False),
        sa.Column("posted_journal_id", sa.Uuid(), nullable=True),
        sa.Column("note", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ap_payments_payment_number", "ap_payments", ["payment_number"], unique=True)
    op.create_index("ix_ap_payments_supplier_id", "ap_payments", ["supplier_id"])

    # ---- ap_payment_applications ----
    op.create_table(
        "ap_payment_applications",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("payment_id", sa.Uuid(), nullable=False),
        sa.Column("invoice_id", sa.Uuid(), nullable=False),
        sa.Column("amount_applied", sa.Numeric(18, 4), nullable=False),
        sa.ForeignKeyConstraint(["payment_id"], ["ap_payments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["invoice_id"], ["supplier_invoices.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_ap_payment_applications_payment_id", "ap_payment_applications", ["payment_id"]
    )
    op.create_index(
        "ix_ap_payment_applications_invoice_id", "ap_payment_applications", ["invoice_id"]
    )


def downgrade() -> None:
    for tbl in (
        "ap_payment_applications",
        "ap_payments",
        "supplier_invoice_lines",
        "supplier_invoices",
        "goods_receipt_lines",
        "goods_receipts",
        "po_lines",
        "purchase_orders",
        "suppliers",
        "fx_rates",
        "gl_journal_lines",
        "gl_journals",
        "gl_accounts",
    ):
        op.drop_table(tbl)
