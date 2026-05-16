"""Shopify inbound webhook processing.

Goal: sync data, not drive control flow. Webhook → IntegrationEvent (raw) →
IdempotencyKey dedupe → projector writes domain rows. No business policy here.
"""

from __future__ import annotations

import hashlib
import hmac
import uuid
from base64 import b64encode
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.integrations import (
    IdempotencyKey,
    IntegrationEvent,
    IntegrationSource,
)
from app.models.product import Product
from app.models.sales import (
    Customer,
    SalesOrder,
    SalesOrderSource,
    SalesOrderStatus,
)
from app.services import sales as sales_svc

log = get_logger("shopify.inbound")


def verify_hmac(body: bytes, header_sig: str, secret: str | None = None) -> bool:
    secret = secret or get_settings().shopify_webhook_secret
    if not secret:
        return False
    digest = hmac.new(secret.encode(), body, hashlib.sha256).digest()
    expected = b64encode(digest).decode()
    return hmac.compare_digest(expected, header_sig or "")


async def claim_idempotency(session: AsyncSession, scope: str, key: str) -> bool:
    """Atomically claim an idempotency key. Returns True if newly claimed, False if dup."""
    session.add(IdempotencyKey(scope=scope, key=key))
    try:
        await session.flush()
        return True
    except IntegrityError:
        await session.rollback()
        return False


async def record_event(
    session: AsyncSession,
    *,
    topic: str,
    external_id: str | None,
    raw_payload: Any,
    signature_ok: bool,
) -> IntegrationEvent:
    ev = IntegrationEvent(
        source=IntegrationSource.SHOPIFY,
        topic=topic,
        external_id=external_id,
        raw_payload=raw_payload,
        signature_ok=signature_ok,
    )
    session.add(ev)
    await session.flush()
    return ev


# ---------- projectors ----------


async def _upsert_customer(session: AsyncSession, payload: dict[str, Any]) -> Customer:
    cust_payload = payload.get("customer") or {}
    ext_id = str(cust_payload.get("id") or payload.get("email") or "unknown")
    stmt = select(Customer).where(Customer.external_id == ext_id)
    cust = (await session.execute(stmt)).scalar_one_or_none()
    if cust is not None:
        return cust
    cust = Customer(
        code=f"SHP-{ext_id[-12:]}",
        name=(cust_payload.get("first_name", "") + " " + cust_payload.get("last_name", "")).strip()
        or payload.get("email")
        or "Shopify Customer",
        email=cust_payload.get("email") or payload.get("email"),
        phone=cust_payload.get("phone"),
        currency=payload.get("currency", "EGP"),
        external_id=ext_id,
    )
    session.add(cust)
    await session.flush()
    return cust


async def _resolve_product_by_sku(session: AsyncSession, sku: str) -> Product | None:
    if not sku:
        return None
    stmt = select(Product).where(Product.sku == sku)
    return (await session.execute(stmt)).scalar_one_or_none()


async def process_orders_create(
    session: AsyncSession, payload: dict[str, Any], *, default_warehouse_id: uuid.UUID | None = None
) -> SalesOrder:
    """Project a Shopify orders/create payload into a SalesOrder. Expand bundles + confirm."""
    external_id = str(payload.get("id") or payload.get("name"))
    # idempotency on external id (in addition to webhook-id at handler)
    stmt = select(SalesOrder).where(
        SalesOrder.source == SalesOrderSource.SHOPIFY,
        SalesOrder.external_id == external_id,
    )
    existing = (await session.execute(stmt)).scalar_one_or_none()
    if existing is not None:
        return existing

    customer = await _upsert_customer(session, payload)

    lines_payload: list[dict[str, Any]] = []
    for li in payload.get("line_items", []):
        sku = li.get("sku") or ""
        product = await _resolve_product_by_sku(session, sku)
        if product is None:
            log.warning("shopify_sku_not_found", sku=sku, order=external_id)
            continue
        qty = Decimal(str(li.get("quantity", 1)))
        unit_price = Decimal(str(li.get("price", "0")))
        lines_payload.append(
            {
                "product_id": product.id,
                "qty": qty,
                "unit_price": unit_price,
                "line_total": unit_price * qty,
            }
        )

    order_date_raw = payload.get("created_at")
    try:
        order_date = (
            datetime.fromisoformat(order_date_raw.replace("Z", "+00:00")).date()
            if order_date_raw
            else date.today()
        )
    except (ValueError, AttributeError):
        order_date = date.today()

    order = await sales_svc.create_order(
        session,
        customer_id=customer.id,
        warehouse_id=default_warehouse_id,
        lines=lines_payload,
        source=SalesOrderSource.SHOPIFY,
        external_id=external_id,
        order_date=order_date,
        currency=payload.get("currency", "EGP"),
        order_number=f"SHP-{external_id}",
    )
    await sales_svc.expand_bundles(session, order.id)
    await sales_svc.confirm(session, order.id)
    return order


async def process_orders_cancelled(
    session: AsyncSession, payload: dict[str, Any]
) -> SalesOrder | None:
    external_id = str(payload.get("id") or payload.get("name"))
    stmt = select(SalesOrder).where(
        SalesOrder.source == SalesOrderSource.SHOPIFY,
        SalesOrder.external_id == external_id,
    )
    order = (await session.execute(stmt)).scalar_one_or_none()
    if order is None:
        return None
    if order.status in (SalesOrderStatus.SHIPPED, SalesOrderStatus.DELIVERED):
        log.warning("shopify_cancel_after_ship", order=external_id, status=order.status.value)
        return order
    await sales_svc.cancel(session, order.id)
    return order


async def process_products_update(session: AsyncSession, payload: dict[str, Any]) -> int:
    """Sync selling_price + external_id from Shopify products/update. Returns updated row count."""
    ext_product_id = str(payload.get("id"))
    updated = 0
    for v in payload.get("variants", []):
        sku = v.get("sku")
        if not sku:
            continue
        prod = await _resolve_product_by_sku(session, sku)
        if prod is None:
            continue
        price = v.get("price")
        if price is not None:
            prod.selling_price = Decimal(str(price))
        prod.external_id = f"{ext_product_id}:{v.get('id')}"
        updated += 1
    await session.flush()
    return updated


__all__ = [
    "claim_idempotency",
    "process_orders_cancelled",
    "process_orders_create",
    "process_products_update",
    "record_event",
    "verify_hmac",
]
