"""Periodic Celery task that dispatches posts whose scheduled time is due."""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select

from app.db.session import SessionLocal
from app.models import ScheduledPost
from app.tasks.celery_app import celery_app
from app.tasks.publish_post import publish_post_task
from app.core.config import SCHEDULER_POLL_SECONDS

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.dispatch_due_posts.dispatch_due_posts")
def dispatch_due_posts(batch_size: int = 100) -> int:
    """Queue up to ``batch_size`` due posts for provider publishing."""
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        stale_queued_before = now - timedelta(seconds=max(10, SCHEDULER_POLL_SECONDS * 2))
        due_schedule = (ScheduledPost.status == "scheduled") & (ScheduledPost.scheduled_at <= now)
        stale_queued = (
            (ScheduledPost.status == "queued")
            & (ScheduledPost.scheduled_at <= now)
            & (ScheduledPost.updated_at <= stale_queued_before)
        )
        auto_published_pending = (
            (ScheduledPost.status == "published")
            & (ScheduledPost.provider_post_id.is_(None))
            & (ScheduledPost.attempt_count == 0)
            & (ScheduledPost.published_at == ScheduledPost.scheduled_at)
        )
        stmt = (
            select(ScheduledPost)
            .where(or_(due_schedule, stale_queued, auto_published_pending))
            .order_by(ScheduledPost.scheduled_at)
            .limit(batch_size)
            .with_for_update(skip_locked=True)
        )
        posts = list(db.scalars(stmt).all())
        for post in posts:
            if post.status != "published":
                post.status = "queued"
        db.commit()
        queued_count = 0
        for post in posts:
            post_id = str(post.id)
            try:
                publish_post_task.apply_async(args=[post_id])
                queued_count += 1
            except Exception as exc:
                # Make the due item eligible for the next dispatcher pass.
                if post.status == "queued":
                    post.status = "scheduled"
                    db.commit()
                logger.warning(
                    "Could not queue due post %s; it will be retried later (%s)",
                    post_id,
                    type(exc).__name__,
                )
        return queued_count
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
