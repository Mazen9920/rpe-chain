"""Paymob + Bosta COD + Bank + Chargebacks (v0.4.0).

Revision ID: 0006_paymob_bosta_bank_chargebacks
Revises: 0005_recognition_close_ar
Create Date: 2026-05-16 23:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006_paymob_bosta_bank_chargebacks"
down_revision = "0005_recognition_close_ar"
branch_labels = None
depends_on = None


PAYMOB_TXN_STATUS = ("CAPTURED", "SETTLED", "REFUNDED", "CHARGEBACK", "VOIDED")
PAYMOB_PAYMENT_METHOD = ("CARD", "WALLET", "INSTALLMENTS", "KIOSK", "OTHER")
COD_STATUS = (
    "PENDING",
    "IN_TRANSIT",
    "DELIVERED_UNREMITTED",
    "DELIVERED_REMITTED",
    "RETURNED",
    "VOIDED",
)
BANK_TXN_STATUS = ("UNMATCHED", "MATCHED", "IGNORED")
BANK_TXN_MATCH_TYPE = (
    "AP_PAYMENT",
    "AR_PAYMENT",
    "PAYMOB_SETTLEMENT",
    "BOSTA_REMITTANCE",
    "MANUAL",
)
CHARGEBACK_STATUS = ("OPEN", "WON", "LOST", "CANCELLED")


def upgrade() -> None:
    # ---- paymob_transactions ----
    op.create_table(
        "paymob_transactions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("external_id", sa.String(length=64), nullable=False),
        sa.Column("order_external_id", sa.String(length=64), nullable=True),
        sa.Column("order_id", sa.Uuid(), nullable=True),
        sa.Column("customer_invoice_id", sa.Uuid(), nullable=True),
        sa.Column(
            "payment_method",
            sa.Enum(
                *PAYMOB_PAYMENT_METHOD,
                name="paymob_payment_method",
                native_enum=False,
                length=16,
            ),
            nullable=False,
            server_default="CARD",
        ),
        sa.Column("amount_gross", sa.Numeric(18, 4), nullable=False),
        sa.Column("fees", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("amount_net", sa.Numeric(18, 4), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EGP"),
        sa.Column(
            "status",
            sa.Enum(*PAYMOB_TXN_STATUS, name="paymob_txn_status", native_enum=False, length=16),
            nullable=False,
            server_default="CAPTURED",
        ),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("settlement_ref", sa.String(length=64), nullable=True),
        sa.Column("posted_journal_id", sa.Uuid(), nullable=True),
        sa.Column("raw_payload", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("amount_gross >= 0", name="ck_paymob_gross_positive"),
        sa.CheckConstraint("fees >= 0", name="ck_paymob_fees_positive"),
        sa.ForeignKeyConstraint(["order_id"], ["sales_orders.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["customer_invoice_id"], ["customer_invoices.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["posted_journal_id"], ["gl_journals.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_paymob_transactions_external_id",
        "paymob_transactions",
        ["external_id"],
        unique=True,
    )
    op.create_index(
        "ix_paymob_transactions_order_external_id",
        "paymob_transactions",
        ["order_external_id"],
    )
    op.create_index("ix_paymob_transactions_order_id", "paymob_transactions", ["order_id"])
    op.create_index(
        "ix_paymob_transactions_customer_invoice_id",
        "paymob_transactions",
        ["customer_invoice_id"],
    )
    op.create_index("ix_paymob_transactions_status", "paymob_transactions", ["status"])
    op.create_index(
        "ix_paymob_transactions_settlement_ref", "paymob_transactions", ["settlement_ref"]
    )

    # ---- cod_ledger ----
    op.create_table(
        "cod_ledger",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tracking_id", sa.String(length=64), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=True),
        sa.Column("customer_invoice_id", sa.Uuid(), nullable=True),
        sa.Column("customer_id", sa.Uuid(), nullable=True),
        sa.Column("cod_amount", sa.Numeric(18, 4), nullable=False),
        sa.Column("delivery_fee", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EGP"),
        sa.Column(
            "status",
            sa.Enum(*COD_STATUS, name="cod_status", native_enum=False, length=24),
            nullable=False,
            server_default="PENDING",
        ),
        sa.Column("shipped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("remitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("remittance_ref", sa.String(length=64), nullable=True),
        sa.Column("posted_journal_id", sa.Uuid(), nullable=True),
        sa.Column("raw_payload", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("cod_amount >= 0", name="ck_cod_amount_positive"),
        sa.ForeignKeyConstraint(["order_id"], ["sales_orders.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["customer_invoice_id"], ["customer_invoices.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["posted_journal_id"], ["gl_journals.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cod_ledger_tracking_id", "cod_ledger", ["tracking_id"], unique=True)
    op.create_index("ix_cod_ledger_order_id", "cod_ledger", ["order_id"])
    op.create_index("ix_cod_ledger_customer_invoice_id", "cod_ledger", ["customer_invoice_id"])
    op.create_index("ix_cod_ledger_customer_id", "cod_ledger", ["customer_id"])
    op.create_index("ix_cod_ledger_status", "cod_ledger", ["status"])
    op.create_index("ix_cod_ledger_remittance_ref", "cod_ledger", ["remittance_ref"])

    # ---- bank_accounts ----
    op.create_table(
        "bank_accounts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("bank_name", sa.String(length=255), nullable=False),
        sa.Column("account_number", sa.String(length=64), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EGP"),
        sa.Column("gl_account_code", sa.String(length=16), nullable=False, server_default="1020"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_bank_accounts_code", "bank_accounts", ["code"], unique=True)

    # ---- bank_transactions ----
    op.create_table(
        "bank_transactions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("bank_account_id", sa.Uuid(), nullable=False),
        sa.Column("transaction_date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(18, 4), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EGP"),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("external_ref", sa.String(length=128), nullable=True),
        sa.Column("statement_ref", sa.String(length=128), nullable=True),
        sa.Column(
            "status",
            sa.Enum(*BANK_TXN_STATUS, name="bank_txn_status", native_enum=False, length=16),
            nullable=False,
            server_default="UNMATCHED",
        ),
        sa.Column(
            "matched_type",
            sa.Enum(
                *BANK_TXN_MATCH_TYPE,
                name="bank_txn_match_type",
                native_enum=False,
                length=24,
            ),
            nullable=True,
        ),
        sa.Column("matched_doc_id", sa.Uuid(), nullable=True),
        sa.Column("matched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["bank_account_id"], ["bank_accounts.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "bank_account_id", "external_ref", name="uq_bank_txn_account_external_ref"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_bank_transactions_bank_account_id", "bank_transactions", ["bank_account_id"]
    )
    op.create_index(
        "ix_bank_transactions_transaction_date", "bank_transactions", ["transaction_date"]
    )
    op.create_index("ix_bank_transactions_external_ref", "bank_transactions", ["external_ref"])
    op.create_index("ix_bank_transactions_statement_ref", "bank_transactions", ["statement_ref"])
    op.create_index("ix_bank_transactions_status", "bank_transactions", ["status"])

    # ---- chargebacks ----
    op.create_table(
        "chargebacks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("paymob_transaction_id", sa.Uuid(), nullable=False),
        sa.Column("amount", sa.Numeric(18, 4), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EGP"),
        sa.Column("reason", sa.String(length=500), nullable=True),
        sa.Column(
            "status",
            sa.Enum(*CHARGEBACK_STATUS, name="chargeback_status", native_enum=False, length=16),
            nullable=False,
            server_default="OPEN",
        ),
        sa.Column(
            "raised_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("raised_journal_id", sa.Uuid(), nullable=True),
        sa.Column("resolved_journal_id", sa.Uuid(), nullable=True),
        sa.Column("notes", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("amount > 0", name="ck_chargeback_amount_positive"),
        sa.ForeignKeyConstraint(
            ["paymob_transaction_id"], ["paymob_transactions.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(["raised_journal_id"], ["gl_journals.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["resolved_journal_id"], ["gl_journals.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_chargebacks_paymob_transaction_id", "chargebacks", ["paymob_transaction_id"]
    )
    op.create_index("ix_chargebacks_status", "chargebacks", ["status"])


def downgrade() -> None:
    op.drop_table("chargebacks")
    op.drop_table("bank_transactions")
    op.drop_table("bank_accounts")
    op.drop_table("cod_ledger")
    op.drop_table("paymob_transactions")
