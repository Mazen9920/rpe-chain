"""GL post_journal + trial_balance + Egypt CoA seed tests."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models.gl import GLAccount, GLJournalLine, JournalStatus
from app.services import gl as gl_svc

pytestmark = pytest.mark.asyncio


async def test_seed_egypt_coa_idempotent(db_session):
    n1 = await gl_svc.seed_egypt_coa(db_session)
    n2 = await gl_svc.seed_egypt_coa(db_session)
    assert n1 > 20 and n2 == 0
    cash = (
        await db_session.execute(select(GLAccount).where(GLAccount.code == "1010"))
    ).scalar_one()
    assert cash.name.startswith("Cash")


async def test_post_journal_balanced(db_session):
    await gl_svc.seed_egypt_coa(db_session)
    import uuid

    j = await gl_svc.post_journal(
        db_session,
        source_doc_type="TEST",
        source_doc_id=uuid.uuid4(),
        event_date=date(2026, 1, 15),
        lines=[
            gl_svc.JournalLineSpec(account_code="1020", debit=Decimal("100")),
            gl_svc.JournalLineSpec(account_code="3010", credit=Decimal("100")),
        ],
        memo="initial capital",
    )
    await db_session.flush()
    assert j.status == JournalStatus.POSTED
    assert j.journal_number.startswith("J202601")
    lines = list(
        (await db_session.execute(select(GLJournalLine).where(GLJournalLine.journal_id == j.id)))
        .scalars()
        .all()
    )
    assert len(lines) == 2
    assert sum(ln.debit for ln in lines) == sum(ln.credit for ln in lines)


async def test_post_journal_unbalanced_raises(db_session):
    await gl_svc.seed_egypt_coa(db_session)
    import uuid

    with pytest.raises(gl_svc.UnbalancedJournalError):
        await gl_svc.post_journal(
            db_session,
            source_doc_type="TEST",
            source_doc_id=uuid.uuid4(),
            event_date=date(2026, 1, 15),
            lines=[
                gl_svc.JournalLineSpec(account_code="1020", debit=Decimal("100")),
                gl_svc.JournalLineSpec(account_code="3010", credit=Decimal("90")),
            ],
        )


async def test_trial_balance(db_session):
    await gl_svc.seed_egypt_coa(db_session)
    import uuid

    await gl_svc.post_journal(
        db_session,
        source_doc_type="TEST",
        source_doc_id=uuid.uuid4(),
        event_date=date(2026, 1, 10),
        lines=[
            gl_svc.JournalLineSpec(account_code="1020", debit=Decimal("500")),
            gl_svc.JournalLineSpec(account_code="3010", credit=Decimal("500")),
        ],
    )
    await gl_svc.post_journal(
        db_session,
        source_doc_type="TEST",
        source_doc_id=uuid.uuid4(),
        event_date=date(2026, 1, 12),
        lines=[
            gl_svc.JournalLineSpec(account_code="5000", debit=Decimal("200")),
            gl_svc.JournalLineSpec(account_code="1020", credit=Decimal("200")),
        ],
    )
    rows = await gl_svc.trial_balance(db_session, as_of=date(2026, 1, 31))
    by_code = {code: (d, c) for code, d, c in rows}
    assert by_code["1020"] == (Decimal("500.0000"), Decimal("200.0000"))
    assert by_code["3010"] == (Decimal("0.0000"), Decimal("500.0000"))
    assert by_code["5000"] == (Decimal("200.0000"), Decimal("0.0000"))
    # global trial balance balances
    total_d = sum(d for d, _ in by_code.values())
    total_c = sum(c for _, c in by_code.values())
    assert total_d == total_c
