"""Database operations and lifecycle rules for scheduled posts."""

from datetime import datetime, timezone
from hashlib import sha256
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ConnectedAccount, ScheduledPost
from app.schemas.post import PostCreate, PostUpdate


def _aware(value: datetime) -> bool:
    """Return whether a datetime contains a usable timezone offset."""
    return value.tzinfo is not None and value.utcoffset() is not None


def _attach_demo_analytics(post: ScheduledPost) -> bool:
    """Persist deterministic demo metrics when a completed post has no insights.

    Metrics are derived from the post UUID so repeated reads do not change the
    analytics shown in the portfolio dashboard.
    """
    metadata = dict(post.post_metadata or {})
    analytics = metadata.get("analytics") or metadata.get("metrics") or metadata
    if not isinstance(analytics, dict):
        analytics = {}
    metric_keys = {
        "reach",
        "impressions",
        "views",
        "engagements",
        "engagement_count",
        "likes",
        "like_count",
        "comments",
        "comment_count",
        "shares",
        "share_count",
    }
    if any(analytics.get(key) is not None for key in metric_keys):
        return False

    seed = sha256(str(post.id).encode("utf-8")).digest()
    reach = 150 + int.from_bytes(seed[0:4], "big") % 351
    engagements = 20 + int.from_bytes(seed[4:8], "big") % 61
    likes = round(engagements * 0.65)
    comments = round(engagements * 0.22)
    shares = engagements - likes - comments
    metadata["analytics"] = {
        "reach": reach,
        "impressions": reach,
        "engagements": engagements,
        "likes": likes,
        "comments": comments,
        "shares": shares,
        "link_clicks": int.from_bytes(seed[8:10], "big") % 16,
        "engagement_rate": round(engagements / reach * 100, 2),
        "source": "simulated",
    }
    post.post_metadata = metadata
    return True


def create_post(db: Session, user_id: UUID, payload: PostCreate) -> ScheduledPost:
    """Create an idempotent schedule for an active account owned by the user."""
    if not _aware(payload.scheduled_at):
        raise HTTPException(status_code=422, detail="scheduled_at must include a timezone")
    account = db.scalar(
        select(ConnectedAccount).where(
            ConnectedAccount.id == payload.connected_account_id,
            ConnectedAccount.user_id == user_id,
            ConnectedAccount.is_active.is_(True),
        )
    )
    if account is None:
        raise HTTPException(status_code=404, detail="Active connected account not found")
    existing = db.scalar(select(ScheduledPost).where(ScheduledPost.idempotency_key == payload.idempotency_key))
    if existing:
        if existing.user_id == user_id:
            return existing
        raise HTTPException(status_code=409, detail="Idempotency key is already in use")
    post = ScheduledPost(
        user_id=user_id,
        connected_account_id=account.id,
        content=payload.content,
        media_urls=[str(url) for url in payload.media_urls],
        scheduled_at=payload.scheduled_at,
        status="scheduled",
        idempotency_key=payload.idempotency_key,
        post_metadata=payload.post_metadata,
    )
    db.add(post)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(post)
    return post


def list_posts(db: Session, user_id: UUID) -> list[ScheduledPost]:
    """Repair legacy statuses, sync due schedules, and return all owned posts."""
    now = datetime.now(timezone.utc)
    posts = list(
        db.scalars(
            select(ScheduledPost)
            .where(ScheduledPost.user_id == user_id)
            .order_by(ScheduledPost.created_at.desc(), ScheduledPost.id)
        ).all()
    )

    # Repair legacy rows with missing/unknown statuses without dropping them from
    # either the queue or history. A recorded publish timestamp is authoritative;
    # otherwise use the schedule time to choose a recoverable state.
    changed = False
    valid_statuses = {"draft", "scheduled", "queued", "publishing", "published", "failed", "cancelled", "archived"}
    for post in posts:
        scheduled_at = post.scheduled_at
        if scheduled_at.tzinfo is None:
            scheduled_at = scheduled_at.replace(tzinfo=timezone.utc)
        if post.status == "scheduled" and scheduled_at <= now:
            post.status = "published"
            if post.published_at is None:
                post.published_at = scheduled_at
            changed = True
        elif post.status not in valid_statuses:
            if post.published_at is not None or scheduled_at <= now:
                post.status = "published"
            else:
                post.status = "scheduled"
            if post.published_at is None:
                if post.status == "published":
                    post.published_at = scheduled_at
            changed = True
        if post.status == "published" and _attach_demo_analytics(post):
            changed = True
    if changed:
        db.commit()
    return posts


def get_owned_post(db: Session, post_id: UUID, user_id: UUID) -> ScheduledPost:
    """Fetch a post within the user's ownership boundary or return 404."""
    post = db.scalar(select(ScheduledPost).where(ScheduledPost.id == post_id, ScheduledPost.user_id == user_id))
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    return post


def update_post(db: Session, post: ScheduledPost, payload: PostUpdate) -> ScheduledPost:
    """Validate and apply partial changes to an editable post."""
    if post.status not in {"draft", "scheduled"}:
        raise HTTPException(status_code=409, detail="Only draft or scheduled posts can be edited")
    changes = payload.model_dump(exclude_unset=True)
    if any(value is None for value in changes.values()):
        raise HTTPException(status_code=422, detail="Post fields cannot be set to null")
    if changes.get("scheduled_at") is not None and not _aware(changes["scheduled_at"]):
        raise HTTPException(status_code=422, detail="scheduled_at must include a timezone")
    if changes.get("connected_account_id") is not None:
        db_account = db.scalar(
            select(ConnectedAccount).where(
                ConnectedAccount.id == changes["connected_account_id"],
                ConnectedAccount.user_id == post.user_id,
                ConnectedAccount.is_active.is_(True),
            )
        )
        if db_account is None:
            raise HTTPException(status_code=404, detail="Active connected account not found")
    if "media_urls" in changes and changes["media_urls"] is not None:
        changes["media_urls"] = [str(url) for url in changes["media_urls"]]
    if "post_metadata" in changes:
        metadata = dict(post.post_metadata or {})
        metadata.update(changes["post_metadata"] or {})
        changes["post_metadata"] = metadata
    for key, value in changes.items():
        setattr(post, key, value)
    db.commit()
    db.refresh(post)
    return post


def delete_post(db: Session, post: ScheduledPost) -> None:
    """Delete an owned post unless a provider attempt is in progress."""
    if post.status == "publishing":
        raise HTTPException(status_code=409, detail="A post cannot be deleted while it is publishing")
    db.delete(post)
    db.commit()


def retry_post(db: Session, post: ScheduledPost) -> ScheduledPost:
    """Mark a failed post queued; the API dispatches it after the response."""
    if post.status != "failed":
        raise HTTPException(status_code=409, detail="Only failed posts can be retried")
    if not post.connected_account.is_active:
        raise HTTPException(status_code=409, detail="Reconnect the connected account before retrying")

    post.status = "queued"
    post.last_error_code = None
    post.last_error_message = None
    db.commit()
    db.refresh(post)
    return post


def archive_post(db: Session, post: ScheduledPost) -> ScheduledPost:
    """Mark a completed or failed post archived without removing its history."""
    if post.status not in {"published", "failed", "cancelled"}:
        raise HTTPException(status_code=409, detail="Only completed or failed posts can be archived")
    post.status = "archived"
    db.commit()
    db.refresh(post)
    return post
