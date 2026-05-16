"""Paymob settlement statement CSV parser.

Paymob emails a daily settlement statement (CSV) containing one row per
transaction settled to bank. Columns vary between merchants; we use a
defensive header-mapping approach.

Expected columns (case-insensitive, common aliases handled):
- transaction_id / txn_id / external_id      → external_id
- order_id / merchant_order_id               → order_external_id
- amount / amount_egp / gross_amount         → amount_gross
- fees / fee / processing_fee                → fees
- net_amount / amount_net / settled_amount   → amount_net  (computed if absent)
- captured_at / transaction_date             → captured_at
- settled_at / settlement_date               → settled_at
- settlement_ref / batch_id                  → settlement_ref
- payment_method / method                    → payment_method
- status                                     → status
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any


@dataclass(frozen=True)
class PaymobSettlementRow:
    external_id: str
    order_external_id: str | None
    amount_gross: Decimal
    fees: Decimal
    amount_net: Decimal
    currency: str
    captured_at: datetime
    settled_at: datetime | None
    settlement_ref: str | None
    payment_method: str
    status: str
    raw: dict[str, Any]


_HEADER_ALIASES: dict[str, tuple[str, ...]] = {
    "external_id": ("transaction_id", "txn_id", "external_id", "id"),
    "order_external_id": ("order_id", "merchant_order_id", "order_external_id"),
    "amount_gross": ("amount", "amount_egp", "gross_amount", "amount_gross"),
    "fees": ("fees", "fee", "processing_fee", "gateway_fee"),
    "amount_net": ("net_amount", "amount_net", "settled_amount", "net"),
    "currency": ("currency", "ccy"),
    "captured_at": ("captured_at", "transaction_date", "txn_date", "created_at"),
    "settled_at": ("settled_at", "settlement_date", "settlement_at"),
    "settlement_ref": ("settlement_ref", "batch_id", "statement_id"),
    "payment_method": ("payment_method", "method", "source_type"),
    "status": ("status", "transaction_status"),
}


def _pick(row: dict[str, Any], canonical: str) -> Any:
    for alias in _HEADER_ALIASES[canonical]:
        if alias in row and row[alias] not in ("", None):
            return row[alias]
    return None


def _to_decimal(value: Any) -> Decimal:
    if value in (None, ""):
        return Decimal("0")
    return Decimal(str(value).replace(",", "").strip())


def _to_datetime(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    s = str(value).strip()
    # try ISO-8601 first, then a couple of common formats
    for fmt in (None, "%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d/%m/%Y %H:%M", "%d/%m/%Y"):
        try:
            if fmt is None:
                return datetime.fromisoformat(s.replace("Z", "+00:00"))
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    raise ValueError(f"Unrecognized datetime format: {value!r}")


def parse_settlement_csv(content: str | bytes) -> list[PaymobSettlementRow]:
    """Parse Paymob settlement CSV → list of typed rows. Headers normalized to lowercase."""
    text = content.decode("utf-8-sig") if isinstance(content, bytes) else content
    reader = csv.DictReader(io.StringIO(text))
    rows: list[PaymobSettlementRow] = []
    for raw in reader:
        norm = {(k or "").strip().lower(): v for k, v in raw.items() if k}
        external_id = _pick(norm, "external_id")
        if not external_id:
            continue
        amount_gross = _to_decimal(_pick(norm, "amount_gross"))
        fees = _to_decimal(_pick(norm, "fees"))
        net_raw = _pick(norm, "amount_net")
        amount_net = _to_decimal(net_raw) if net_raw is not None else amount_gross - fees
        captured_at = _to_datetime(_pick(norm, "captured_at"))
        if captured_at is None:
            captured_at = datetime.combine(date.today(), datetime.min.time())
        rows.append(
            PaymobSettlementRow(
                external_id=str(external_id).strip(),
                order_external_id=(
                    str(_pick(norm, "order_external_id")).strip()
                    if _pick(norm, "order_external_id")
                    else None
                ),
                amount_gross=amount_gross,
                fees=fees,
                amount_net=amount_net,
                currency=str(_pick(norm, "currency") or "EGP").upper().strip(),
                captured_at=captured_at,
                settled_at=_to_datetime(_pick(norm, "settled_at")),
                settlement_ref=(
                    str(_pick(norm, "settlement_ref")).strip()
                    if _pick(norm, "settlement_ref")
                    else None
                ),
                payment_method=str(_pick(norm, "payment_method") or "CARD").upper().strip(),
                status=str(_pick(norm, "status") or "SETTLED").upper().strip(),
                raw=dict(norm),
            )
        )
    return rows


__all__ = ["PaymobSettlementRow", "parse_settlement_csv"]
