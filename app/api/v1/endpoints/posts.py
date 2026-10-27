"""Versioned endpoints for post lifecycle and publishing actions."""

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Response, status
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
    scheduled_at = post.scheduled_at
    if scheduled_at.tzinfo is None:
        scheduled_at = scheduled_at.replace(tzinfo=timezone.utc)
    if scheduled_at <= datetime.now(timezone.utc):
        # Provider requests run in Celery; the periodic dispatcher recovers
        # work when the broker is temporarily unavailable.
        background_tasks.add_task(enqueue_immediate_publish, str(post.id))
    return post


@router.get("", response_model=list[PostRead])
def get_posts(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ScheduledPost]:
    """List all owned posts and dispatch previously auto-published schedules."""
    posts = list_posts(db, user.id)
    pending_ids = [str(post.id) for post in posts if _is_pending_immediate_publish(post)]
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
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ScheduledPost:
    """Update an owned draft or scheduled post."""
    return update_post(db, get_owned_post(db, post_id, user.id), payload)


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


def enqueue_immediate_publish(post_id: str) -> None:
    """Queue a post, or publish it in FastAPI's background thread on outage.

    Starlette runs synchronous background tasks in its thread pool, so a slow
    provider call here does not block the Uvicorn event loop or HTTP response.
    """
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
