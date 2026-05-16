"""Schemas for v0.4.0 — Paymob, Bosta COD, bank, chargebacks."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.models.payments import (
    BankTxnMatchType,
    BankTxnStatus,
    ChargebackStatus,
    CODStatus,
    PaymobPaymentMethod,
    PaymobTxnStatus,
)


class _CamelBase(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


# ----- Paymob -----


class PaymobTransactionOut(_CamelBase):
    id: uuid.UUID
    external_id: str
    order_external_id: str | None
    payment_method: PaymobPaymentMethod
    amount_gross: Decimal
    fees: Decimal
    amount_net: Decimal
    currency: str
    status: PaymobTxnStatus
    captured_at: datetime
    settled_at: datetime | None
    settlement_ref: str | None
    posted_journal_id: uuid.UUID | None


class PaymobReconReport(_CamelBase):
    created: int
    updated: int
    settled_posted: int


# ----- COD -----


class CODLedgerEntryOut(_CamelBase):
    id: uuid.UUID
    tracking_id: str
    order_id: uuid.UUID | None
    customer_id: uuid.UUID | None
    cod_amount: Decimal
    delivery_fee: Decimal
    currency: str
    status: CODStatus
    shipped_at: datetime | None
    delivered_at: datetime | None
    remitted_at: datetime | None
    remittance_ref: str | None
    posted_journal_id: uuid.UUID | None


class CODRemittanceReport(_CamelBase):
    matched: int
    unknown: int
    already_remitted: int


class CODVoidRateOut(_CamelBase):
    window_days: int
    void_rate: Decimal
    threshold: Decimal = Field(default=Decimal("0.10"))


class CODShipmentCreate(_CamelBase):
    tracking_id: str
    cod_amount: Decimal
    delivery_fee: Decimal = Decimal("0")
    currency: str = "EGP"
    order_id: uuid.UUID | None = None
    customer_invoice_id: uuid.UUID | None = None
    customer_id: uuid.UUID | None = None


# ----- Bank -----


class BankAccountCreate(_CamelBase):
    code: str
    name: str
    bank_name: str
    account_number: str | None = None
    currency: str = "EGP"
    gl_account_code: str = "1020"


class BankAccountOut(_CamelBase):
    id: uuid.UUID
    code: str
    name: str
    bank_name: str
    account_number: str | None
    currency: str
    gl_account_code: str
    is_active: bool


class BankStatementRowIn(_CamelBase):
    transaction_date: date
    amount: Decimal
    description: str | None = None
    external_ref: str | None = None
    statement_ref: str | None = None


class BankStatementImport(_CamelBase):
    bank_account_id: uuid.UUID
    rows: list[BankStatementRowIn]


class BankTransactionOut(_CamelBase):
    id: uuid.UUID
    bank_account_id: uuid.UUID
    transaction_date: date
    amount: Decimal
    currency: str
    description: str | None
    external_ref: str | None
    statement_ref: str | None
    status: BankTxnStatus
    matched_type: BankTxnMatchType | None
    matched_doc_id: uuid.UUID | None
    matched_at: datetime | None


class BankAutoMatchReport(_CamelBase):
    scanned: int
    matched_paymob: int
    matched_bosta: int
    unmatched: int


# ----- Chargebacks -----


class ChargebackCreate(_CamelBase):
    paymob_transaction_id: uuid.UUID
    amount: Decimal
    reason: str | None = None


class ChargebackResolve(_CamelBase):
    outcome: ChargebackStatus


class ChargebackOut(_CamelBase):
    id: uuid.UUID
    paymob_transaction_id: uuid.UUID
    amount: Decimal
    currency: str
    reason: str | None
    status: ChargebackStatus
    raised_at: datetime
    resolved_at: datetime | None
    raised_journal_id: uuid.UUID | None
    resolved_journal_id: uuid.UUID | None


__all__ = [
    "BankAccountCreate",
    "BankAccountOut",
    "BankAutoMatchReport",
    "BankStatementImport",
    "BankStatementRowIn",
    "BankTransactionOut",
    "CODLedgerEntryOut",
    "CODRemittanceReport",
    "CODShipmentCreate",
    "CODVoidRateOut",
    "ChargebackCreate",
    "ChargebackOut",
    "ChargebackResolve",
    "PaymobReconReport",
    "PaymobTransactionOut",
]
