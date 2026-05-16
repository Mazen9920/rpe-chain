"""Periods, recognition, reports, audits endpoints (v0.3.1)."""

from __future__ import annotations

import uuid
from datetime import date as _date
from typing import Any

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.users import current_active_user
from app.models.close import (
    AccountingPeriod,
    AuditCheckResult,
    ExpenseContract,
)
from app.models.user import User
from app.schemas.v3_1 import (
    AuditCheckDef,
    AuditResultRead,
    BalanceSheetRead,
    CashFlowRead,
    ExpenseContractCreate,
    ExpenseContractRead,
    PeriodCloseRequest,
    PeriodCloseResult,
    PeriodRead,
    PnLRead,
    RecognizeRequest,
)
from app.services import audit as audit_svc
from app.services import period_close as close_svc
from app.services import recognition as rec_svc
from app.services import reports as reports_svc

router = APIRouter(tags=["close"])


# --------------- Periods ---------------


@router.get("/periods", response_model=list[PeriodRead])
async def list_periods(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> list[PeriodRead]:
    rows = list(
        (
            await db.execute(
                select(AccountingPeriod).order_by(
                    AccountingPeriod.year.desc(), AccountingPeriod.month.desc()
                )
            )
        )
        .scalars()
        .all()
    )
    return [PeriodRead.model_validate(r) for r in rows]


@router.post("/periods/close", response_model=PeriodCloseResult)
async def close_period(
    payload: PeriodCloseRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_active_user),
) -> PeriodCloseResult:
    result = await close_svc.close(
        db,
        year=payload.year,
        month=payload.month,
        locked_by=payload.locked_by or str(user.email),
    )
    await db.commit()
    return PeriodCloseResult.model_validate(
        {
            "period_id": result["period_id"],
            "status": result["status"],
            "locked_at": result.get("locked_at"),
            "locked_by": result.get("locked_by"),
            "checks": [
                {
                    "name": c.get("name", ""),
                    "severity": c.get("severity", "INFO"),
                    "ok": c.get("ok"),
                    "message": c.get("message"),
                }
                for c in result.get("checks", [])
            ],
        }
    )


@router.post("/periods/reopen", response_model=PeriodRead)
async def reopen_period(
    payload: PeriodCloseRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_active_user),
) -> PeriodRead:
    period = await close_svc.reopen(
        db,
        year=payload.year,
        month=payload.month,
        reopened_by=payload.locked_by or str(user.email),
    )
    await db.commit()
    await db.refresh(period)
    return PeriodRead.model_validate(period)


# --------------- Recognition ---------------


@router.post(
    "/expense-contracts",
    response_model=ExpenseContractRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_contract(
    payload: ExpenseContractCreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> ExpenseContractRead:
    c = await rec_svc.schedule_contract(
        db,
        code=payload.code,
        description=payload.description,
        expense_account_code=payload.expense_account_code,
        total_amount=payload.total_amount,
        start_date=payload.start_date,
        recognition_mode=payload.recognition_mode,
        period_months=payload.period_months,
        end_date=payload.end_date,
        monthly_amount=payload.monthly_amount,
        counter_account_code=payload.counter_account_code,
        supplier_id=payload.supplier_id,
        currency=payload.currency,
        memo=payload.memo,
    )
    await db.commit()
    await db.refresh(c)
    return ExpenseContractRead.model_validate(c)


@router.get("/expense-contracts", response_model=list[ExpenseContractRead])
async def list_contracts(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> list[ExpenseContractRead]:
    rows = list((await db.execute(select(ExpenseContract))).scalars().all())
    return [ExpenseContractRead.model_validate(r) for r in rows]


@router.post("/recognition/run")
async def run_recognition(
    payload: RecognizeRequest,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> dict[str, Any]:
    if payload.contract_id is not None:
        entry = await rec_svc.recognize_for_period(
            db, contract_id=payload.contract_id, year=payload.year, month=payload.month
        )
        await db.commit()
        return {
            "recognized": 1 if entry is not None else 0,
            "entry_id": str(entry.id) if entry else None,
        }
    entries = await rec_svc.run_monthly_recognition(db, year=payload.year, month=payload.month)
    await db.commit()
    return {"recognized": len(entries)}


# --------------- Reports ---------------


@router.get("/reports/pnl", response_model=PnLRead)
async def report_pnl(
    period_start: _date = Query(...),
    period_end: _date = Query(...),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> PnLRead:
    r = await reports_svc.pnl(db, period_start=period_start, period_end=period_end)
    return PnLRead.model_validate(
        {
            "period_start": r.period_start,
            "period_end": r.period_end,
            "revenue": r.revenue,
            "expenses": r.expenses,
            "revenue_total": r.revenue_total,
            "expense_total": r.expense_total,
            "net_income": r.net_income,
        }
    )


@router.get("/reports/balance-sheet", response_model=BalanceSheetRead)
async def report_balance_sheet(
    as_of: _date = Query(...),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> BalanceSheetRead:
    r = await reports_svc.balance_sheet(db, as_of=as_of)
    return BalanceSheetRead.model_validate(
        {
            "as_of": r.as_of,
            "assets": r.assets,
            "liabilities": r.liabilities,
            "equity": r.equity,
            "assets_total": r.assets_total,
            "liabilities_total": r.liabilities_total,
            "equity_total": r.equity_total,
            "retained_earnings": r.retained_earnings,
            "balanced": r.balanced,
        }
    )


@router.get("/reports/cash-flow", response_model=CashFlowRead)
async def report_cash_flow(
    period_start: _date = Query(...),
    period_end: _date = Query(...),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> CashFlowRead:
    r = await reports_svc.cash_flow(db, period_start=period_start, period_end=period_end)
    return CashFlowRead.model_validate(
        {
            "period_start": r.period_start,
            "period_end": r.period_end,
            "operating": r.operating,
            "investing": r.investing,
            "financing": r.financing,
            "operating_total": r.operating_total,
            "investing_total": r.investing_total,
            "financing_total": r.financing_total,
            "net_change_in_cash": r.net_change_in_cash,
        }
    )


# --------------- Audits ---------------


@router.get("/audits", response_model=list[AuditCheckDef])
async def list_audit_checks(
    _user: User = Depends(current_active_user),
) -> list[AuditCheckDef]:
    return [AuditCheckDef.model_validate(c) for c in audit_svc.list_checks()]


@router.get("/audits/results", response_model=list[AuditResultRead])
async def audit_results(
    period_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(current_active_user),
) -> list[AuditResultRead]:
    stmt = select(AuditCheckResult).order_by(AuditCheckResult.run_at.desc())
    if period_id is not None:
        stmt = stmt.where(AuditCheckResult.period_id == period_id)
    rows = list((await db.execute(stmt)).scalars().all())
    return [AuditResultRead.model_validate(r) for r in rows]
