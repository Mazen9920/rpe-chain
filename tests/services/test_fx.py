"""FX rate lookup tests."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.services import fx as fx_svc

pytestmark = pytest.mark.asyncio


async def test_get_rate_identity(db_session):
    rate = await fx_svc.get_rate(db_session, from_ccy="EGP", to_ccy="EGP", when=date(2026, 1, 1))
    assert rate == Decimal("1")


async def test_get_rate_falls_back_to_prior(db_session):
    await fx_svc.upsert_rate(
        db_session,
        from_ccy="USD",
        to_ccy="EGP",
        as_of=date(2026, 1, 1),
        rate=Decimal("50"),
    )
    await fx_svc.upsert_rate(
        db_session,
        from_ccy="USD",
        to_ccy="EGP",
        as_of=date(2026, 2, 1),
        rate=Decimal("51"),
    )
    r_jan = await fx_svc.get_rate(db_session, from_ccy="USD", to_ccy="EGP", when=date(2026, 1, 15))
    r_feb = await fx_svc.get_rate(db_session, from_ccy="USD", to_ccy="EGP", when=date(2026, 2, 10))
    assert r_jan == Decimal("50")
    assert r_feb == Decimal("51")


async def test_get_rate_missing_raises(db_session):
    with pytest.raises(fx_svc.FxRateNotFoundError):
        await fx_svc.get_rate(db_session, from_ccy="USD", to_ccy="EGP", when=date(2020, 1, 1))


async def test_upsert_replaces_existing(db_session):
    r1 = await fx_svc.upsert_rate(
        db_session,
        from_ccy="USD",
        to_ccy="EGP",
        as_of=date(2026, 3, 1),
        rate=Decimal("48"),
        source="manual",
    )
    r2 = await fx_svc.upsert_rate(
        db_session,
        from_ccy="USD",
        to_ccy="EGP",
        as_of=date(2026, 3, 1),
        rate=Decimal("49"),
        source="cbe",
    )
    assert r1.id == r2.id
    assert r2.rate == Decimal("49.00000000")
    assert r2.source == "cbe"
