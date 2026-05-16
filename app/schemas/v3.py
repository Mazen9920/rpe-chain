"""Pydantic v2 schemas for v0.3.0 (GL, FX, procurement, AP)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, condecimal
from pydantic.alias_generators import to_camel

from app.models.gl import AccountType, JournalStatus, NormalBalance
from app.models.procurement import (
    GoodsReceiptStatus,
    PaymentMethod,
    POStatus,
    SupplierInvoiceStatus,
    VendorType,
)


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


Money = Annotated[Decimal, condecimal(max_digits=18, decimal_places=4)]
Qty = Annotated[Decimal, condecimal(max_digits=12, decimal_places=4)]


# ---------- GL ----------


class GLAccountRead(_Camel):
    id: uuid.UUID
    code: str
    name: str
    account_type: AccountType
    normal_balance: NormalBalance
    parent_id: uuid.UUID | None
    bs_tag: str | None
    cf_tag: str | None
    is_active: bool


class GLAccountCreate(_Camel):
    code: str = Field(min_length=1, max_length=16)
    name: str = Field(min_length=1, max_length=255)
    account_type: AccountType
    normal_balance: NormalBalance
    parent_id: uuid.UUID | None = None
    bs_tag: str | None = None
    cf_tag: str | None = None


class GLJournalLineRead(_Camel):
    id: uuid.UUID
    account_id: uuid.UUID
    debit: Money
    credit: Money
    currency: str
    fx_rate: Decimal
    base_debit: Money
    base_credit: Money
    dimensions: dict[str, Any] | None


class GLJournalRead(_Camel):
    id: uuid.UUID
    journal_number: str
    event_date: date
    source_doc_type: str
    source_doc_id: uuid.UUID
    memo: str | None
    status: JournalStatus
    posted_at: datetime | None


class TrialBalanceRow(_Camel):
    account_code: str
    debit: Money
    credit: Money
    balance: Money


# ---------- FX ----------


class FxRateRead(_Camel):
    id: uuid.UUID
    from_ccy: str
    to_ccy: str
    as_of_date: date
    rate: Decimal
    source: str | None


class FxRateUpsert(_Camel):
    from_ccy: str = Field(min_length=3, max_length=3)
    to_ccy: str = Field(min_length=3, max_length=3)
    as_of_date: date
    rate: Decimal = Field(gt=0)
    source: str | None = None


# ---------- Procurement ----------


class SupplierRead(_Camel):
    id: uuid.UUID
    code: str
    name: str
    vendor_type: VendorType
    currency: str
    payment_terms_days: int
    is_active: bool
    ap_account_code: str | None


class SupplierCreate(_Camel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=255)
    vendor_type: VendorType
    currency: str = "EGP"
    payment_terms_days: int = 0
    ap_account_code: str | None = None


class POLineCreate(_Camel):
    product_id: uuid.UUID
    qty: Qty = Field(gt=0)
    unit_price: Money = Field(ge=0)


class POLineRead(_Camel):
    id: uuid.UUID
    product_id: uuid.UUID
    position: int
    qty_ordered: Qty
    qty_received: Qty
    qty_invoiced: Qty
    unit_price: Money


class PurchaseOrderCreate(_Camel):
    supplier_id: uuid.UUID
    warehouse_id: uuid.UUID
    lines: list[POLineCreate]
    currency: str = "EGP"
    fx_rate: Decimal = Decimal("1")
    order_date: date | None = None
    expected_date: date | None = None
    landed_cost_total: Money = Decimal("0")
    notes: str | None = None


class PurchaseOrderRead(_Camel):
    id: uuid.UUID
    po_number: str
    supplier_id: uuid.UUID
    warehouse_id: uuid.UUID
    currency: str
    fx_rate: Decimal
    status: POStatus
    order_date: date
    expected_date: date | None
    landed_cost_total: Money
    notes: str | None
    lines: list[POLineRead] = []


class GRLineInput(_Camel):
    po_line_id: uuid.UUID
    qty: Qty = Field(gt=0)


class GoodsReceiptCreate(_Camel):
    po_id: uuid.UUID
    lines: list[GRLineInput]
    received_at: date | None = None
    extra_landed_cost: Money = Decimal("0")


class GoodsReceiptLineRead(_Camel):
    id: uuid.UUID
    po_line_id: uuid.UUID
    product_id: uuid.UUID
    qty: Qty
    unit_cost: Money
    landed_per_unit: Money
    cost_layer_id: uuid.UUID | None


class GoodsReceiptRead(_Camel):
    id: uuid.UUID
    gr_number: str
    po_id: uuid.UUID
    warehouse_id: uuid.UUID
    received_at: date
    landed_cost_allocated: Money
    status: GoodsReceiptStatus
    lines: list[GoodsReceiptLineRead] = []


# ---------- AP ----------


class InvoiceLineInput(_Camel):
    description: str
    account_code: str = Field(min_length=1, max_length=16)
    qty: Qty = Field(gt=0)
    unit_price: Money = Field(ge=0)
    po_line_id: uuid.UUID | None = None


class SupplierInvoiceCreate(_Camel):
    supplier_id: uuid.UUID
    invoice_number: str = Field(min_length=1, max_length=64)
    invoice_date: date
    lines: list[InvoiceLineInput]
    tax: Money = Decimal("0")
    po_id: uuid.UUID | None = None
    currency: str | None = None
    fx_rate: Decimal = Decimal("1")
    due_date: date | None = None


class SupplierInvoiceLineRead(_Camel):
    id: uuid.UUID
    po_line_id: uuid.UUID | None
    description: str
    account_code: str
    qty: Qty
    unit_price: Money
    amount: Money


class SupplierInvoiceRead(_Camel):
    id: uuid.UUID
    invoice_number: str
    supplier_id: uuid.UUID
    po_id: uuid.UUID | None
    currency: str
    fx_rate: Decimal
    invoice_date: date
    due_date: date
    subtotal: Money
    tax: Money
    total: Money
    amount_paid: Money
    status: SupplierInvoiceStatus
    posted_journal_id: uuid.UUID | None
    lines: list[SupplierInvoiceLineRead] = []


class APPaymentCreate(_Camel):
    invoice_id: uuid.UUID
    payment_date: date
    amount: Money = Field(gt=0)
    cash_account_code: str = "1020"
    method: PaymentMethod = PaymentMethod.BANK
    note: str | None = None


class APPaymentRead(_Camel):
    id: uuid.UUID
    payment_number: str
    supplier_id: uuid.UUID
    payment_date: date
    method: PaymentMethod
    currency: str
    amount: Money
    cash_account_code: str
    posted_journal_id: uuid.UUID | None
    note: str | None


class AgingBucketsRead(_Camel):
    current: Money
    bucket_1_30: Money = Field(alias="bucket1_30")
    bucket_31_60: Money = Field(alias="bucket31_60")
    bucket_61_90: Money = Field(alias="bucket61_90")
    bucket_90_plus: Money = Field(alias="bucket90Plus")
