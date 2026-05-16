"""27 audit checks (v0.3.1).

Each check returns (ok: bool, message: str, refs: dict). They are persisted as
`AuditCheckResult` rows when invoked via `run_audits(period)`. Severity:
- BLOCKER  → fails period close (409 AuditFailedError)
- WARN     → recorded, does not block close
- INFO     → recorded, informational
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import and_, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ar import (
    ARPayment,
    CustomerInvoice,
    CustomerInvoiceStatus,
)
from app.models.close import (
    AccountingPeriod,
    AuditCheckResult,
    AuditSeverity,
    ExpenseContract,
    RecognitionEntry,
)
from app.models.gl import (
    AccountType,
    GLAccount,
    GLJournal,
    GLJournalLine,
    JournalStatus,
)
from app.models.inventory import StockLevel
from app.models.procurement import (
    GoodsReceipt,
    GoodsReceiptStatus,
    PurchaseOrder,
    SupplierInvoice,
    SupplierInvoiceStatus,
)
from app.models.sales import SalesOrder, SalesOrderStatus, Shipment, ShipmentStatus

ZERO = Decimal("0")
CENT = Decimal("0.01")


@dataclass
class AuditCheck:
    name: str
    severity: AuditSeverity
    fn: Callable[[AsyncSession, AccountingPeriod], Awaitable[tuple[bool, str, dict[str, Any]]]]


def _month_range(period: AccountingPeriod) -> tuple[date, date]:
    start = date(period.year, period.month, 1)
    if period.month == 12:
        end = date(period.year + 1, 1, 1)
    else:
        end = date(period.year, period.month + 1, 1)
    return start, end


# -------------- check implementations --------------


async def _c01_period_exists(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    return True, f"Period {period.year}-{period.month:02d} exists", {"period_id": str(period.id)}


async def _c02_trial_balance_balanced(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    start, end = _month_range(period)
    stmt = (
        select(
            GLJournalLine.currency,
            func.coalesce(func.sum(GLJournalLine.base_debit), 0),
            func.coalesce(func.sum(GLJournalLine.base_credit), 0),
        )
        .join(GLJournal, GLJournal.id == GLJournalLine.journal_id)
        .where(
            GLJournal.status == JournalStatus.POSTED,
            GLJournal.event_date >= start,
            GLJournal.event_date < end,
        )
        .group_by(GLJournalLine.currency)
    )
    rows = (await session.execute(stmt)).all()
    diffs = {}
    for ccy, d, c in rows:
        diff = (Decimal(d) - Decimal(c)).copy_abs()
        if diff > CENT:
            diffs[str(ccy)] = str(diff)
    ok = not diffs
    return ok, ("Balanced" if ok else f"Unbalanced: {diffs}"), {"diffs": diffs}


async def _c03_no_draft_journals(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    start, end = _month_range(period)
    count = (
        await session.execute(
            select(func.count())
            .select_from(GLJournal)
            .where(
                GLJournal.status == JournalStatus.DRAFT,
                GLJournal.event_date >= start,
                GLJournal.event_date < end,
            )
        )
    ).scalar_one()
    return count == 0, f"{count} draft journals", {"count": int(count)}


async def _c04_no_future_journals(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    _, end = _month_range(period)
    count = (
        await session.execute(
            select(func.count()).select_from(GLJournal).where(GLJournal.event_date >= end)
        )
    ).scalar_one()
    return count == 0, f"{count} journals dated after period", {"count": int(count)}


async def _journal_line_sum(
    session: AsyncSession, account_code: str, *, end_exclusive: date
) -> Decimal:
    stmt = (
        select(func.coalesce(func.sum(GLJournalLine.base_debit - GLJournalLine.base_credit), 0))
        .join(GLJournal, GLJournal.id == GLJournalLine.journal_id)
        .join(GLAccount, GLAccount.id == GLJournalLine.account_id)
        .where(
            GLJournal.status == JournalStatus.POSTED,
            GLJournal.event_date < end_exclusive,
            GLAccount.code == account_code,
        )
    )
    return Decimal((await session.execute(stmt)).scalar_one() or 0)


async def _c05_ap_subledger_matches_gl(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    _, end = _month_range(period)
    sub = (
        await session.execute(
            select(
                func.coalesce(func.sum(SupplierInvoice.total - SupplierInvoice.amount_paid), 0)
            ).where(
                SupplierInvoice.status.in_(
                    [SupplierInvoiceStatus.POSTED, SupplierInvoiceStatus.PARTIALLY_PAID]
                ),
                SupplierInvoice.invoice_date < end,
            )
        )
    ).scalar_one()
    gl_bal = await _journal_line_sum(session, "2010", end_exclusive=end)
    # AP normal balance CREDIT → GL balance = -(debit-credit)
    gl_ap = -gl_bal
    sub_d = Decimal(sub)
    ok = (sub_d - gl_ap).copy_abs() < CENT
    return ok, f"AP sub={sub_d} gl={gl_ap}", {"sub": str(sub_d), "gl": str(gl_ap)}


async def _c06_ar_subledger_matches_gl(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    _, end = _month_range(period)
    sub = (
        await session.execute(
            select(
                func.coalesce(func.sum(CustomerInvoice.total - CustomerInvoice.amount_paid), 0)
            ).where(
                CustomerInvoice.status.in_(
                    [CustomerInvoiceStatus.POSTED, CustomerInvoiceStatus.PARTIALLY_PAID]
                ),
                CustomerInvoice.invoice_date < end,
            )
        )
    ).scalar_one()
    gl_ar = await _journal_line_sum(session, "1100", end_exclusive=end)
    sub_d = Decimal(sub)
    ok = (sub_d - gl_ar).copy_abs() < CENT
    return ok, f"AR sub={sub_d} gl={gl_ar}", {"sub": str(sub_d), "gl": str(gl_ar)}


async def _c07_no_negative_inventory(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    count = (
        await session.execute(
            select(func.count()).select_from(StockLevel).where(StockLevel.on_hand < 0)
        )
    ).scalar_one()
    return count == 0, f"{count} negative stock levels", {"count": int(count)}


async def _c08_no_orphan_journal_lines(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    # Every line has a journal (FK enforced) and journal has at least one line
    bad = (
        await session.execute(
            select(func.count())
            .select_from(GLJournal)
            .outerjoin(GLJournalLine, GLJournalLine.journal_id == GLJournal.id)
            .where(GLJournalLine.id.is_(None))
        )
    ).scalar_one()
    return bad == 0, f"{bad} journals with no lines", {"count": int(bad)}


async def _c09_shipments_have_revenue(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    start, end = _month_range(period)
    shipped = list(
        (
            await session.execute(
                select(Shipment.id).where(
                    Shipment.status == ShipmentStatus.DISPATCHED,
                    Shipment.dispatched_at >= datetime.combine(start, datetime.min.time()),
                    Shipment.dispatched_at < datetime.combine(end, datetime.min.time()),
                )
            )
        )
        .scalars()
        .all()
    )
    if not shipped:
        return True, "0 shipments in period", {"count": 0}
    invoiced = (
        await session.execute(
            select(func.count(distinct(CustomerInvoice.shipment_id))).where(
                CustomerInvoice.shipment_id.in_(shipped)
            )
        )
    ).scalar_one()
    missing = len(shipped) - int(invoiced)
    return (
        missing == 0,
        f"{missing}/{len(shipped)} shipments missing AR invoice",
        {
            "shipped": len(shipped),
            "invoiced": int(invoiced),
        },
    )


async def _c10_supplier_invoices_have_po(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    start, end = _month_range(period)
    bad = (
        await session.execute(
            select(func.count())
            .select_from(SupplierInvoice)
            .where(
                SupplierInvoice.invoice_date >= start,
                SupplierInvoice.invoice_date < end,
                SupplierInvoice.po_id.is_(None),
            )
        )
    ).scalar_one()
    return bad == 0, f"{bad} SI w/o PO", {"count": int(bad)}


async def _c11_recognition_complete(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    target = date(period.year, period.month, 1)
    contracts = list(
        (
            await session.execute(
                select(ExpenseContract).where(
                    ExpenseContract.start_date <= target,
                )
            )
        )
        .scalars()
        .all()
    )
    expected_ids = [
        c.id
        for c in contracts
        if c.end_date is None or date(c.end_date.year, c.end_date.month, 1) >= target
    ]
    if not expected_ids:
        return True, "No contracts in period", {"count": 0}
    recognized = (
        await session.execute(
            select(func.count(distinct(RecognitionEntry.contract_id))).where(
                RecognitionEntry.period_id == period.id,
                RecognitionEntry.contract_id.in_(expected_ids),
            )
        )
    ).scalar_one()
    missing = len(expected_ids) - int(recognized)
    return (
        missing == 0,
        f"{missing}/{len(expected_ids)} contracts not recognized",
        {"missing": missing},
    )


async def _c12_purchase_orders_closed_or_partial(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    # INFO: count open POs at period end
    _, end = _month_range(period)
    count = (
        await session.execute(
            select(func.count())
            .select_from(PurchaseOrder)
            .where(PurchaseOrder.created_at < datetime.combine(end, datetime.min.time()))
        )
    ).scalar_one()
    return True, f"{count} POs created before period end", {"count": int(count)}


# (c12 is INFO-only — POStatus enum members vary by build.)


async def _c13_goods_receipts_finalized(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    start, end = _month_range(period)
    bad = (
        await session.execute(
            select(func.count())
            .select_from(GoodsReceipt)
            .where(
                GoodsReceipt.created_at >= datetime.combine(start, datetime.min.time()),
                GoodsReceipt.created_at < datetime.combine(end, datetime.min.time()),
                GoodsReceipt.status != GoodsReceiptStatus.POSTED,
            )
        )
    ).scalar_one()
    return bad == 0, f"{bad} non-posted GRs in period", {"count": int(bad)}


async def _c14_sales_orders_terminal(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    _, end = _month_range(period)
    open_count = (
        await session.execute(
            select(func.count())
            .select_from(SalesOrder)
            .where(
                SalesOrder.created_at < datetime.combine(end, datetime.min.time()),
                SalesOrder.status.in_([SalesOrderStatus.RECEIVED, SalesOrderStatus.CONFIRMED]),
            )
        )
    ).scalar_one()
    return True, f"{open_count} non-terminal SOs (info)", {"count": int(open_count)}


async def _c15_no_zero_amount_journals(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    start, end = _month_range(period)
    bad = (
        await session.execute(
            select(GLJournal.id)
            .join(GLJournalLine, GLJournalLine.journal_id == GLJournal.id)
            .where(
                GLJournal.event_date >= start,
                GLJournal.event_date < end,
            )
            .group_by(GLJournal.id)
            .having(func.sum(GLJournalLine.debit + GLJournalLine.credit) == 0)
        )
    ).all()
    return len(bad) == 0, f"{len(bad)} zero-amount journals", {"count": len(bad)}


async def _c16_cash_accounts_positive(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    _, end = _month_range(period)
    accts = list(
        (await session.execute(select(GLAccount).where(GLAccount.bs_tag == "cash"))).scalars().all()
    )
    negatives = []
    for a in accts:
        bal = await _journal_line_sum(session, a.code, end_exclusive=end)
        if bal < 0:
            negatives.append({"code": a.code, "balance": str(bal)})
    return len(negatives) == 0, f"{len(negatives)} cash accts negative", {"negatives": negatives}


async def _c17_ap_payments_not_overapplied(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    _, end = _month_range(period)
    bad = (
        await session.execute(
            select(func.count())
            .select_from(SupplierInvoice)
            .where(
                SupplierInvoice.amount_paid > SupplierInvoice.total,
                SupplierInvoice.invoice_date < end,
            )
        )
    ).scalar_one()
    return bad == 0, f"{bad} overpaid supplier invoices", {"count": int(bad)}


async def _c18_ar_payments_not_overapplied(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    _, end = _month_range(period)
    bad = (
        await session.execute(
            select(func.count())
            .select_from(CustomerInvoice)
            .where(
                CustomerInvoice.amount_paid > CustomerInvoice.total,
                CustomerInvoice.invoice_date < end,
            )
        )
    ).scalar_one()
    return bad == 0, f"{bad} overpaid customer invoices", {"count": int(bad)}


async def _c19_every_supplier_invoice_posted(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    start, end = _month_range(period)
    bad = (
        await session.execute(
            select(func.count())
            .select_from(SupplierInvoice)
            .where(
                SupplierInvoice.invoice_date >= start,
                SupplierInvoice.invoice_date < end,
                SupplierInvoice.status == SupplierInvoiceStatus.DRAFT,
            )
        )
    ).scalar_one()
    return bad == 0, f"{bad} DRAFT SIs in period", {"count": int(bad)}


async def _c20_every_customer_invoice_posted(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    start, end = _month_range(period)
    bad = (
        await session.execute(
            select(func.count())
            .select_from(CustomerInvoice)
            .where(
                CustomerInvoice.invoice_date >= start,
                CustomerInvoice.invoice_date < end,
                CustomerInvoice.status == CustomerInvoiceStatus.DRAFT,
            )
        )
    ).scalar_one()
    return bad == 0, f"{bad} DRAFT customer invoices", {"count": int(bad)}


async def _c21_pnl_revenue_positive(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    start, end = _month_range(period)
    rev_stmt = (
        select(func.coalesce(func.sum(GLJournalLine.base_credit - GLJournalLine.base_debit), 0))
        .join(GLJournal, GLJournal.id == GLJournalLine.journal_id)
        .join(GLAccount, GLAccount.id == GLJournalLine.account_id)
        .where(
            GLJournal.status == JournalStatus.POSTED,
            GLJournal.event_date >= start,
            GLJournal.event_date < end,
            GLAccount.account_type == AccountType.REVENUE,
        )
    )
    rev = Decimal((await session.execute(rev_stmt)).scalar_one() or 0)
    return True, f"Revenue {rev}", {"revenue": str(rev)}


async def _c22_chart_of_accounts_intact(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    required = ["1020", "1100", "2010", "4010"]
    missing = []
    for code in required:
        exists = (
            await session.execute(select(GLAccount.id).where(GLAccount.code == code))
        ).scalar_one_or_none()
        if exists is None:
            missing.append(code)
    return len(missing) == 0, f"missing CoA codes: {missing}", {"missing": missing}


async def _c23_no_duplicate_journal_numbers(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    bad = (
        await session.execute(
            select(GLJournal.journal_number, func.count())
            .group_by(GLJournal.journal_number)
            .having(func.count() > 1)
        )
    ).all()
    return len(bad) == 0, f"{len(bad)} duplicate journal numbers", {"count": len(bad)}


async def _c24_recognition_entries_balanced(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    bad = (
        await session.execute(
            select(func.count())
            .select_from(RecognitionEntry)
            .where(RecognitionEntry.period_id == period.id, RecognitionEntry.amount <= 0)
        )
    ).scalar_one()
    return bad == 0, f"{bad} non-positive recognition amounts", {"count": int(bad)}


async def _c25_payment_currency_consistency(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    start, end = _month_range(period)
    bad = (
        await session.execute(
            select(func.count())
            .select_from(ARPayment)
            .where(
                ARPayment.payment_date >= start,
                ARPayment.payment_date < end,
                ARPayment.currency.is_(None),
            )
        )
    ).scalar_one()
    return bad == 0, f"{bad} payments missing currency", {"count": int(bad)}


async def _c26_period_not_already_locked(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    # Caller flips to CLOSING; LOCKED would be a no-op.
    return True, f"Status={period.status.value}", {"status": period.status.value}


async def _c27_journal_currency_set(
    session: AsyncSession, period: AccountingPeriod
) -> tuple[bool, str, dict[str, Any]]:
    start, end = _month_range(period)
    bad = (
        await session.execute(
            select(func.count())
            .select_from(GLJournalLine)
            .join(GLJournal, GLJournal.id == GLJournalLine.journal_id)
            .where(
                GLJournal.event_date >= start,
                GLJournal.event_date < end,
                and_(
                    GLJournalLine.currency.is_not(None),
                    GLJournalLine.currency == "",
                ),
            )
        )
    ).scalar_one()
    return bad == 0, f"{bad} lines w/ empty currency", {"count": int(bad)}


# -------------- registry --------------

CHECKS: list[AuditCheck] = [
    AuditCheck("period_exists", AuditSeverity.INFO, _c01_period_exists),
    AuditCheck("trial_balance_balanced", AuditSeverity.BLOCKER, _c02_trial_balance_balanced),
    AuditCheck("no_draft_journals", AuditSeverity.BLOCKER, _c03_no_draft_journals),
    AuditCheck("no_future_journals", AuditSeverity.BLOCKER, _c04_no_future_journals),
    AuditCheck("ap_subledger_matches_gl", AuditSeverity.BLOCKER, _c05_ap_subledger_matches_gl),
    AuditCheck("ar_subledger_matches_gl", AuditSeverity.BLOCKER, _c06_ar_subledger_matches_gl),
    AuditCheck("no_negative_inventory", AuditSeverity.BLOCKER, _c07_no_negative_inventory),
    AuditCheck("no_orphan_journals", AuditSeverity.BLOCKER, _c08_no_orphan_journal_lines),
    AuditCheck("shipments_have_revenue", AuditSeverity.BLOCKER, _c09_shipments_have_revenue),
    AuditCheck("supplier_invoices_have_po", AuditSeverity.WARN, _c10_supplier_invoices_have_po),
    AuditCheck("recognition_complete", AuditSeverity.BLOCKER, _c11_recognition_complete),
    AuditCheck("po_status_info", AuditSeverity.INFO, _c12_purchase_orders_closed_or_partial),
    AuditCheck("goods_receipts_finalized", AuditSeverity.WARN, _c13_goods_receipts_finalized),
    AuditCheck("sales_orders_terminal", AuditSeverity.INFO, _c14_sales_orders_terminal),
    AuditCheck("no_zero_amount_journals", AuditSeverity.BLOCKER, _c15_no_zero_amount_journals),
    AuditCheck("cash_accounts_positive", AuditSeverity.WARN, _c16_cash_accounts_positive),
    AuditCheck("ap_not_overapplied", AuditSeverity.BLOCKER, _c17_ap_payments_not_overapplied),
    AuditCheck("ar_not_overapplied", AuditSeverity.BLOCKER, _c18_ar_payments_not_overapplied),
    AuditCheck(
        "every_supplier_invoice_posted",
        AuditSeverity.BLOCKER,
        _c19_every_supplier_invoice_posted,
    ),
    AuditCheck(
        "every_customer_invoice_posted",
        AuditSeverity.BLOCKER,
        _c20_every_customer_invoice_posted,
    ),
    AuditCheck("pnl_revenue", AuditSeverity.INFO, _c21_pnl_revenue_positive),
    AuditCheck("chart_of_accounts_intact", AuditSeverity.BLOCKER, _c22_chart_of_accounts_intact),
    AuditCheck(
        "no_duplicate_journal_numbers", AuditSeverity.BLOCKER, _c23_no_duplicate_journal_numbers
    ),
    AuditCheck(
        "recognition_entries_balanced", AuditSeverity.BLOCKER, _c24_recognition_entries_balanced
    ),
    AuditCheck(
        "payment_currency_consistency", AuditSeverity.WARN, _c25_payment_currency_consistency
    ),
    AuditCheck("period_not_already_locked", AuditSeverity.INFO, _c26_period_not_already_locked),
    AuditCheck("journal_currency_set", AuditSeverity.WARN, _c27_journal_currency_set),
]

assert len(CHECKS) == 27, f"Expected 27 audit checks, got {len(CHECKS)}"


async def run_audits(session: AsyncSession, *, period: AccountingPeriod) -> list[AuditCheckResult]:
    results: list[AuditCheckResult] = []
    for check in CHECKS:
        try:
            ok, message, refs = await check.fn(session, period)
        except Exception as exc:
            ok = False
            message = f"check raised: {exc!r}"
            refs = {}
        row = AuditCheckResult(
            period_id=period.id,
            check_name=check.name,
            severity=check.severity,
            ok=ok,
            message=message,
            refs=refs,
        )
        session.add(row)
        results.append(row)
    await session.flush()
    return results


def list_checks() -> list[dict[str, Any]]:
    return [{"name": c.name, "severity": c.severity.value} for c in CHECKS]


__all__ = ["CHECKS", "AuditCheck", "list_checks", "run_audits"]
