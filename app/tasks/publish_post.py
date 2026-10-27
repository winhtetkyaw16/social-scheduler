"""Celery worker task that publishes one scheduled post with retry logging."""

import logging
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select

from app.core.config import POST_MAX_ATTEMPTS
from app.core.security import decrypt_token
from app.db.session import SessionLocal
from app.models import ExecutionLog, ScheduledPost
from app.services.publishing import PublishingError, publish
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.publish_post.publish_post_task")
def publish_post_task(post_id: str) -> dict[str, str]:
    """Claim a post, call its platform adapter, and persist the outcome."""
    db = SessionLocal()
    try:
        claim = select(ScheduledPost).where(ScheduledPost.id == UUID(post_id))
        if db.bind is not None and db.bind.dialect.name == "postgresql":
            claim = claim.with_for_update()
        post = db.scalar(claim)
        auto_published_pending = bool(
            post
            and post.status == "published"
            and post.provider_post_id is None
            and post.attempt_count == 0
            and post.published_at is not None
            and post.published_at == post.scheduled_at
        )
        if post is None or (post.status not in {"queued", "scheduled"} and not auto_published_pending):
            return {"status": "skipped"}
        account = post.connected_account
        if not account.is_active:
            post.status = "failed"
            post.last_error_code = "account_inactive"
            post.last_error_message = "Connected account is inactive"
            db.add(
                ExecutionLog(
                    scheduled_post_id=post.id,
                    attempt_number=post.attempt_count + 1,
                    outcome="skipped",
                    started_at=datetime.now(timezone.utc),
                    finished_at=datetime.now(timezone.utc),
                    error_code=post.last_error_code,
                    error_message=post.last_error_message,
                )
            )
            db.commit()
            return {"status": "failed"}
        post.status = "publishing"
        post.attempt_count += 1
        attempt = post.attempt_count
        started = datetime.now(timezone.utc)
        log = ExecutionLog(scheduled_post_id=post.id, attempt_number=attempt, outcome="started", started_at=started)
        db.add(log)
        db.commit()
        try:
            result = publish(
                account.platform,
                decrypt_token(account.access_token_ciphertext),
                account.platform_account_id,
                post.content,
                post.media_urls,
            )
            post.status = "published"
            post.provider_post_id = result.post_id
            post.published_at = datetime.now(timezone.utc)
            post.last_error_code = post.last_error_message = None
            log.outcome, log.finished_at = "succeeded", post.published_at
            log.provider_request_id, log.provider_status_code = result.request_id, result.status_code
            db.commit()
            return {"status": "published", "provider_post_id": result.post_id}
        except Exception as exc:
            retryable = not isinstance(exc, PublishingError) or exc.retryable
            code = exc.code if isinstance(exc, PublishingError) else "publish_error"
            message = str(exc)[:4000]
            will_retry = retryable and attempt < min(post.max_attempts, POST_MAX_ATTEMPTS)
            post.status = "queued" if will_retry else "failed"
            post.last_error_code, post.last_error_message = code, message
            log.outcome = "retrying" if will_retry else "failed"
            log.finished_at, log.error_code, log.error_message = datetime.now(timezone.utc), code, message
            db.commit()
            if will_retry:
                try:
                    publish_post_task.apply_async(args=[post_id], countdown=min(300, 2**attempt * 5))
                except Exception as queue_error:
                    # Leave it queued; the periodic dispatcher reclaims stale
                    # queued work after the broker becomes reachable again.
                    logger.warning(
                        "Retry enqueue deferred for post %s because Celery is unavailable (%s)",
                        post_id,
                        type(queue_error).__name__,
                    )
            return {"status": post.status, "error": code}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
