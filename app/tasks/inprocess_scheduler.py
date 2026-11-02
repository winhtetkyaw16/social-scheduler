"""In-process due-post scheduler used when Celery/Redis is not running.

Started from the FastAPI lifespan. Every ``INPROCESS_SCHEDULER_SECONDS`` it
publishes due scheduled/queued posts directly (or hands them to Celery when
the broker is reachable). Double posting is prevented by the atomic DB claim
in ``publish_post_task`` (conditional UPDATE to ``publishing``), so several
processes or a --reload restart can never publish the same row twice.
"""

from __future__ import annotations

import asyncio
import logging
import os
import socket
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from sqlalchemy import or_, select

from app.core.config import APP_ENV, CELERY_BROKER_URL
from app.db.session import SessionLocal
from app.models import ScheduledPost

logger = logging.getLogger(__name__)

STALE_PUBLISHING_SECONDS = 15 * 60


def scheduler_mode() -> str:
    """auto (default), inprocess, celery, or off. Tests default to off."""
    default = "off" if APP_ENV == "test" else "auto"
    return os.getenv("INPROCESS_SCHEDULER", default).strip().lower()


def poll_seconds() -> float:
    try:
        return max(2.0, float(os.getenv("INPROCESS_SCHEDULER_SECONDS", "15")))
    except ValueError:
        return 15.0


def broker_reachable(timeout: float = 0.5) -> bool:
    """Fast TCP probe of the Celery broker (avoids multi-second Celery retries)."""
    try:
        parsed = urlparse(CELERY_BROKER_URL or "")
        if not parsed.hostname:
            return False
        with socket.create_connection((parsed.hostname, parsed.port or 6379), timeout=timeout):
            return True
    except OSError:
        return False


def _due_post_ids(db, now: datetime, limit: int = 50) -> list[str]:
    stmt = (
        select(ScheduledPost.id)
        .where(
            ScheduledPost.status.in_(["scheduled", "queued"]),
            ScheduledPost.scheduled_at <= now,
            or_(ScheduledPost.provider_post_id.is_(None), ScheduledPost.provider_post_id == ""),
        )
        .order_by(ScheduledPost.scheduled_at)
        .limit(limit)
    )
    return [str(pid) for pid in db.scalars(stmt).all()]


def _fail_stale_publishing(db, now: datetime) -> None:
    before = now - timedelta(seconds=STALE_PUBLISHING_SECONDS)
    for stuck in db.scalars(
        select(ScheduledPost).where(
            (ScheduledPost.status == "publishing")
            & (ScheduledPost.provider_post_id.is_(None))
            & (ScheduledPost.updated_at <= before)
        )
    ).all():
        stuck.status = "failed"
        stuck.last_error_code = "publish_interrupted"
        stuck.last_error_message = (
            "Publishing was interrupted before the provider confirmed it. Check the account, then Retry."
        )
        logger.warning("Marked stale publishing post %s as failed", stuck.id)
    db.commit()


def run_due_posts_once(use_celery: bool | None = None) -> int:
    """Publish (or enqueue) every due post once. Returns how many were handled."""
    from app.tasks.publish_post import publish_post_task

    mode = scheduler_mode()
    if use_celery is None:
        use_celery = mode == "celery" or (mode == "auto" and broker_reachable())
    if use_celery:
        from app.tasks.dispatch_due_posts import dispatch_due_posts

        return int(dispatch_due_posts.run())

    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        _fail_stale_publishing(db, now)
        ids = _due_post_ids(db, now)
    finally:
        db.close()
    handled = 0
    for post_id in ids:
        try:
            result = publish_post_task.run(post_id)
            handled += 1
            logger.info("Background scheduler processed post %s -> %s", post_id, result.get("status"))
        except Exception:
            logger.exception("Background scheduler failed for post %s", post_id)
    return handled


async def scheduler_loop(stop: asyncio.Event) -> None:
    interval = poll_seconds()
    logger.warning("Background publish scheduler started (mode=%s, every %.0fs)", scheduler_mode(), interval)
    while not stop.is_set():
        try:
            await asyncio.to_thread(run_due_posts_once)
        except Exception:
            logger.exception("Background publish scheduler pass failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except asyncio.TimeoutError:
            pass
    logger.warning("Background publish scheduler stopped")
