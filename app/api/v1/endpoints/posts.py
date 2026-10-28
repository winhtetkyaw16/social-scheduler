"""Versioned endpoints for post lifecycle and publishing actions."""

import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models import ScheduledPost, User
from app.schemas import PostCreate, PostRead, PostUpdate
from app.services.posts import (
    archive_post,
    create_post,
    delete_post,
    get_owned_post,
    list_posts,
    retry_post,
    update_post,
)

router = APIRouter()
logger = logging.getLogger(__name__)

# Post now from the composer uses a near-future timestamp; Celery beat is often
# offline locally, so treat "now" and a short grace window as immediate work.
_IMMEDIATE_GRACE = timedelta(seconds=120)

# Deduplicate create + GET /posts both enqueueing the same id within a short window.
_enqueue_lock = threading.Lock()
_recent_enqueues: dict[str, float] = {}
_ENQUEUE_DEDUP_SECONDS = 15.0


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _wants_immediate_publish(post: ScheduledPost) -> bool:
    """True when the post should publish without waiting for Celery beat."""
    if post.status not in {"scheduled", "queued"}:
        return False
    metadata = post.post_metadata if isinstance(post.post_metadata, dict) else {}
    if metadata.get("scheduleMode") == "now":
        return True
    scheduled_at = _aware_utc(post.scheduled_at)
    return scheduled_at <= datetime.now(timezone.utc) + _IMMEDIATE_GRACE


def _mark_queued_for_immediate(db: Session, post: ScheduledPost) -> ScheduledPost:
    """Flip scheduled → queued before the HTTP response so the UI is not stuck on scheduled."""
    if post.status == "scheduled" and _wants_immediate_publish(post):
        post.status = "queued"
        db.commit()
        db.refresh(post)
    return post


def _should_accept_enqueue(post_id: str) -> bool:
    """Return False when this post_id was already handed to a worker very recently."""
    now = time.monotonic()
    with _enqueue_lock:
        stale = [key for key, ts in _recent_enqueues.items() if now - ts > _ENQUEUE_DEDUP_SECONDS]
        for key in stale:
            _recent_enqueues.pop(key, None)
        previous = _recent_enqueues.get(post_id)
        if previous is not None and now - previous < _ENQUEUE_DEDUP_SECONDS:
            return False
        _recent_enqueues[post_id] = now
        return True


# --- REQUEST HANDLERS ---
@router.post("", response_model=PostRead, status_code=status.HTTP_200_OK)
def add_post(
    payload: PostCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ScheduledPost:
    """Persist a post immediately and enqueue immediate publishing afterward."""
    post = create_post(db, user.id, payload)
    if _wants_immediate_publish(post):
        post = _mark_queued_for_immediate(db, post)
        # Provider requests run in Celery; in-process fallback covers broker outages.
        background_tasks.add_task(enqueue_immediate_publish, str(post.id))
    return post


@router.get("", response_model=list[PostRead])
def get_posts(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ScheduledPost]:
    """List owned posts. Legacy rows marked published before a provider id existed are still dispatched.

    Also opportunistically dispatches due scheduled/queued posts so local
    schedules still fire when Celery/Redis is unavailable (in-process fallback
    inside enqueue_immediate_publish).
    """
    posts = list_posts(db, user.id)
    pending_ids = [
        str(post.id)
        for post in posts
        if _is_pending_immediate_publish(post) or _is_due_scheduled_post(post)
    ]
    if pending_ids:
        background_tasks.add_task(enqueue_immediate_posts, pending_ids)
    return posts


@router.get("/{post_id}", response_model=PostRead)
def get_post(
    post_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ScheduledPost:
    """Return one post only when it belongs to the authenticated user."""
    return get_owned_post(db, post_id, user.id)


@router.patch("/{post_id}", response_model=PostRead)
def patch_post(
    post_id: UUID,
    payload: PostUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ScheduledPost:
    """Update an owned draft or scheduled post; enqueue when the time is due/now."""
    post = update_post(db, get_owned_post(db, post_id, user.id), payload)
    if _wants_immediate_publish(post):
        post = _mark_queued_for_immediate(db, post)
        background_tasks.add_task(enqueue_immediate_publish, str(post.id))
    return post


@router.post("/{post_id}/publish-now", response_model=PostRead, status_code=status.HTTP_202_ACCEPTED)
def publish_post_now(
    post_id: UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ScheduledPost:
    """Set scheduled_at to now and enqueue in-process publish (Post now)."""
    post = get_owned_post(db, post_id, user.id)
    if post.status not in {"draft", "scheduled", "queued"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only draft, scheduled, or queued posts can be published now",
        )
    now = datetime.now(timezone.utc)
    post.scheduled_at = now
    if post.status == "draft":
        post.status = "scheduled"
    metadata = dict(post.post_metadata or {})
    metadata["scheduleMode"] = "now"
    post.post_metadata = metadata
    # Mark queued immediately so calendar does not keep showing "scheduled".
    post.status = "queued"
    db.commit()
    post = get_owned_post(db, post_id, user.id)
    background_tasks.add_task(enqueue_immediate_publish, str(post.id))
    return post


@router.post("/{post_id}/retry", response_model=PostRead, status_code=status.HTTP_202_ACCEPTED)
def retry_failed_post(
    post_id: UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ScheduledPost:
    """Requeue an owned failed post without blocking on broker availability."""
    post = retry_post(db, get_owned_post(db, post_id, user.id))
    background_tasks.add_task(enqueue_immediate_publish, str(post.id))
    return post


@router.post("/{post_id}/archive", response_model=PostRead)
def archive_completed_post(
    post_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ScheduledPost:
    """Archive a completed or failed post while retaining its history."""
    return archive_post(db, get_owned_post(db, post_id, user.id))


@router.delete("/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_post(
    post_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """Permanently delete an owned post and its execution logs."""
    delete_post(db, get_owned_post(db, post_id, user.id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- BACKGROUND DISPATCH ---
def _is_pending_immediate_publish(post: ScheduledPost) -> bool:
    """Identify posts auto-marked published but not yet sent to a provider."""
    return (
        post.status == "published"
        and post.provider_post_id is None
        and post.attempt_count == 0
        and post.published_at is not None
        and post.published_at == post.scheduled_at
    )


def _is_due_scheduled_post(post: ScheduledPost) -> bool:
    """True when a scheduled/queued post is due and Celery beat may be offline."""
    if post.status not in {"scheduled", "queued"}:
        return False
    # Already has a Graph id — list_posts reconcile should have fixed status.
    if (post.provider_post_id or "").strip():
        return False
    scheduled_at = _aware_utc(post.scheduled_at)
    return scheduled_at <= datetime.now(timezone.utc)


def enqueue_immediate_publish(post_id: str) -> None:
    """Queue a post, or publish it in FastAPI's background thread on outage.

    Starlette runs synchronous background tasks in its thread pool, so a slow
    provider call here does not block the Uvicorn event loop or HTTP response.
    """
    if not _should_accept_enqueue(post_id):
        logger.info("Skipping duplicate immediate enqueue for post %s", post_id)
        return

    from app.tasks.publish_post import publish_post_task

    try:
        publish_post_task.apply_async(args=[post_id])
    except Exception as exc:
        logger.warning(
            "Celery broker unavailable; using FastAPI background publishing for post %s (%s)",
            post_id,
            type(exc).__name__,
        )
        try:
            publish_post_task.run(post_id)
        except Exception:
            logger.exception("FastAPI background publishing failed for post %s", post_id)


def enqueue_immediate_posts(post_ids: list[str]) -> None:
    """Submit a batch of immediate posts to the publishing queue."""
    for post_id in post_ids:
        enqueue_immediate_publish(post_id)
