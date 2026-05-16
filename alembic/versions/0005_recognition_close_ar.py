"""Recognition + Period Close + AR (v0.3.1).

Revision ID: 0005_recognition_close_ar
Revises: 0004_gl_fx_procurement_ap
Create Date: 2026-05-16 21:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0005_recognition_close_ar"
down_revision = "0004_gl_fx_procurement_ap"
branch_labels = None
depends_on = None


PERIOD_STATUS = ("OPEN", "CLOSING", "LOCKED", "REOPENED")
RECOGNITION_MODE = ("ONE_OFF", "MONTHLY", "PREPAID", "ACCRUED")
CONTRACT_STATUS = ("ACTIVE", "COMPLETED", "CANCELLED")
AUDIT_SEVERITY = ("BLOCKER", "WARN", "INFO")
CUSTOMER_INVOICE_STATUS = ("DRAFT", "POSTED", "PARTIALLY_PAID", "PAID", "CANCELLED", "CREDITED")
CUSTOMER_INVOICE_TYPE = ("INVOICE", "CREDIT_NOTE")
AR_PAYMENT_METHOD = ("CASH", "BANK", "PAYMOB", "BOSTA_COD", "CHEQUE", "EFT")


def upgrade() -> None:
    op.create_table(
        "accounting_periods",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(*PERIOD_STATUS, name="period_status", native_enum=False, length=16),
            nullable=False,
            server_default="OPEN",
        ),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("locked_by", sa.String(length=255), nullable=True),
        sa.Column("notes", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("month >= 1 AND month <= 12", name="ck_period_month_range"),
        sa.UniqueConstraint("year", "month", name="uq_period_year_month"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "expense_contracts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=False),
        sa.Column("supplier_id", sa.Uuid(), nullable=True),
        sa.Column("expense_account_code", sa.String(length=16), nullable=False),
        sa.Column(
            "counter_account_code", sa.String(length=16), nullable=False, server_default="2040"
        ),
        sa.Column(
            "recognition_mode",
            sa.Enum(*RECOGNITION_MODE, name="recognition_mode", native_enum=False, length=16),
            nullable=False,
        ),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EGP"),
        sa.Column("total_amount", sa.Numeric(18, 4), nullable=False),
        sa.Column("monthly_amount", sa.Numeric(18, 4), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("period_months", sa.Integer(), nullable=True),
        sa.Column("last_recognized_year", sa.Integer(), nullable=True),
        sa.Column("last_recognized_month", sa.Integer(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(*CONTRACT_STATUS, name="contract_status", native_enum=False, length=16),
            nullable=False,
            server_default="ACTIVE",
        ),
        sa.Column("memo", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("total_amount > 0", name="ck_contract_amount_pos"),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_expense_contracts_code", "expense_contracts", ["code"], unique=True)
    op.create_index(
        "ix_expense_contracts_supplier_id", "expense_contracts", ["supplier_id"], unique=False
    )

    op.create_table(
        "recognition_entries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("contract_id", sa.Uuid(), nullable=False),
        sa.Column("period_id", sa.Uuid(), nullable=False),
        sa.Column("journal_id", sa.Uuid(), nullable=False),
        sa.Column("amount", sa.Numeric(18, 4), nullable=False),
        sa.Column(
            "recognized_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["contract_id"], ["expense_contracts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["period_id"], ["accounting_periods.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["journal_id"], ["gl_journals.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("contract_id", "period_id", name="uq_recognition_per_period"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_recognition_entries_contract_id",
        "recognition_entries",
        ["contract_id"],
        unique=False,
    )
    op.create_index(
        "ix_recognition_entries_period_id", "recognition_entries", ["period_id"], unique=False
    )

    op.create_table(
        "audit_check_results",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("period_id", sa.Uuid(), nullable=False),
        sa.Column("check_name", sa.String(length=64), nullable=False),
        sa.Column(
            "severity",
            sa.Enum(*AUDIT_SEVERITY, name="audit_severity", native_enum=False, length=8),
            nullable=False,
        ),
        sa.Column("ok", sa.Boolean(), nullable=False),
        sa.Column("message", sa.String(length=500), nullable=False),
        sa.Column("refs", sa.JSON(), nullable=True),
        sa.Column(
            "run_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["period_id"], ["accounting_periods.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_audit_check_results_period_id", "audit_check_results", ["period_id"], unique=False
    )
    op.create_index(
        "ix_audit_check_results_check_name", "audit_check_results", ["check_name"], unique=False
    )

    # ---- AR: customer_invoices ----
    op.create_table(
        "customer_invoices",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("invoice_number", sa.String(length=32), nullable=False),
        sa.Column(
            "invoice_type",
            sa.Enum(
                *CUSTOMER_INVOICE_TYPE,
                name="customer_invoice_type",
                native_enum=False,
                length=16,
            ),
            nullable=False,
            server_default="INVOICE",
        ),
        sa.Column("customer_id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=True),
        sa.Column("shipment_id", sa.Uuid(), nullable=True),
        sa.Column("invoice_date", sa.Date(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EGP"),
        sa.Column("subtotal", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("tax", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("shipping", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("total", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("amount_paid", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("ar_account_code", sa.String(length=16), nullable=False, server_default="1100"),
        sa.Column(
            "status",
            sa.Enum(
                *CUSTOMER_INVOICE_STATUS,
                name="customer_invoice_status",
                native_enum=False,
                length=16,
            ),
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
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["order_id"], ["sales_orders.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["shipment_id"], ["shipments.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["posted_journal_id"], ["gl_journals.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("customer_id", "invoice_number", name="uq_customer_invoice_number"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_customer_invoices_invoice_number",
        "customer_invoices",
        ["invoice_number"],
        unique=True,
    )
    op.create_index(
        "ix_customer_invoices_customer_id", "customer_invoices", ["customer_id"], unique=False
    )
    op.create_index(
        "ix_customer_invoices_order_id", "customer_invoices", ["order_id"], unique=False
    )
    op.create_index(
        "ix_customer_invoices_shipment_id", "customer_invoices", ["shipment_id"], unique=False
    )
    op.create_index(
        "ix_customer_invoices_invoice_date", "customer_invoices", ["invoice_date"], unique=False
    )

    op.create_table(
        "customer_invoice_lines",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("invoice_id", sa.Uuid(), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=False),
        sa.Column("qty", sa.Numeric(12, 4), nullable=False, server_default="1"),
        sa.Column("unit_price", sa.Numeric(18, 4), nullable=False),
        sa.Column("line_total", sa.Numeric(18, 4), nullable=False),
        sa.Column(
            "revenue_account_code", sa.String(length=16), nullable=False, server_default="4010"
        ),
        sa.Column("product_id", sa.Uuid(), nullable=True),
        sa.CheckConstraint("qty > 0", name="ck_cil_qty_positive"),
        sa.ForeignKeyConstraint(["invoice_id"], ["customer_invoices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_customer_invoice_lines_invoice_id",
        "customer_invoice_lines",
        ["invoice_id"],
        unique=False,
    )

    op.create_table(
        "ar_payments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("payment_number", sa.String(length=32), nullable=False),
        sa.Column("customer_id", sa.Uuid(), nullable=False),
        sa.Column("payment_date", sa.Date(), nullable=False),
        sa.Column(
            "method",
            sa.Enum(
                *AR_PAYMENT_METHOD, name="ar_payment_method", native_enum=False, length=16
            ),
            nullable=False,
            server_default="BANK",
        ),
        sa.Column(
            "cash_account_code", sa.String(length=16), nullable=False, server_default="1020"
        ),
        sa.Column("amount", sa.Numeric(18, 4), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EGP"),
        sa.Column("posted_journal_id", sa.Uuid(), nullable=True),
        sa.Column("memo", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("amount > 0", name="ck_ar_payment_amount_pos"),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["posted_journal_id"], ["gl_journals.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_ar_payments_payment_number", "ar_payments", ["payment_number"], unique=True
    )
    op.create_index("ix_ar_payments_customer_id", "ar_payments", ["customer_id"], unique=False)
    op.create_index("ix_ar_payments_payment_date", "ar_payments", ["payment_date"], unique=False)

    op.create_table(
        "ar_payment_applications",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("payment_id", sa.Uuid(), nullable=False),
        sa.Column("invoice_id", sa.Uuid(), nullable=False),
        sa.Column("amount", sa.Numeric(18, 4), nullable=False),
        sa.CheckConstraint("amount > 0", name="ck_ar_app_amount_pos"),
        sa.ForeignKeyConstraint(["payment_id"], ["ar_payments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["invoice_id"], ["customer_invoices.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_ar_payment_applications_payment_id",
        "ar_payment_applications",
        ["payment_id"],
        unique=False,
    )
    op.create_index(
        "ix_ar_payment_applications_invoice_id",
        "ar_payment_applications",
        ["invoice_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_ar_payment_applications_invoice_id", table_name="ar_payment_applications"
    )
    op.drop_index(
        "ix_ar_payment_applications_payment_id", table_name="ar_payment_applications"
    )
    op.drop_table("ar_payment_applications")
    op.drop_index("ix_ar_payments_payment_date", table_name="ar_payments")
    op.drop_index("ix_ar_payments_customer_id", table_name="ar_payments")
    op.drop_index("ix_ar_payments_payment_number", table_name="ar_payments")
    op.drop_table("ar_payments")
    op.drop_index("ix_customer_invoice_lines_invoice_id", table_name="customer_invoice_lines")
    op.drop_table("customer_invoice_lines")
    op.drop_index("ix_customer_invoices_invoice_date", table_name="customer_invoices")
    op.drop_index("ix_customer_invoices_shipment_id", table_name="customer_invoices")
    op.drop_index("ix_customer_invoices_order_id", table_name="customer_invoices")
    op.drop_index("ix_customer_invoices_customer_id", table_name="customer_invoices")
    op.drop_index("ix_customer_invoices_invoice_number", table_name="customer_invoices")
    op.drop_table("customer_invoices")
    op.drop_index("ix_audit_check_results_check_name", table_name="audit_check_results")
    op.drop_index("ix_audit_check_results_period_id", table_name="audit_check_results")
    op.drop_table("audit_check_results")
    op.drop_index("ix_recognition_entries_period_id", table_name="recognition_entries")
    op.drop_index("ix_recognition_entries_contract_id", table_name="recognition_entries")
    op.drop_table("recognition_entries")
    op.drop_index("ix_expense_contracts_supplier_id", table_name="expense_contracts")
    op.drop_index("ix_expense_contracts_code", table_name="expense_contracts")
    op.drop_table("expense_contracts")
    op.drop_table("accounting_periods")
