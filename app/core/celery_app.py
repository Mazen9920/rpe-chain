"""Celery app + Beat schedule.

v0.3.1: full automation — monthly recognition, monthly close attempt, daily AR
aging snapshot, daily audit dry-run for current period.
"""

from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from app.core.config import get_settings

_settings = get_settings()

celery_app = Celery(
    "rpe_gear",
    broker=_settings.celery_broker_url,
    backend=_settings.celery_result_backend,
    include=["app.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_track_started=True,
    broker_connection_retry_on_startup=True,
)

celery_app.conf.beat_schedule = {
    # Day 1 of each month at 02:00 UTC — recognize all active contracts for the
    # newly-opened previous month.
    "monthly-recognition": {
        "task": "rpe_gear.recognition.run_monthly",
        "schedule": crontab(minute=0, hour=2, day_of_month=1),
        "args": (),
    },
    # Day 5 of each month at 03:00 UTC — attempt to close previous month.
    # Idempotent: skips if already LOCKED.
    "monthly-close-attempt": {
        "task": "rpe_gear.period_close.attempt_previous_month",
        "schedule": crontab(minute=0, hour=3, day_of_month=5),
        "args": (),
    },
    # Daily 04:00 UTC — run audits on current period (dry-run, no lock).
    "daily-audit-snapshot": {
        "task": "rpe_gear.audit.run_for_current_period",
        "schedule": crontab(minute=0, hour=4),
        "args": (),
    },
    # v0.4.0 cash-in reconciliation:
    # Daily 06:00 UTC — pull Paymob settlements and post journals.
    "daily-paymob-recon": {
        "task": "rpe_gear.paymob.recon_daily",
        "schedule": crontab(minute=0, hour=6),
        "args": (),
    },
    # Daily 07:00 UTC — sync Bosta delivery status.
    "daily-bosta-status-sync": {
        "task": "rpe_gear.bosta.sync_status",
        "schedule": crontab(minute=0, hour=7),
        "args": (),
    },
    # Daily 07:30 UTC — alert if COD void rate > 10% over last 30 days.
    "daily-cod-void-rate-check": {
        "task": "rpe_gear.bosta.void_rate_check",
        "schedule": crontab(minute=30, hour=7),
        "args": (),
    },
    # Daily 08:00 UTC — auto-match bank statement lines.
    "daily-bank-auto-match": {
        "task": "rpe_gear.bank.auto_match",
        "schedule": crontab(minute=0, hour=8),
        "args": (),
    },
}
