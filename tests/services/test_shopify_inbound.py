"""Shopify inbound: HMAC verification + idempotency claim."""

from __future__ import annotations

import hashlib
import hmac
from base64 import b64encode

import pytest

from app.services import shopify_inbound


def _sign(body: bytes, secret: str) -> str:
    return b64encode(hmac.new(secret.encode(), body, hashlib.sha256).digest()).decode()


def test_verify_hmac_ok():
    body = b'{"id":1}'
    secret = "supersecret-shopify-test-key-32!!"
    sig = _sign(body, secret)
    assert shopify_inbound.verify_hmac(body, sig, secret=secret) is True


def test_verify_hmac_bad():
    body = b'{"id":1}'
    secret = "supersecret-shopify-test-key-32!!"
    assert shopify_inbound.verify_hmac(body, "deadbeef==", secret=secret) is False


def test_verify_hmac_no_secret():
    assert shopify_inbound.verify_hmac(b"x", "y", secret="") is False


@pytest.mark.asyncio
async def test_claim_idempotency_first_then_dup(db_session):
    first = await shopify_inbound.claim_idempotency(db_session, "shopify.orders/create", "evt-1")
    second = await shopify_inbound.claim_idempotency(db_session, "shopify.orders/create", "evt-1")
    assert first is True
    assert second is False
