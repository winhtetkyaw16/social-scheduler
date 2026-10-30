"""Celery worker task that publishes one scheduled post with retry logging."""

import logging
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import or_, select, update

from app.core.config import POST_MAX_ATTEMPTS
from app.core.security import decrypt_token
from app.db.session import SessionLocal
from app.models import ExecutionLog, ScheduledPost
from app.services.publishing import PublishingError, publish
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)

_CLAIMABLE = ("scheduled", "queued")


def _reconcile_published(db, post: ScheduledPost) -> dict[str, str] | None:
    """If Graph already succeeded but status lagged, repair the row."""
    provider_id = (post.provider_post_id or "").strip()
    if not provider_id:
        return None
    if post.status == "published":
        return {"status": "skipped", "reason": "already_published"}
    post.status = "published"
    if post.published_at is None:
        post.published_at = datetime.now(timezone.utc)
    post.last_error_code = post.last_error_message = None
    db.commit()
    logger.info("Reconciled post %s to published (provider_post_id present)", post.id)
    return {"status": "published", "provider_post_id": provider_id, "reconciled": "1"}


@celery_app.task(name="app.tasks.publish_post.publish_post_task")
def publish_post_task(post_id: str) -> dict[str, str]:
    """Claim a post, call its platform adapter, and persist the outcome.

    Claim uses a conditional UPDATE so SQLite (no FOR UPDATE) and double
    enqueue from create + GET /posts cannot both call the Graph API.
    """
    db = SessionLocal()
    try:
        post_uuid = UUID(post_id)
        post = db.scalar(select(ScheduledPost).where(ScheduledPost.id == post_uuid))
        if post is None:
            return {"status": "skipped"}

        reconciled = _reconcile_published(db, post)
        if reconciled is not None:
            return reconciled

        auto_published_pending = (
            post.status == "published"
            and post.provider_post_id is None
            and post.attempt_count == 0
            and post.published_at is not None
            and post.published_at == post.scheduled_at
        )
        if post.status not in _CLAIMABLE and not auto_published_pending:
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

        # Atomic claim: only one concurrent worker may transition into publishing.
        claim_filter = [
            ScheduledPost.id == post_uuid,
            ScheduledPost.provider_post_id.is_(None),
            or_(
                ScheduledPost.status.in_(list(_CLAIMABLE)),
                (
                    (ScheduledPost.status == "published")
                    & (ScheduledPost.provider_post_id.is_(None))
                    & (ScheduledPost.attempt_count == 0)
                    & (ScheduledPost.published_at == ScheduledPost.scheduled_at)
                ),
            ),
        ]
        started = datetime.now(timezone.utc)
        claim_result = db.execute(
            update(ScheduledPost)
            .where(*claim_filter)
            .values(
                status="publishing",
                attempt_count=ScheduledPost.attempt_count + 1,
                updated_at=started,
            )
        )
        db.commit()
        if claim_result.rowcount != 1:
            db.refresh(post)
            reconciled = _reconcile_published(db, post)
            if reconciled is not None:
                return reconciled
            return {"status": "skipped", "reason": "claim_lost"}

        db.refresh(post)
        attempt = post.attempt_count
        log = ExecutionLog(
            scheduled_post_id=post.id,
            attempt_number=attempt,
            outcome="started",
            started_at=started,
        )
        db.add(log)
        db.commit()
        try:
            try:
                from app.services.oauth import refresh_account_token

                if refresh_account_token(db, account):
                    db.refresh(account)
            except Exception as exc:  # fall through; publish will surface the auth error
                logger.warning("Token refresh failed for account %s: %s", account.id, getattr(exc, "detail", type(exc).__name__))
            result = publish(
                account.platform,
                decrypt_token(account.access_token_ciphertext),
                account.platform_account_id,
                post.content,
                post.media_urls,
            )
            # Re-load and write success even if another session touched the row.
            db.refresh(post)
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
            db.refresh(post)
            # Never downgrade a row that already got a provider id from a twin race.
            if (post.provider_post_id or "").strip():
                post.status = "published"
                if post.published_at is None:
                    post.published_at = datetime.now(timezone.utc)
                log.outcome = "succeeded"
                log.finished_at = datetime.now(timezone.utc)
                db.commit()
                return {"status": "published", "provider_post_id": post.provider_post_id}
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
