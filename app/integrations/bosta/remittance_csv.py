"""Bosta remittance statement CSV parser.

Bosta sends a remittance statement when COD funds settle to your bank.
Columns vary; we map common aliases:
- tracking_number / awb / tracking_id        → tracking_id
- cod_amount / cod / amount                  → cod_amount
- delivery_fee / shipping_fee / fee          → delivery_fee
- delivered_at / delivered_date              → delivered_at
- remitted_at / remittance_date              → remitted_at
- remittance_ref / batch / statement         → remittance_ref
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
class BostaRemittanceRow:
    tracking_id: str
    cod_amount: Decimal
    delivery_fee: Decimal
    delivered_at: datetime | None
    remitted_at: datetime
    remittance_ref: str | None
    status: str
    raw: dict[str, Any]


_HEADER_ALIASES: dict[str, tuple[str, ...]] = {
    "tracking_id": ("tracking_number", "awb", "tracking_id", "tracking"),
    "cod_amount": ("cod_amount", "cod", "amount", "cod_value"),
    "delivery_fee": ("delivery_fee", "shipping_fee", "fee", "bosta_fee"),
    "delivered_at": ("delivered_at", "delivered_date", "delivery_date"),
    "remitted_at": ("remitted_at", "remittance_date", "transfer_date", "deposit_date"),
    "remittance_ref": ("remittance_ref", "batch", "statement", "reference"),
    "status": ("status", "state"),
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
    for fmt in (None, "%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d/%m/%Y %H:%M", "%d/%m/%Y"):
        try:
            if fmt is None:
                return datetime.fromisoformat(s.replace("Z", "+00:00"))
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    raise ValueError(f"Unrecognized datetime format: {value!r}")


def parse_remittance_csv(content: str | bytes) -> list[BostaRemittanceRow]:
    text = content.decode("utf-8-sig") if isinstance(content, bytes) else content
    reader = csv.DictReader(io.StringIO(text))
    rows: list[BostaRemittanceRow] = []
    for raw in reader:
        norm = {(k or "").strip().lower(): v for k, v in raw.items() if k}
        tracking = _pick(norm, "tracking_id")
        if not tracking:
            continue
        remitted = _to_datetime(_pick(norm, "remitted_at"))
        if remitted is None:
            remitted = datetime.combine(date.today(), datetime.min.time())
        rows.append(
            BostaRemittanceRow(
                tracking_id=str(tracking).strip(),
                cod_amount=_to_decimal(_pick(norm, "cod_amount")),
                delivery_fee=_to_decimal(_pick(norm, "delivery_fee")),
                delivered_at=_to_datetime(_pick(norm, "delivered_at")),
                remitted_at=remitted,
                remittance_ref=(
                    str(_pick(norm, "remittance_ref")).strip()
                    if _pick(norm, "remittance_ref")
                    else None
                ),
                status=str(_pick(norm, "status") or "DELIVERED").upper().strip(),
                raw=dict(norm),
            )
        )
    return rows


__all__ = ["BostaRemittanceRow", "parse_remittance_csv"]
