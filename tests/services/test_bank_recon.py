"""v0.4.0 — Bank statement import + auto-match."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.integrations.paymob.settlement_csv import PaymobSettlementRow
from app.models.payments import BankTransaction, BankTxnMatchType, BankTxnStatus
from app.services import bank_recon as bank_svc
from app.services import cod_ledger as cod_svc
from app.services import gl as gl_svc
from app.services import paymob_recon as paymob_svc

pytestmark = pytest.mark.asyncio


async def test_import_statement_dedupes_by_external_ref(db_session):
    acct = await bank_svc.get_or_create_account(
        db_session, code="MAIN", name="Main", bank_name="CIB"
    )
    rows = [
        bank_svc.BankStatementRow(
            transaction_date=date(2025, 3, 1),
            amount=Decimal("100"),
            description="Test",
            external_ref="EXT-1",
        )
    ]
    r1 = await bank_svc.import_statement(db_session, bank_account_id=acct.id, rows=rows)
    r2 = await bank_svc.import_statement(db_session, bank_account_id=acct.id, rows=rows)
    assert r1["created"] == 1
    assert r2["skipped"] == 1


async def test_auto_match_paymob_settlement(db_session):
    await gl_svc.seed_egypt_coa(db_session)
    # ingest 2 paymob txns with same settlement_ref → total net = 950+475 = 1425
    paymob_rows = [
        PaymobSettlementRow(
            external_id=f"TXN-{i}",
            order_external_id=None,
            amount_gross=Decimal(amt),
            fees=Decimal(fee),
            amount_net=Decimal(amt) - Decimal(fee),
            currency="EGP",
            captured_at=datetime(2025, 3, 1),
            settled_at=datetime(2025, 3, 2),
            settlement_ref="BATCH-99",
            payment_method="CARD",
            status="SETTLED",
            raw={},
        )
        for i, (amt, fee) in enumerate([("1000", "50"), ("500", "25")])
    ]
    await paymob_svc.ingest_settlement_rows(db_session, paymob_rows)

    acct = await bank_svc.get_or_create_account(
        db_session, code="MAIN", name="Main", bank_name="CIB"
    )
    await bank_svc.import_statement(
        db_session,
        bank_account_id=acct.id,
        rows=[
            bank_svc.BankStatementRow(
                transaction_date=date(2025, 3, 3),
                amount=Decimal("1425"),  # net total of BATCH-99
                description="PAYMOB SETTLEMENT BATCH-99",
                external_ref="STMT-1",
            )
        ],
    )

    report = await bank_svc.auto_match_unmatched(db_session)
    assert report["matched_paymob"] == 1

    txn = (
        await db_session.execute(
            select(BankTransaction).where(BankTransaction.external_ref == "STMT-1")
        )
    ).scalar_one()
    assert txn.status == BankTxnStatus.MATCHED
    assert txn.matched_type == BankTxnMatchType.PAYMOB_SETTLEMENT


async def test_auto_match_bosta_remittance(db_session):
    await gl_svc.seed_egypt_coa(db_session)
    # Ship + remit a COD entry under remittance_ref STMT-5
    await cod_svc.record_shipment(
        db_session,
        tracking_id="BST-700",
        cod_amount=Decimal("500"),
    )
    from app.integrations.bosta.remittance_csv import BostaRemittanceRow

    await cod_svc.apply_remittance_rows(
        db_session,
        [
            BostaRemittanceRow(
                tracking_id="BST-700",
                cod_amount=Decimal("500"),
                delivery_fee=Decimal("0"),
                delivered_at=datetime(2025, 3, 2),
                remitted_at=datetime(2025, 3, 3),
                remittance_ref="STMT-5",
                status="DELIVERED",
                raw={},
            )
        ],
    )

    acct = await bank_svc.get_or_create_account(
        db_session, code="MAIN", name="Main", bank_name="CIB"
    )
    await bank_svc.import_statement(
        db_session,
        bank_account_id=acct.id,
        rows=[
            bank_svc.BankStatementRow(
                transaction_date=date(2025, 3, 3),
                amount=Decimal("500"),
                description="BOSTA REMITTANCE STMT-5",
                external_ref="STMT-7",
            )
        ],
    )

    report = await bank_svc.auto_match_unmatched(db_session)
    assert report["matched_bosta"] == 1

    txn = (
        await db_session.execute(
            select(BankTransaction).where(BankTransaction.external_ref == "STMT-7")
        )
    ).scalar_one()
    assert txn.status == BankTxnStatus.MATCHED
    assert txn.matched_type == BankTxnMatchType.BOSTA_REMITTANCE


async def test_auto_match_no_match_stays_unmatched(db_session):
    acct = await bank_svc.get_or_create_account(
        db_session, code="MAIN", name="Main", bank_name="CIB"
    )
    await bank_svc.import_statement(
        db_session,
        bank_account_id=acct.id,
        rows=[
            bank_svc.BankStatementRow(
                transaction_date=date(2025, 3, 3),
                amount=Decimal("123"),
                description="Random transfer",
                external_ref="WHAT-1",
            )
        ],
    )
    report = await bank_svc.auto_match_unmatched(db_session)
    assert report["unmatched"] == 1
