"""Periodic job that re-queues evergreen posts into empty queue slots."""

import logging
import os

from app.db.session import SessionLocal
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


def evergreen_poll_seconds() -> float:
    """Seconds between evergreen passes (EVERGREEN_SCHEDULER_SECONDS, at least 30, default 300)."""
    try:
        return max(30.0, float(os.getenv("EVERGREEN_SCHEDULER_SECONDS", "300")))
    except ValueError:
        return 300.0


def run_evergreen_once() -> int:
    """One evergreen pass in its own session. Returns how many re-shares were scheduled."""
    from app.services.evergreen import requeue_evergreen_once

    db = SessionLocal()
    try:
        return len(requeue_evergreen_once(db))
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@celery_app.task(name="app.tasks.evergreen.requeue_evergreen")
def requeue_evergreen() -> int:
    """Celery beat entry point for the evergreen pass."""
    return run_evergreen_once()
