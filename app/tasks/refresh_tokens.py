"""Hourly Celery task that refreshes OAuth tokens before they expire."""

import logging

from app.db.session import SessionLocal
from app.services.token_refresh import run_token_refresh_sweep
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


def sweep_expiring_tokens() -> dict[str, int]:
    """Refresh due accounts once. Safe to call from Celery or the in-process scheduler."""
    db = SessionLocal()
    try:
        counts = run_token_refresh_sweep(db)
    except Exception as exc:
        logger.info(
            "Token refresh sweep outcome=error error_type=%s",
            type(exc).__name__,
        )
        return {
            "refreshed": 0,
            "permanent": 0,
            "transient": 1,
            "locked": 0,
            "stale": 0,
            "skipped": 0,
        }
    finally:
        db.close()
    logger.info(
        "Token refresh sweep refreshed=%s permanent=%s transient=%s locked=%s skipped=%s",
        counts.get("refreshed", 0),
        counts.get("permanent", 0),
        counts.get("transient", 0),
        counts.get("locked", 0),
        counts.get("skipped", 0),
    )
    return counts


@celery_app.task(name="app.tasks.refresh_tokens.refresh_expiring_tokens")
def refresh_expiring_tokens() -> dict[str, int]:
    """Beat entry point. Refreshes every account inside its safety window."""
    return sweep_expiring_tokens()
