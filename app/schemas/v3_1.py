"""Pydantic v2 schemas for v0.3.1 (AR, periods, recognition, reports, audits)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, condecimal
from pydantic.alias_generators import to_camel

from app.models.ar import (
    ARPaymentMethod,
    CustomerInvoiceStatus,
    CustomerInvoiceType,
)
from app.models.close import (
    AuditSeverity,
    ContractStatus,
    PeriodStatus,
    RecognitionMode,
)


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


Money = Annotated[Decimal, condecimal(max_digits=18, decimal_places=4)]
Qty = Annotated[Decimal, condecimal(max_digits=12, decimal_places=4)]


# --------------- AR ---------------


class CustomerInvoiceLineCreate(_Camel):
    description: str
    qty: Qty
    unit_price: Money
    revenue_account_code: str = "4010"
    product_id: uuid.UUID | None = None


class CustomerInvoiceCreate(_Camel):
    customer_id: uuid.UUID
    invoice_date: date
    lines: list[CustomerInvoiceLineCreate] = Field(min_length=1)
    order_id: uuid.UUID | None = None
    shipment_id: uuid.UUID | None = None
    due_date: date | None = None
    currency: str = "EGP"
    tax: Money = Decimal("0")
    shipping: Money = Decimal("0")
    ar_account_code: str = "1100"
    memo: str | None = None


class CustomerInvoiceLineRead(_Camel):
    id: uuid.UUID
    description: str
    qty: Qty
    unit_price: Money
    line_total: Money
    revenue_account_code: str
    product_id: uuid.UUID | None


class CustomerInvoiceRead(_Camel):
    id: uuid.UUID
    invoice_number: str
    invoice_type: CustomerInvoiceType
    customer_id: uuid.UUID
    order_id: uuid.UUID | None
    shipment_id: uuid.UUID | None
    invoice_date: date
    due_date: date
    currency: str
    subtotal: Money
    tax: Money
    shipping: Money
    total: Money
    amount_paid: Money
    ar_account_code: str
    status: CustomerInvoiceStatus
    posted_journal_id: uuid.UUID | None
    lines: list[CustomerInvoiceLineRead] = Field(default_factory=list)


class ARPaymentApplyIn(_Camel):
    invoice_id: uuid.UUID
    amount: Money


class ARPaymentCreate(_Camel):
    customer_id: uuid.UUID
    payment_date: date
    amount: Money
    method: ARPaymentMethod = ARPaymentMethod.BANK
    cash_account_code: str = "1020"
    currency: str = "EGP"
    invoice_ids: list[uuid.UUID] | None = None
    memo: str | None = None


class ARPaymentRead(_Camel):
    id: uuid.UUID
    payment_number: str
    customer_id: uuid.UUID
    payment_date: date
    method: ARPaymentMethod
    cash_account_code: str
    amount: Money
    currency: str
    posted_journal_id: uuid.UUID | None
    memo: str | None


class ARAgingRead(_Camel):
    as_of: date
    current: Money
    days_1_30: Money = Field(alias="1_30")
    days_31_60: Money = Field(alias="31_60")
    days_61_90: Money = Field(alias="61_90")
    days_90_plus: Money = Field(alias="90_plus")


# --------------- Periods ---------------


class PeriodRead(_Camel):
    id: uuid.UUID
    year: int
    month: int
    status: PeriodStatus
    locked_at: datetime | None
    locked_by: str | None
    notes: str | None


class PeriodCloseRequest(_Camel):
    year: int = Field(ge=2000, le=2999)
    month: int = Field(ge=1, le=12)
    locked_by: str | None = None


class AuditCheckRead(_Camel):
    name: str
    severity: AuditSeverity
    ok: bool | None = None
    message: str | None = None


class PeriodCloseResult(_Camel):
    period_id: uuid.UUID
    status: PeriodStatus
    locked_at: datetime | None
    locked_by: str | None = None
    checks: list[AuditCheckRead]


# --------------- Recognition ---------------


class ExpenseContractCreate(_Camel):
    code: str
    description: str
    expense_account_code: str
    total_amount: Money
    start_date: date
    recognition_mode: RecognitionMode = RecognitionMode.MONTHLY
    period_months: int | None = None
    end_date: date | None = None
    monthly_amount: Money | None = None
    counter_account_code: str = "2040"
    supplier_id: uuid.UUID | None = None
    currency: str = "EGP"
    memo: str | None = None


class ExpenseContractRead(_Camel):
    id: uuid.UUID
    code: str
    description: str
    expense_account_code: str
    counter_account_code: str
    recognition_mode: RecognitionMode
    currency: str
    total_amount: Money
    monthly_amount: Money | None
    start_date: date
    end_date: date | None
    period_months: int | None
    last_recognized_year: int | None
    last_recognized_month: int | None
    status: ContractStatus
    memo: str | None


class RecognizeRequest(_Camel):
    year: int = Field(ge=2000, le=2999)
    month: int = Field(ge=1, le=12)
    contract_id: uuid.UUID | None = None  # if None, run for all active


# --------------- Reports ---------------


class PnLRead(_Camel):
    period_start: date
    period_end: date
    revenue: dict[str, Money]
    expenses: dict[str, Money]
    revenue_total: Money
    expense_total: Money
    net_income: Money


class BalanceSheetRead(_Camel):
    as_of: date
    assets: dict[str, Money]
    liabilities: dict[str, Money]
    equity: dict[str, Money]
    assets_total: Money
    liabilities_total: Money
    equity_total: Money
    retained_earnings: Money
    balanced: bool


class CashFlowRead(_Camel):
    period_start: date
    period_end: date
    operating: dict[str, Money]
    investing: dict[str, Money]
    financing: dict[str, Money]
    operating_total: Money
    investing_total: Money
    financing_total: Money
    net_change_in_cash: Money


# --------------- Audits ---------------


class AuditCheckDef(_Camel):
    name: str
    severity: AuditSeverity


class AuditResultRead(_Camel):
    id: uuid.UUID
    period_id: uuid.UUID
    check_name: str
    severity: AuditSeverity
    ok: bool
    message: str | None
    refs: dict[str, Any]
    run_at: datetime
