"""Payment endpoints (v0.4.0): Paymob settlement ingest, COD ledger, chargebacks."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.users import current_active_user
from app.errors import NotFoundError
from app.integrations.bosta.remittance_csv import parse_remittance_csv
from app.integrations.paymob.settlement_csv import parse_settlement_csv
from app.models.payments import (
    Chargeback,
    CODLedgerEntry,
    CODStatus,
    PaymobTransaction,
)
from app.models.user import User
from app.schemas.v4 import (
    ChargebackCreate,
    ChargebackOut,
    ChargebackResolve,
    CODLedgerEntryOut,
    CODRemittanceReport,
    CODShipmentCreate,
    CODVoidRateOut,
    PaymobReconReport,
    PaymobTransactionOut,
)
from app.services import chargebacks as cb_svc
from app.services import cod_ledger as cod_svc
from app.services import paymob_recon as paymob_svc

router = APIRouter(tags=["payments"])


# ---------------------------------------------------------------------------
# Paymob
# ---------------------------------------------------------------------------


@router.post(
    "/paymob/settlements/import",
    response_model=PaymobReconReport,
    status_code=status.HTTP_200_OK,
)
async def import_paymob_settlement_csv(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> PaymobReconReport:
    content = await file.read()
    rows = parse_settlement_csv(content)
    report = await paymob_svc.ingest_settlement_rows(db, rows)
    await db.commit()
    return PaymobReconReport(**report)


@router.get(
    "/paymob/transactions",
    response_model=list[PaymobTransactionOut],
)
async def list_paymob_transactions(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
    limit: int = 100,
) -> list[PaymobTransactionOut]:
    rows = list(
        (
            await db.execute(
                select(PaymobTransaction)
                .order_by(PaymobTransaction.captured_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return [PaymobTransactionOut.model_validate(r) for r in rows]


# ---------------------------------------------------------------------------
# COD
# ---------------------------------------------------------------------------


@router.post(
    "/cod/shipments",
    response_model=CODLedgerEntryOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_cod_shipment(
    payload: CODShipmentCreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> CODLedgerEntryOut:
    entry = await cod_svc.record_shipment(
        db,
        tracking_id=payload.tracking_id,
        cod_amount=payload.cod_amount,
        delivery_fee=payload.delivery_fee,
        currency=payload.currency,
        order_id=payload.order_id,
        customer_invoice_id=payload.customer_invoice_id,
        customer_id=payload.customer_id,
    )
    await db.commit()
    return CODLedgerEntryOut.model_validate(entry)


@router.post(
    "/cod/shipments/{tracking_id}/deliver",
    response_model=CODLedgerEntryOut,
)
async def deliver_cod_shipment(
    tracking_id: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> CODLedgerEntryOut:
    try:
        entry = await cod_svc.mark_delivered(db, tracking_id=tracking_id)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await db.commit()
    return CODLedgerEntryOut.model_validate(entry)


@router.post(
    "/cod/remittances/import",
    response_model=CODRemittanceReport,
)
async def import_cod_remittance_csv(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> CODRemittanceReport:
    content = await file.read()
    rows = parse_remittance_csv(content)
    report = await cod_svc.apply_remittance_rows(db, rows)
    await db.commit()
    return CODRemittanceReport(**report)


@router.get(
    "/cod/entries",
    response_model=list[CODLedgerEntryOut],
)
async def list_cod_entries(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
    status_filter: CODStatus | None = None,
    limit: int = 100,
) -> list[CODLedgerEntryOut]:
    stmt = select(CODLedgerEntry).order_by(CODLedgerEntry.created_at.desc()).limit(limit)
    if status_filter is not None:
        stmt = stmt.where(CODLedgerEntry.status == status_filter)
    rows = list((await db.execute(stmt)).scalars().all())
    return [CODLedgerEntryOut.model_validate(r) for r in rows]


@router.get(
    "/cod/void-rate",
    response_model=CODVoidRateOut,
)
async def cod_void_rate(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
    window_days: int = 30,
) -> CODVoidRateOut:
    rate = await cod_svc.void_rate(db, window_days=window_days)
    return CODVoidRateOut(window_days=window_days, void_rate=rate)


# ---------------------------------------------------------------------------
# Chargebacks
# ---------------------------------------------------------------------------


@router.post(
    "/chargebacks",
    response_model=ChargebackOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_chargeback(
    payload: ChargebackCreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> ChargebackOut:
    try:
        cb = await cb_svc.raise_chargeback(
            db,
            paymob_transaction_id=payload.paymob_transaction_id,
            amount=payload.amount,
            reason=payload.reason,
        )
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await db.commit()
    return ChargebackOut.model_validate(cb)


@router.post(
    "/chargebacks/{chargeback_id}/resolve",
    response_model=ChargebackOut,
)
async def resolve_chargeback(
    chargeback_id: uuid.UUID,
    payload: ChargebackResolve,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> ChargebackOut:
    try:
        cb = await cb_svc.resolve_chargeback(
            db, chargeback_id=chargeback_id, outcome=payload.outcome
        )
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await db.commit()
    return ChargebackOut.model_validate(cb)


@router.get(
    "/chargebacks",
    response_model=list[ChargebackOut],
)
async def list_chargebacks(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
    limit: int = 100,
) -> list[ChargebackOut]:
    rows = list(
        (await db.execute(select(Chargeback).order_by(Chargeback.raised_at.desc()).limit(limit)))
        .scalars()
        .all()
    )
    return [ChargebackOut.model_validate(r) for r in rows]
