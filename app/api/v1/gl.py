"""GL endpoints: accounts, journals, trial balance, FX rates."""

from __future__ import annotations

from datetime import date as _date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.users import current_active_user, current_superuser
from app.models.gl import FxRate, GLAccount, GLJournal, GLJournalLine
from app.models.user import User
from app.schemas.v3 import (
    FxRateRead,
    FxRateUpsert,
    GLAccountCreate,
    GLAccountRead,
    GLJournalLineRead,
    GLJournalRead,
    TrialBalanceRow,
)
from app.services import fx as fx_svc
from app.services import gl as gl_svc

router = APIRouter(tags=["gl"])


@router.get("/gl/accounts", response_model=list[GLAccountRead])
async def list_accounts(
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[GLAccountRead]:
    rows = list((await db.execute(select(GLAccount).order_by(GLAccount.code))).scalars().all())
    return [GLAccountRead.model_validate(r) for r in rows]


@router.post("/gl/accounts", response_model=GLAccountRead, status_code=status.HTTP_201_CREATED)
async def create_account(
    payload: GLAccountCreate,
    _: User = Depends(current_superuser),
    db: AsyncSession = Depends(get_db),
) -> GLAccountRead:
    acct = GLAccount(**payload.model_dump())
    db.add(acct)
    await db.flush()
    return GLAccountRead.model_validate(acct)


@router.post("/gl/seed-egypt-coa", status_code=status.HTTP_200_OK)
async def seed_coa(
    _: User = Depends(current_superuser),
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    created = await gl_svc.seed_egypt_coa(db)
    return {"created": created}


@router.get("/gl/journals", response_model=list[GLJournalRead])
async def list_journals(
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(50, ge=1, le=500),
) -> list[GLJournalRead]:
    rows = list(
        (await db.execute(select(GLJournal).order_by(GLJournal.event_date.desc()).limit(limit)))
        .scalars()
        .all()
    )
    return [GLJournalRead.model_validate(r) for r in rows]


@router.get("/gl/journals/{journal_id}/lines", response_model=list[GLJournalLineRead])
async def list_journal_lines(
    journal_id: str,
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[GLJournalLineRead]:
    import uuid

    jid = uuid.UUID(journal_id)
    rows = list(
        (await db.execute(select(GLJournalLine).where(GLJournalLine.journal_id == jid)))
        .scalars()
        .all()
    )
    return [GLJournalLineRead.model_validate(r) for r in rows]


@router.get("/gl/trial-balance", response_model=list[TrialBalanceRow])
async def trial_balance(
    as_of: _date,
    currency: str = "EGP",
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> list[TrialBalanceRow]:
    rows = await gl_svc.trial_balance(db, as_of=as_of, currency=currency)
    return [
        TrialBalanceRow(account_code=code, debit=d, credit=c, balance=Decimal(d) - Decimal(c))
        for code, d, c in rows
    ]


# ---------- FX ----------


@router.get("/fx-rates", response_model=list[FxRateRead])
async def list_fx_rates(
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(100, ge=1, le=1000),
) -> list[FxRateRead]:
    rows = list(
        (await db.execute(select(FxRate).order_by(FxRate.as_of_date.desc()).limit(limit)))
        .scalars()
        .all()
    )
    return [FxRateRead.model_validate(r) for r in rows]


@router.post("/fx-rates", response_model=FxRateRead, status_code=status.HTTP_201_CREATED)
async def upsert_fx_rate(
    payload: FxRateUpsert,
    _: User = Depends(current_superuser),
    db: AsyncSession = Depends(get_db),
) -> FxRateRead:
    row = await fx_svc.upsert_rate(
        db,
        from_ccy=payload.from_ccy,
        to_ccy=payload.to_ccy,
        as_of=payload.as_of_date,
        rate=payload.rate,
        source=payload.source,
    )
    return FxRateRead.model_validate(row)


@router.get("/fx-rates/lookup")
async def lookup_fx_rate(
    from_ccy: str,
    to_ccy: str,
    when: _date,
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    try:
        rate = await fx_svc.get_rate(db, from_ccy=from_ccy, to_ccy=to_ccy, when=when)
    except fx_svc.FxRateNotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message) from e
    return {"from_ccy": from_ccy, "to_ccy": to_ccy, "when": when.isoformat(), "rate": str(rate)}
