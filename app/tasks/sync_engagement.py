"""Periodic sync of comments and insights for recently published posts."""

import logging

from app.db.session import SessionLocal
from app.services.engagement.sync import run_engagement_sweep
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


def sweep_engagement() -> dict:
    """Run one engagement pass. Safe to call from Celery or the in-process scheduler."""
    db = SessionLocal()
    try:
        return run_engagement_sweep(db)
    except Exception as exc:
        logger.info(
            "Engagement sync outcome=error error_type=%s",
            type(exc).__name__,
        )
        return {
            "posts_seen": 0,
            "posts_synced": 0,
            "comments_upserted": 0,
            "insights_captured": 0,
            "skipped": 0,
            "reconnects": 0,
            "errors": 1,
        }
    finally:
        db.close()


@celery_app.task(name="app.tasks.sync_engagement.sync_engagement")
def sync_engagement() -> dict:
    """Beat entry point. Visits published posts inside the lookback window."""
    return sweep_engagement()
