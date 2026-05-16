"""Expense recognition: monthly amortization of prepaid/accrued/recurring expenses.

`schedule_contract(...)` creates an ExpenseContract. `recognize_for_period(...)`
posts a journal for the contract for the given (year, month) — idempotent via
the unique(contract_id, period_id) constraint on RecognitionEntry.
`run_monthly_recognition()` iterates all ACTIVE contracts and recognizes them
for the target period (used by Celery Beat on day 1 of each month).
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import ROUND_HALF_EVEN, Decimal

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import InvalidStateError, NotFoundError
from app.models.close import (
    AccountingPeriod,
    ContractStatus,
    ExpenseContract,
    PeriodStatus,
    RecognitionEntry,
    RecognitionMode,
)
from app.services import gl as gl_svc

Q4 = Decimal("0.0001")
ZERO = Decimal("0")


def _q(x: Decimal) -> Decimal:
    return x.quantize(Q4, rounding=ROUND_HALF_EVEN)


async def _ensure_period(session: AsyncSession, *, year: int, month: int) -> AccountingPeriod:
    period = (
        await session.execute(
            select(AccountingPeriod).where(
                AccountingPeriod.year == year, AccountingPeriod.month == month
            )
        )
    ).scalar_one_or_none()
    if period is None:
        period = AccountingPeriod(year=year, month=month, status=PeriodStatus.OPEN)
        session.add(period)
        await session.flush()
    return period


async def schedule_contract(
    session: AsyncSession,
    *,
    code: str,
    description: str,
    expense_account_code: str,
    total_amount: Decimal,
    start_date: date,
    recognition_mode: RecognitionMode = RecognitionMode.MONTHLY,
    period_months: int | None = None,
    end_date: date | None = None,
    monthly_amount: Decimal | None = None,
    counter_account_code: str = "2040",
    supplier_id: uuid.UUID | None = None,
    currency: str = "EGP",
    memo: str | None = None,
) -> ExpenseContract:
    if total_amount <= 0:
        raise InvalidStateError("total_amount must be positive")
    if recognition_mode in (
        RecognitionMode.MONTHLY,
        RecognitionMode.PREPAID,
        RecognitionMode.ACCRUED,
    ):
        if period_months is None or period_months <= 0:
            raise InvalidStateError("period_months required for amortized contracts")
        monthly_amount = _q(total_amount / Decimal(period_months))
    contract = ExpenseContract(
        code=code,
        description=description,
        supplier_id=supplier_id,
        expense_account_code=expense_account_code,
        counter_account_code=counter_account_code,
        recognition_mode=recognition_mode,
        currency=currency,
        total_amount=_q(total_amount),
        monthly_amount=_q(monthly_amount) if monthly_amount is not None else None,
        start_date=start_date,
        end_date=end_date,
        period_months=period_months,
        status=ContractStatus.ACTIVE,
        memo=memo,
    )
    session.add(contract)
    await session.flush()
    return contract


def _is_in_window(contract: ExpenseContract, year: int, month: int) -> bool:
    target = date(year, month, 1)
    start = date(contract.start_date.year, contract.start_date.month, 1)
    if target < start:
        return False
    if contract.end_date is not None:
        end = date(contract.end_date.year, contract.end_date.month, 1)
        if target > end:
            return False
    return True


async def recognize_for_period(
    session: AsyncSession,
    *,
    contract_id: uuid.UUID,
    year: int,
    month: int,
) -> RecognitionEntry | None:
    """Idempotent: returns existing entry if already recognized."""
    contract = await session.get(ExpenseContract, contract_id)
    if contract is None:
        raise NotFoundError(f"Contract not found: {contract_id}")
    if contract.status != ContractStatus.ACTIVE:
        return None
    if not _is_in_window(contract, year, month):
        return None
    if contract.recognition_mode == RecognitionMode.ONE_OFF:
        # one-off: only recognize in the start month, exactly once
        if (year, month) != (contract.start_date.year, contract.start_date.month):
            return None
        amount = _q(contract.total_amount)
    else:
        if contract.monthly_amount is None:
            return None
        amount = _q(contract.monthly_amount)

    period = await _ensure_period(session, year=year, month=month)

    existing = (
        await session.execute(
            select(RecognitionEntry).where(
                RecognitionEntry.contract_id == contract.id,
                RecognitionEntry.period_id == period.id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    if period.status == PeriodStatus.LOCKED:
        # cannot post into locked period
        return None

    # Build journal: DR expense / CR counter (typically Accrued Expenses 2040)
    event_date = date(year, month, 1)
    journal = await gl_svc.post_journal(
        session,
        source_doc_type="RECOGNITION",
        source_doc_id=contract.id,
        event_date=event_date,
        lines=[
            gl_svc.JournalLineSpec(
                account_code=contract.expense_account_code,
                debit=amount,
                currency=contract.currency,
            ),
            gl_svc.JournalLineSpec(
                account_code=contract.counter_account_code,
                credit=amount,
                currency=contract.currency,
            ),
        ],
        memo=f"Recognize {contract.code} {year}-{month:02d}",
    )
    entry = RecognitionEntry(
        contract_id=contract.id,
        period_id=period.id,
        journal_id=journal.id,
        amount=amount,
    )
    session.add(entry)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        return (
            await session.execute(
                select(RecognitionEntry).where(
                    RecognitionEntry.contract_id == contract.id,
                    RecognitionEntry.period_id == period.id,
                )
            )
        ).scalar_one()

    contract.last_recognized_year = year
    contract.last_recognized_month = month
    if contract.recognition_mode == RecognitionMode.ONE_OFF or (
        contract.end_date is not None
        and date(year, month, 1) >= date(contract.end_date.year, contract.end_date.month, 1)
    ):
        contract.status = ContractStatus.COMPLETED
    await session.flush()
    return entry


async def run_monthly_recognition(
    session: AsyncSession, *, year: int, month: int
) -> list[RecognitionEntry]:
    """Recognize all ACTIVE contracts whose window covers (year, month)."""
    target = date(year, month, 1)
    contracts = list(
        (
            await session.execute(
                select(ExpenseContract).where(
                    ExpenseContract.status == ContractStatus.ACTIVE,
                    ExpenseContract.start_date <= target,
                    or_(
                        ExpenseContract.end_date.is_(None),
                        ExpenseContract.end_date >= target,
                    ),
                )
            )
        )
        .scalars()
        .all()
    )
    results: list[RecognitionEntry] = []
    for c in contracts:
        entry = await recognize_for_period(session, contract_id=c.id, year=year, month=month)
        if entry is not None:
            results.append(entry)
    return results


__all__ = [
    "recognize_for_period",
    "run_monthly_recognition",
    "schedule_contract",
]
