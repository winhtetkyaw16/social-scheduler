"""Database operations and lifecycle rules for scheduled posts."""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.integrations.registry import supported_platform_names
from app.models import ConnectedAccount, ExecutionLog, PublishItem, ScheduledPost
from app.schemas.post import PostCreate, PostUpdate


def _aware(value: datetime) -> bool:
    """Return whether a datetime contains a usable timezone offset."""
    return value.tzinfo is not None and value.utcoffset() is not None


def _attach_execution_summaries(db: Session, posts: list[ScheduledPost]) -> list[ScheduledPost]:
    """Attach the newest execution-log outcome without changing publish status."""
    if not posts:
        return posts
    logs = db.scalars(
        select(ExecutionLog)
        .where(ExecutionLog.scheduled_post_id.in_([post.id for post in posts]))
        .order_by(ExecutionLog.created_at.desc())
    ).all()
    latest: dict[UUID, ExecutionLog] = {}
    for log in logs:
        latest.setdefault(log.scheduled_post_id, log)
    for post in posts:
        log = latest.get(post.id)
        post.latest_execution_outcome = log.outcome if log else None
    return posts


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
    if account.platform not in supported_platform_names():
        allowed = ", ".join(sorted(supported_platform_names()))
        raise HTTPException(
            status_code=422,
            detail=f"Posts cannot be scheduled to {account.platform}. Choose one of: {allowed}",
        )
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
    post.latest_execution_outcome = None
    return post


def list_posts(db: Session, user_id: UUID) -> list[ScheduledPost]:
    """Return owned posts without marking them published ahead of the provider."""
    posts = list(
        db.scalars(
            select(ScheduledPost)
            .where(ScheduledPost.user_id == user_id)
            .order_by(ScheduledPost.created_at.desc(), ScheduledPost.id)
        ).all()
    )

    # Unknown legacy statuses are failed, not published. A due scheduled post
    # stays scheduled until the dispatcher and provider confirm it.
    changed = False
    valid_statuses = {"draft", "scheduled", "queued", "publishing", "published", "failed", "cancelled", "archived"}
    for post in posts:
        if post.status not in valid_statuses:
            post.status = "failed"
            post.last_error_code = post.last_error_code or "invalid_status"
            post.last_error_message = post.last_error_message or "Post status was invalid and was not reported as published."
            changed = True
    if changed:
        db.commit()
    return _attach_execution_summaries(db, posts)


def get_owned_post(db: Session, post_id: UUID, user_id: UUID) -> ScheduledPost:
    """Fetch a post within the user's ownership boundary or return 404."""
    post = db.scalar(select(ScheduledPost).where(ScheduledPost.id == post_id, ScheduledPost.user_id == user_id))
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    _attach_execution_summaries(db, [post])
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
    _attach_execution_summaries(db, [post])
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
    _attach_execution_summaries(db, [post])
    return post


def archive_post(db: Session, post: ScheduledPost) -> ScheduledPost:
    """Mark a completed or failed post archived without removing its history."""
    if post.status not in {"published", "failed", "cancelled"}:
        raise HTTPException(status_code=409, detail="Only completed or failed posts can be archived")
    post.status = "archived"
    db.commit()
    db.refresh(post)
    _attach_execution_summaries(db, [post])
    return post


def _metadata_value(mapping: object, account_id: UUID, default):
    if not isinstance(mapping, dict):
        return default
    key = str(account_id)
    return mapping[key] if key in mapping else default


def _caption_for_account(metadata: dict, account_id: UUID, fallback: str) -> str:
    universal = metadata.get("caption")
    if not isinstance(universal, str):
        universal = fallback or ""
    if metadata.get("captionMode") == "custom":
        use_universal = _metadata_value(metadata.get("useUniversalCaptionByAccount"), account_id, True)
        if use_universal is False:
            custom = _metadata_value(metadata.get("captionsByAccount"), account_id, "")
            if isinstance(custom, str) and custom.strip():
                return custom
    return universal


def _media_for_account(metadata: dict, account_id: UUID, fallback: list[str]) -> list[str]:
    shared = metadata.get("sharedMediaUrls")
    if not isinstance(shared, list):
        shared = list(fallback or [])
    shared = [str(url) for url in shared if url]
    if metadata.get("captionMode") != "custom":
        return shared or [str(url) for url in (fallback or [])]
    custom_raw = _metadata_value(metadata.get("channelMediaUrlsByAccount"), account_id, [])
    custom = [str(url) for url in custom_raw if url] if isinstance(custom_raw, list) else []
    inherit = _metadata_value(metadata.get("useSharedMediaByAccount"), account_id, True)
    chosen = (shared + custom) if inherit is not False else custom
    return chosen or [str(url) for url in (fallback or [])]


def schedule_posts_for_approved_item(db: Session, user_id: UUID, item: PublishItem) -> list[ScheduledPost]:
    """Create one scheduled post per account stored on an approved draft."""
    metadata = dict(item.metadata_json or {})
    raw_ids = metadata.get("selectedIds") or metadata.get("selected_ids") or []
    if not isinstance(raw_ids, list) or not raw_ids:
        raise HTTPException(
            status_code=422,
            detail="This draft has no connected accounts. Open it, select X, LinkedIn, or Instagram, and submit it again.",
        )
    account_ids: list[UUID] = []
    for raw in raw_ids:
        try:
            account_ids.append(UUID(str(raw)))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Draft account selection is invalid") from exc
    accounts = list(
        db.scalars(
            select(ConnectedAccount).where(
                ConnectedAccount.user_id == user_id,
                ConnectedAccount.id.in_(account_ids),
                ConnectedAccount.is_active.is_(True),
            )
        ).all()
    )
    found = {account.id for account in accounts}
    if any(account_id not in found for account_id in account_ids):
        raise HTTPException(
            status_code=422,
            detail="One or more selected accounts are not active. Reconnect them before approving.",
        )
    unsupported = sorted({account.platform for account in accounts if account.platform not in supported_platform_names()})
    if unsupported:
        raise HTTPException(status_code=422, detail=f"Unsupported platform in this draft: {', '.join(unsupported)}")

    now = datetime.now(timezone.utc)
    scheduled_at = item.scheduled_at
    if scheduled_at is not None and scheduled_at.tzinfo is None:
        scheduled_at = scheduled_at.replace(tzinfo=timezone.utc)
    publish_now = metadata.get("scheduleMode") == "now" or scheduled_at is None or scheduled_at <= now
    when = now if publish_now else scheduled_at
    created: list[ScheduledPost] = []
    for account in accounts:
        key = f"approval:{item.id}:{account.id}"
        existing = db.scalar(select(ScheduledPost).where(ScheduledPost.idempotency_key == key))
        if existing is not None:
            created.append(existing)
            continue
        content = _caption_for_account(metadata, account.id, item.content).strip()
        if not content:
            raise HTTPException(status_code=422, detail=f"Add a caption for {account.account_name} before approving.")
        if len(content) > 10000:
            raise HTTPException(status_code=422, detail=f"The caption for {account.account_name} is too long.")
        formats = metadata.get("formatsByAccount") if isinstance(metadata.get("formatsByAccount"), dict) else {}
        settings = metadata.get("platformSettingsByAccount") if isinstance(metadata.get("platformSettingsByAccount"), dict) else {}
        post = ScheduledPost(
            user_id=user_id,
            connected_account_id=account.id,
            content=content,
            media_urls=_media_for_account(metadata, account.id, list(item.media_urls or []))[:10],
            scheduled_at=when,
            status="scheduled",
            idempotency_key=key,
            post_metadata={
                "format": formats.get(str(account.id)) or item.post_format,
                "settings": settings.get(str(account.id)) or {},
                "source": "approval",
                "publish_item_id": str(item.id),
            },
        )
        db.add(post)
        created.append(post)
    db.flush()
    return created
