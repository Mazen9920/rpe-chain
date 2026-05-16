"""Celery task module placeholder. Real tasks land in later releases."""

from app.core.celery_app import celery_app


@celery_app.task(name="rpe_gear.ping")  # type: ignore[untyped-decorator]
def ping() -> str:
    """Smoke task — used to verify worker connectivity."""
    return "pong"
