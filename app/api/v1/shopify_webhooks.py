"""Shopify webhook ingress. HMAC verify → record event → dedupe → enqueue or project inline."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.logging import get_logger
from app.services import shopify_inbound

router = APIRouter(tags=["shopify-webhooks"])
log = get_logger("shopify.webhook")


@router.post("/webhooks/shopify/orders-create")
async def orders_create(
    request: Request,
    x_shopify_hmac_sha256: str = Header(default=""),
    x_shopify_webhook_id: str = Header(default=""),
    x_shopify_topic: str = Header(default="orders/create"),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    body = await request.body()
    sig_ok = shopify_inbound.verify_hmac(body, x_shopify_hmac_sha256)
    payload = await request.json() if body else {}
    ev = await shopify_inbound.record_event(
        db,
        topic=x_shopify_topic,
        external_id=str(payload.get("id", "")),
        raw_payload=payload,
        signature_ok=sig_ok,
    )
    if not sig_ok:
        await db.commit()
        return JSONResponse(status_code=401, content={"code": "bad_signature"})
    claimed = await shopify_inbound.claim_idempotency(
        db, scope=f"shopify.{x_shopify_topic}", key=x_shopify_webhook_id or str(ev.id)
    )
    if not claimed:
        await db.commit()
        return JSONResponse(status_code=200, content={"status": "duplicate"})
    await shopify_inbound.process_orders_create(db, payload)
    await db.commit()
    return JSONResponse(status_code=200, content={"status": "ok", "event_id": str(ev.id)})


@router.post("/webhooks/shopify/orders-cancelled")
async def orders_cancelled(
    request: Request,
    x_shopify_hmac_sha256: str = Header(default=""),
    x_shopify_webhook_id: str = Header(default=""),
    x_shopify_topic: str = Header(default="orders/cancelled"),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    body = await request.body()
    sig_ok = shopify_inbound.verify_hmac(body, x_shopify_hmac_sha256)
    payload = await request.json() if body else {}
    ev = await shopify_inbound.record_event(
        db,
        topic=x_shopify_topic,
        external_id=str(payload.get("id", "")),
        raw_payload=payload,
        signature_ok=sig_ok,
    )
    if not sig_ok:
        await db.commit()
        return JSONResponse(status_code=401, content={"code": "bad_signature"})
    claimed = await shopify_inbound.claim_idempotency(
        db, scope=f"shopify.{x_shopify_topic}", key=x_shopify_webhook_id or str(ev.id)
    )
    if not claimed:
        await db.commit()
        return JSONResponse(status_code=200, content={"status": "duplicate"})
    await shopify_inbound.process_orders_cancelled(db, payload)
    await db.commit()
    return JSONResponse(status_code=200, content={"status": "ok"})


@router.post("/webhooks/shopify/products-update")
async def products_update(
    request: Request,
    x_shopify_hmac_sha256: str = Header(default=""),
    x_shopify_webhook_id: str = Header(default=""),
    x_shopify_topic: str = Header(default="products/update"),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    body = await request.body()
    sig_ok = shopify_inbound.verify_hmac(body, x_shopify_hmac_sha256)
    payload = await request.json() if body else {}
    ev = await shopify_inbound.record_event(
        db,
        topic=x_shopify_topic,
        external_id=str(payload.get("id", "")),
        raw_payload=payload,
        signature_ok=sig_ok,
    )
    if not sig_ok:
        await db.commit()
        return JSONResponse(status_code=401, content={"code": "bad_signature"})
    claimed = await shopify_inbound.claim_idempotency(
        db, scope=f"shopify.{x_shopify_topic}", key=x_shopify_webhook_id or str(ev.id)
    )
    if not claimed:
        await db.commit()
        return JSONResponse(status_code=200, content={"status": "duplicate"})
    updated = await shopify_inbound.process_products_update(db, payload)
    await db.commit()
    return JSONResponse(status_code=200, content={"status": "ok", "updated": updated})
