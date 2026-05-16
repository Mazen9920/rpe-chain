"""Financial reports: P&L, Balance Sheet, Cash Flow.

All amounts in base currency (EGP) via base_debit/base_credit columns so FX is
already converted. Reports are driven off `GLAccount.account_type`, `bs_tag`,
and `cf_tag` so adding new accounts updates the reports automatically.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_EVEN, Decimal
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.gl import (
    AccountType,
    GLAccount,
    GLJournal,
    GLJournalLine,
    JournalStatus,
)

Q4 = Decimal("0.0001")
ZERO = Decimal("0")


def _q(x: Decimal) -> Decimal:
    return x.quantize(Q4, rounding=ROUND_HALF_EVEN)


@dataclass
class AccountBalance:
    code: str
    name: str
    account_type: str
    bs_tag: str | None
    cf_tag: str | None
    debit: Decimal
    credit: Decimal

    @property
    def balance(self) -> Decimal:
        return _q(self.debit - self.credit)


@dataclass
class PnLReport:
    period_start: date
    period_end: date
    revenue: dict[str, Decimal] = field(default_factory=dict)
    expenses: dict[str, Decimal] = field(default_factory=dict)
    revenue_total: Decimal = ZERO
    expense_total: Decimal = ZERO
    net_income: Decimal = ZERO


@dataclass
class BalanceSheetReport:
    as_of: date
    assets: dict[str, Decimal] = field(default_factory=dict)
    liabilities: dict[str, Decimal] = field(default_factory=dict)
    equity: dict[str, Decimal] = field(default_factory=dict)
    assets_total: Decimal = ZERO
    liabilities_total: Decimal = ZERO
    equity_total: Decimal = ZERO
    retained_earnings: Decimal = ZERO
    balanced: bool = False


@dataclass
class CashFlowReport:
    period_start: date
    period_end: date
    operating: dict[str, Decimal] = field(default_factory=dict)
    investing: dict[str, Decimal] = field(default_factory=dict)
    financing: dict[str, Decimal] = field(default_factory=dict)
    operating_total: Decimal = ZERO
    investing_total: Decimal = ZERO
    financing_total: Decimal = ZERO
    net_change_in_cash: Decimal = ZERO


async def _account_movements(
    session: AsyncSession,
    *,
    start: date | None,
    end: date,
    types: list[AccountType] | None = None,
) -> list[AccountBalance]:
    """Sum debit/credit per account for a date range (inclusive end)."""
    stmt = (
        select(
            GLAccount.code,
            GLAccount.name,
            GLAccount.account_type,
            GLAccount.bs_tag,
            GLAccount.cf_tag,
            GLJournalLine.base_debit,
            GLJournalLine.base_credit,
        )
        .join(GLJournalLine, GLJournalLine.account_id == GLAccount.id)
        .join(GLJournal, GLJournal.id == GLJournalLine.journal_id)
        .where(
            and_(
                GLJournal.status == JournalStatus.POSTED,
                GLJournal.event_date <= end,
            )
        )
    )
    if start is not None:
        stmt = stmt.where(GLJournal.event_date >= start)
    if types:
        stmt = stmt.where(GLAccount.account_type.in_(types))

    agg: dict[str, AccountBalance] = {}
    for code, name, atype, bs_tag, cf_tag, d, c in (await session.execute(stmt)).all():
        bal = agg.get(code)
        if bal is None:
            bal = AccountBalance(
                code=code,
                name=name,
                account_type=str(atype),
                bs_tag=bs_tag,
                cf_tag=cf_tag,
                debit=ZERO,
                credit=ZERO,
            )
            agg[code] = bal
        bal.debit += Decimal(d or 0)
        bal.credit += Decimal(c or 0)
    return list(agg.values())


async def pnl(session: AsyncSession, *, period_start: date, period_end: date) -> PnLReport:
    rows = await _account_movements(
        session,
        start=period_start,
        end=period_end,
        types=[AccountType.REVENUE, AccountType.EXPENSE],
    )
    report = PnLReport(period_start=period_start, period_end=period_end)
    for r in rows:
        # revenue normal balance CREDIT → balance = credit - debit
        signed = (
            _q(r.credit - r.debit)
            if r.account_type == AccountType.REVENUE.value
            else _q(r.debit - r.credit)
        )
        if r.account_type == AccountType.REVENUE.value:
            report.revenue[r.code] = signed
            report.revenue_total += signed
        else:
            report.expenses[r.code] = signed
            report.expense_total += signed
    report.revenue_total = _q(report.revenue_total)
    report.expense_total = _q(report.expense_total)
    report.net_income = _q(report.revenue_total - report.expense_total)
    return report


async def balance_sheet(session: AsyncSession, *, as_of: date) -> BalanceSheetReport:
    rows = await _account_movements(
        session,
        start=None,
        end=as_of,
        types=[AccountType.ASSET, AccountType.LIABILITY, AccountType.EQUITY],
    )
    report = BalanceSheetReport(as_of=as_of)
    for r in rows:
        if r.account_type == AccountType.ASSET.value:
            bal = _q(r.debit - r.credit)
            report.assets[r.code] = bal
            report.assets_total += bal
        elif r.account_type == AccountType.LIABILITY.value:
            bal = _q(r.credit - r.debit)
            report.liabilities[r.code] = bal
            report.liabilities_total += bal
        else:  # EQUITY
            bal = _q(r.credit - r.debit)
            report.equity[r.code] = bal
            report.equity_total += bal

    # Retained earnings = cumulative net income from REV/EXP through as_of
    pl_rows = await _account_movements(
        session,
        start=None,
        end=as_of,
        types=[AccountType.REVENUE, AccountType.EXPENSE],
    )
    rev = sum(
        (_q(r.credit - r.debit) for r in pl_rows if r.account_type == AccountType.REVENUE.value),
        ZERO,
    )
    exp = sum(
        (_q(r.debit - r.credit) for r in pl_rows if r.account_type == AccountType.EXPENSE.value),
        ZERO,
    )
    report.retained_earnings = _q(rev - exp)
    report.equity_total = _q(report.equity_total + report.retained_earnings)
    report.assets_total = _q(report.assets_total)
    report.liabilities_total = _q(report.liabilities_total)
    report.balanced = _q(
        report.assets_total - report.liabilities_total - report.equity_total
    ).copy_abs() < Decimal("0.01")
    return report


async def cash_flow(
    session: AsyncSession, *, period_start: date, period_end: date
) -> CashFlowReport:
    """Direct-method cash flow grouped by `GLAccount.cf_tag`.

    Cash accounts (bs_tag='cash') net debit movement = net change in cash. The
    counter-side of each cash journal is classified by the counter account's
    `cf_tag` (default 'operating' if unset).
    """
    # Pull all journals touching cash accounts in range
    cash_codes_stmt = select(GLAccount.id, GLAccount.code).where(GLAccount.bs_tag == "cash")
    cash_rows = (await session.execute(cash_codes_stmt)).all()
    cash_account_ids = {r.id for r in cash_rows}
    if not cash_account_ids:
        return CashFlowReport(period_start=period_start, period_end=period_end)

    # journals with cash leg in period
    j_with_cash_stmt = (
        select(GLJournal.id)
        .join(GLJournalLine, GLJournalLine.journal_id == GLJournal.id)
        .where(
            GLJournal.status == JournalStatus.POSTED,
            GLJournal.event_date >= period_start,
            GLJournal.event_date <= period_end,
            GLJournalLine.account_id.in_(cash_account_ids),
        )
        .distinct()
    )
    journal_ids = [row.id for row in (await session.execute(j_with_cash_stmt)).all()]
    if not journal_ids:
        return CashFlowReport(period_start=period_start, period_end=period_end)

    lines_stmt = (
        select(
            GLJournalLine.journal_id,
            GLJournalLine.account_id,
            GLAccount.code,
            GLAccount.cf_tag,
            GLAccount.bs_tag,
            GLAccount.account_type,
            GLJournalLine.base_debit,
            GLJournalLine.base_credit,
        )
        .join(GLAccount, GLAccount.id == GLJournalLine.account_id)
        .where(GLJournalLine.journal_id.in_(journal_ids))
    )

    by_journal: dict[str, list[Any]] = defaultdict(list)
    for row in (await session.execute(lines_stmt)).all():
        by_journal[str(row.journal_id)].append(row)

    operating: dict[str, Decimal] = defaultdict(lambda: ZERO)
    investing: dict[str, Decimal] = defaultdict(lambda: ZERO)
    financing: dict[str, Decimal] = defaultdict(lambda: ZERO)
    net_cash = ZERO

    for _jid, rows in by_journal.items():
        cash_delta = ZERO
        counter_rows = []
        for r in rows:
            if r.account_id in cash_account_ids:
                cash_delta += Decimal(r.base_debit or 0) - Decimal(r.base_credit or 0)
            else:
                counter_rows.append(r)
        net_cash += cash_delta
        if not counter_rows or cash_delta == 0:
            continue
        # classify each counter row proportionally
        counter_total = sum(
            (Decimal(r.base_debit or 0) + Decimal(r.base_credit or 0) for r in counter_rows),
            ZERO,
        ) or Decimal("1")
        for r in counter_rows:
            weight = (Decimal(r.base_debit or 0) + Decimal(r.base_credit or 0)) / counter_total
            slice_amt = _q(cash_delta * weight)
            tag = (r.cf_tag or "operating").lower()
            bucket = operating
            if tag == "investing":
                bucket = investing
            elif tag == "financing":
                bucket = financing
            key = f"{r.code} {tag}"
            bucket[key] = _q(bucket[key] + slice_amt)

    report = CashFlowReport(period_start=period_start, period_end=period_end)
    report.operating = dict(operating)
    report.investing = dict(investing)
    report.financing = dict(financing)
    report.operating_total = _q(sum(operating.values(), ZERO))
    report.investing_total = _q(sum(investing.values(), ZERO))
    report.financing_total = _q(sum(financing.values(), ZERO))
    report.net_change_in_cash = _q(net_cash)
    return report


__all__ = [
    "AccountBalance",
    "BalanceSheetReport",
    "CashFlowReport",
    "PnLReport",
    "balance_sheet",
    "cash_flow",
    "pnl",
]
