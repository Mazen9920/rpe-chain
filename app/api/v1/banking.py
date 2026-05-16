"""Bank account + statement endpoints (v0.4.0)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.users import current_active_user
from app.errors import NotFoundError
from app.models.payments import BankAccount, BankTransaction
from app.models.user import User
from app.schemas.v4 import (
    BankAccountCreate,
    BankAccountOut,
    BankAutoMatchReport,
    BankStatementImport,
    BankTransactionOut,
)
from app.services import bank_recon as bank_svc

router = APIRouter(prefix="/banking", tags=["banking"])


@router.post(
    "/accounts",
    response_model=BankAccountOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_bank_account(
    payload: BankAccountCreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> BankAccountOut:
    acct = await bank_svc.get_or_create_account(
        db,
        code=payload.code,
        name=payload.name,
        bank_name=payload.bank_name,
        account_number=payload.account_number,
        currency=payload.currency,
        gl_account_code=payload.gl_account_code,
    )
    await db.commit()
    return BankAccountOut.model_validate(acct)


@router.get("/accounts", response_model=list[BankAccountOut])
async def list_bank_accounts(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> list[BankAccountOut]:
    rows = list((await db.execute(select(BankAccount))).scalars().all())
    return [BankAccountOut.model_validate(r) for r in rows]


@router.post(
    "/statements/import",
    response_model=dict[str, int],
)
async def import_statement(
    payload: BankStatementImport,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> dict[str, int]:
    try:
        report = await bank_svc.import_statement(
            db,
            bank_account_id=payload.bank_account_id,
            rows=[
                bank_svc.BankStatementRow(
                    transaction_date=r.transaction_date,
                    amount=r.amount,
                    description=r.description,
                    external_ref=r.external_ref,
                    statement_ref=r.statement_ref,
                )
                for r in payload.rows
            ],
        )
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await db.commit()
    return report


@router.get(
    "/accounts/{bank_account_id}/transactions",
    response_model=list[BankTransactionOut],
)
async def list_bank_transactions(
    bank_account_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
    limit: int = 100,
) -> list[BankTransactionOut]:
    rows = list(
        (
            await db.execute(
                select(BankTransaction)
                .where(BankTransaction.bank_account_id == bank_account_id)
                .order_by(BankTransaction.transaction_date.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return [BankTransactionOut.model_validate(r) for r in rows]


@router.post(
    "/auto-match",
    response_model=BankAutoMatchReport,
)
async def auto_match_bank_transactions(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> BankAutoMatchReport:
    report = await bank_svc.auto_match_unmatched(db)
    await db.commit()
    return BankAutoMatchReport(**report)
