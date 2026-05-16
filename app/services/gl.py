"""General Ledger service: post journals (balanced per currency) + Egypt CoA seed.

Public API:
- `post_journal(session, *, source_doc_type, source_doc_id, event_date, lines, currency, memo)`
  → creates a balanced GLJournal. Validates Σdebit == Σcredit per currency.
- `post_pending(session, entry, account_map)` → promotes a PendingJournalEntry to a
  real GLJournal by mapping symbolic AccountCode → GLAccount.code.
- `trial_balance(session, *, as_of, currency)` → list of (account_code, debit, credit).
- `seed_egypt_coa(session)` → idempotent CoA seeder per master plan §174.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from decimal import ROUND_HALF_EVEN, Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import AppError, NotFoundError, PeriodLockedError
from app.models.accounting import PendingJournalEntry, PendingJournalLine, PendingJournalStatus
from app.models.close import AccountingPeriod, PeriodStatus
from app.models.gl import (
    AccountType,
    GLAccount,
    GLJournal,
    GLJournalLine,
    JournalStatus,
    NormalBalance,
)

Q4 = Decimal("0.0001")
ZERO = Decimal("0")


def _q(x: Decimal) -> Decimal:
    return x.quantize(Q4, rounding=ROUND_HALF_EVEN)


class UnbalancedJournalError(AppError):
    code = "unbalanced_journal"


class AccountNotFoundError(NotFoundError):
    code = "account_not_found"


@dataclass(frozen=True)
class JournalLineSpec:
    account_code: str
    debit: Decimal = ZERO
    credit: Decimal = ZERO
    currency: str = "EGP"
    fx_rate: Decimal = Decimal("1")
    dimensions: dict[str, object] | None = None


async def _account_by_code(session: AsyncSession, code: str) -> GLAccount:
    row = (
        await session.execute(select(GLAccount).where(GLAccount.code == code))
    ).scalar_one_or_none()
    if row is None:
        raise AccountNotFoundError(f"GL account not found: {code}", details={"code": code})
    return row


async def _next_journal_number(session: AsyncSession, event_date: date) -> str:
    prefix = f"J{event_date:%Y%m}"
    stmt = (
        select(GLJournal.journal_number)
        .where(GLJournal.journal_number.like(f"{prefix}%"))
        .order_by(GLJournal.journal_number.desc())
        .limit(1)
    )
    last = (await session.execute(stmt)).scalar_one_or_none()
    seq = int(last[len(prefix) :]) + 1 if last else 1
    return f"{prefix}{seq:05d}"


async def _ensure_period_open(session: AsyncSession, event_date: date) -> None:
    """Raise PeriodLockedError if the target period is LOCKED."""
    stmt = select(AccountingPeriod).where(
        AccountingPeriod.year == event_date.year,
        AccountingPeriod.month == event_date.month,
    )
    period = (await session.execute(stmt)).scalar_one_or_none()
    if period is not None and period.status == PeriodStatus.LOCKED:
        raise PeriodLockedError(
            f"Accounting period {event_date.year}-{event_date.month:02d} is locked",
            details={"year": event_date.year, "month": event_date.month},
        )


async def post_journal(
    session: AsyncSession,
    *,
    source_doc_type: str,
    source_doc_id: uuid.UUID,
    event_date: date,
    lines: list[JournalLineSpec],
    memo: str | None = None,
) -> GLJournal:
    """Create + post a balanced GLJournal. Σdebit == Σcredit per currency."""
    if not lines:
        raise UnbalancedJournalError("Journal has no lines")

    await _ensure_period_open(session, event_date)

    # validate balance per currency
    sums_by_ccy: dict[str, tuple[Decimal, Decimal]] = defaultdict(lambda: (ZERO, ZERO))
    for ln in lines:
        d, c = sums_by_ccy[ln.currency]
        sums_by_ccy[ln.currency] = (d + ln.debit, c + ln.credit)
    for ccy, (d, c) in sums_by_ccy.items():
        if _q(d) != _q(c):
            raise UnbalancedJournalError(
                f"Journal unbalanced for {ccy}: debit={d} credit={c}",
                details={"currency": ccy, "debit": str(d), "credit": str(c)},
            )

    journal = GLJournal(
        journal_number=await _next_journal_number(session, event_date),
        event_date=event_date,
        source_doc_type=source_doc_type,
        source_doc_id=source_doc_id,
        memo=memo,
        status=JournalStatus.POSTED,
        posted_at=datetime.utcnow(),
    )
    session.add(journal)
    await session.flush()

    for ln in lines:
        if ln.debit > 0 and ln.credit > 0:
            raise UnbalancedJournalError(
                f"Line has both debit and credit: {ln.account_code}",
                details={"account_code": ln.account_code},
            )
        if ln.debit <= 0 and ln.credit <= 0:
            continue
        acct = await _account_by_code(session, ln.account_code)
        d = _q(ln.debit)
        c = _q(ln.credit)
        session.add(
            GLJournalLine(
                journal_id=journal.id,
                account_id=acct.id,
                debit=d,
                credit=c,
                currency=ln.currency,
                fx_rate=ln.fx_rate,
                base_debit=_q(d * ln.fx_rate),
                base_credit=_q(c * ln.fx_rate),
                dimensions=ln.dimensions,
            )
        )
    await session.flush()
    return journal


async def post_pending(
    session: AsyncSession,
    *,
    entry: PendingJournalEntry,
    account_map: dict[str, str],
) -> GLJournal:
    """Promote a PendingJournalEntry to a real GLJournal using symbolic→code map.

    Marks the pending entry POSTED and stores the GL journal id.
    """
    pl_stmt = select(PendingJournalLine).where(PendingJournalLine.entry_id == entry.id)
    pending_lines = list((await session.execute(pl_stmt)).scalars().all())
    specs: list[JournalLineSpec] = []
    for pl in pending_lines:
        mapped = account_map.get(pl.account_code, pl.account_code)
        specs.append(
            JournalLineSpec(
                account_code=mapped,
                debit=Decimal(pl.debit),
                credit=Decimal(pl.credit),
                currency=pl.currency,
                dimensions=pl.dimensions if isinstance(pl.dimensions, dict) else None,
            )
        )
    journal = await post_journal(
        session,
        source_doc_type=entry.source_doc_type,
        source_doc_id=entry.source_doc_id,
        event_date=entry.event_date,
        lines=specs,
        memo=entry.memo,
    )
    entry.status = PendingJournalStatus.POSTED
    entry.posted_journal_id = journal.id
    entry.posted_at = datetime.utcnow()
    await session.flush()
    return journal


async def trial_balance(
    session: AsyncSession,
    *,
    as_of: date,
    currency: str = "EGP",
) -> list[tuple[str, Decimal, Decimal]]:
    """Sum debit/credit per account for posted journals up to `as_of`."""
    stmt = (
        select(GLAccount.code, GLJournalLine.debit, GLJournalLine.credit)
        .join(GLJournalLine, GLJournalLine.account_id == GLAccount.id)
        .join(GLJournal, GLJournal.id == GLJournalLine.journal_id)
        .where(
            GLJournal.status == JournalStatus.POSTED,
            GLJournal.event_date <= as_of,
            GLJournalLine.currency == currency,
        )
    )
    sums: dict[str, tuple[Decimal, Decimal]] = defaultdict(lambda: (ZERO, ZERO))
    for code, d, c in (await session.execute(stmt)).all():
        cur_d, cur_c = sums[code]
        sums[code] = (cur_d + Decimal(d or 0), cur_c + Decimal(c or 0))
    return sorted(((k, v[0], v[1]) for k, v in sums.items()), key=lambda r: r[0])


# ---------------------------------------------------------------------------
# Egypt CoA seed
# ---------------------------------------------------------------------------

# (code, name, type, normal_balance, bs_tag, cf_tag)
EGYPT_COA: list[tuple[str, str, AccountType, NormalBalance, str | None, str | None]] = [
    # Assets — current
    ("1010", "Cash on Hand", AccountType.ASSET, NormalBalance.DEBIT, "current_assets", "cash"),
    ("1020", "Bank — Operating", AccountType.ASSET, NormalBalance.DEBIT, "current_assets", "cash"),
    ("1100", "Accounts Receivable", AccountType.ASSET, NormalBalance.DEBIT, "current_assets", None),
    (
        "1110",
        "AR — Paymob Settlement",
        AccountType.ASSET,
        NormalBalance.DEBIT,
        "current_assets",
        None,
    ),
    ("1120", "AR — Bosta COD", AccountType.ASSET, NormalBalance.DEBIT, "current_assets", None),
    ("1130", "AR — Chargeback", AccountType.ASSET, NormalBalance.DEBIT, "current_assets", None),
    # Inventory accounts (per PDF §06)
    (
        "5000",
        "Inventory — Finished Goods",
        AccountType.ASSET,
        NormalBalance.DEBIT,
        "inventory",
        None,
    ),
    (
        "5010",
        "Inventory — Raw Materials",
        AccountType.ASSET,
        NormalBalance.DEBIT,
        "inventory",
        None,
    ),
    ("5015", "Work In Progress", AccountType.ASSET, NormalBalance.DEBIT, "inventory", None),
    ("5020", "Inventory — Packaging", AccountType.ASSET, NormalBalance.DEBIT, "inventory", None),
    ("5030", "Inventory Adjustments", AccountType.EXPENSE, NormalBalance.DEBIT, None, None),
    # Liabilities
    (
        "2010",
        "Accounts Payable",
        AccountType.LIABILITY,
        NormalBalance.CREDIT,
        "current_liabilities",
        None,
    ),
    (
        "2020",
        "AP — Manufacturers",
        AccountType.LIABILITY,
        NormalBalance.CREDIT,
        "current_liabilities",
        None,
    ),
    (
        "2030",
        "AP — Ads Platforms",
        AccountType.LIABILITY,
        NormalBalance.CREDIT,
        "current_liabilities",
        None,
    ),
    (
        "2040",
        "Accrued Expenses",
        AccountType.LIABILITY,
        NormalBalance.CREDIT,
        "current_liabilities",
        None,
    ),
    (
        "2050",
        "Sales Tax Payable",
        AccountType.LIABILITY,
        NormalBalance.CREDIT,
        "current_liabilities",
        None,
    ),
    # Equity
    ("3010", "Owner Capital", AccountType.EQUITY, NormalBalance.CREDIT, "equity", None),
    ("3020", "Retained Earnings", AccountType.EQUITY, NormalBalance.CREDIT, "equity", None),
    # Revenue
    ("4010", "Sales Revenue", AccountType.REVENUE, NormalBalance.CREDIT, None, "operating"),
    ("4020", "Shipping Revenue", AccountType.REVENUE, NormalBalance.CREDIT, None, "operating"),
    # COGS
    ("5400", "COGS — Finished Goods", AccountType.EXPENSE, NormalBalance.DEBIT, None, "operating"),
    ("5410", "COGS — Raw Materials", AccountType.EXPENSE, NormalBalance.DEBIT, None, "operating"),
    # Operating expenses (per PDF §06)
    ("6140", "Shipping Expense", AccountType.EXPENSE, NormalBalance.DEBIT, None, "operating"),
    ("6160", "Marketing — TikTok Ads", AccountType.EXPENSE, NormalBalance.DEBIT, None, "operating"),
    ("6170", "Marketing — Meta Ads", AccountType.EXPENSE, NormalBalance.DEBIT, None, "operating"),
    ("6171", "Marketing — Google Ads", AccountType.EXPENSE, NormalBalance.DEBIT, None, "operating"),
    ("6191", "Marketing — Other", AccountType.EXPENSE, NormalBalance.DEBIT, None, "operating"),
    # Financial
    ("7010", "Payment Gateway Fees", AccountType.EXPENSE, NormalBalance.DEBIT, None, "operating"),
    ("7020", "FX Gain/Loss", AccountType.EXPENSE, NormalBalance.DEBIT, None, "operating"),
]

# Default COGS pending → real-GL account map (used by sales.ship after cogs.post_for_shipment)
DEFAULT_COGS_ACCOUNT_MAP: dict[str, str] = {
    "COGS_FG": "5400",
    "COGS_RM": "5410",
    "INV_FG": "5000",
    "INV_RM": "5010",
    "INV_PACK": "5020",
}


async def seed_egypt_coa(session: AsyncSession) -> int:
    """Insert Egypt CoA rows if missing. Returns count of rows created."""
    created = 0
    existing = {r[0] for r in (await session.execute(select(GLAccount.code))).all()}
    for code, name, atype, nb, bs, cf in EGYPT_COA:
        if code in existing:
            continue
        session.add(
            GLAccount(
                code=code,
                name=name,
                account_type=atype,
                normal_balance=nb,
                bs_tag=bs,
                cf_tag=cf,
                is_active=True,
            )
        )
        created += 1
    if created:
        await session.flush()
    return created


__all__ = [
    "DEFAULT_COGS_ACCOUNT_MAP",
    "EGYPT_COA",
    "JournalLineSpec",
    "UnbalancedJournalError",
    "post_journal",
    "post_pending",
    "seed_egypt_coa",
    "trial_balance",
]
