"""Database operations and lifecycle rules for scheduled posts."""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import decrypt_token
from app.integrations.registry import supported_platform_names
from app.models import ConnectedAccount, ExecutionLog, PublishItem, ScheduledPost
from app.schemas.post import PostCreate, PostUpdate
from app.services.error_messages import media_requirement_error
from app.services.post_formats import video_format_message
from app.services.publishing import PublishingError, delete_remote


def _aware(value: datetime) -> bool:
    """Return whether a datetime contains a usable timezone offset."""
    return value.tzinfo is not None and value.utcoffset() is not None


def _attach_execution_summaries(
    db: Session, posts: list[ScheduledPost]
) -> list[ScheduledPost]:
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


def publish_problem(
    platform: str | None,
    media_urls: list | None,
    content: str | None,
    post_format: str | None = None,
) -> str | None:
    """Blocking reason a post can't be scheduled/published (the composer disables posting for the same errors).

    Things the app fixes on its own at publish (Instagram upscale/auto-fit, JPG and other conversions) never block.
    Drafts are never checked. A missing or unsupported format does not fail open into a feed post.
    ``video_format_message`` stays importable from this module; the checks themselves live in post_formats.
    """
    from app.services.post_formats import publish_problem as format_problem

    return format_problem(platform, media_urls, content, post_format)


def _reject(account_name: str | None, problem: str | None) -> None:
    if problem:
        raise HTTPException(
            status_code=422, detail=f"{account_name or 'This channel'}: {problem}"
        )


def ensure_publishable(post: ScheduledPost) -> None:
    """422 when a scheduled/queued post still has a blocking error (used by update and publish-now)."""
    account = post.connected_account
    meta = post.post_metadata if isinstance(post.post_metadata, dict) else {}
    _reject(
        getattr(account, "account_name", None),
        publish_problem(
            getattr(account, "platform", None),
            list(post.media_urls or []),
            post.content,
            meta.get("format"),
        ),
    )


def create_post(db: Session, user_id: UUID, payload: PostCreate) -> ScheduledPost:
    """Create an idempotent schedule for an active account owned by the user."""
    if not _aware(payload.scheduled_at):
        raise HTTPException(
            status_code=422, detail="scheduled_at must include a timezone"
        )
    account = db.scalar(
        select(ConnectedAccount).where(
            ConnectedAccount.id == payload.connected_account_id,
            ConnectedAccount.user_id == user_id,
            ConnectedAccount.is_active.is_(True),
        )
    )
    if account is None:
        raise HTTPException(
            status_code=404, detail="Active connected account not found"
        )
    if account.platform not in supported_platform_names():
        allowed = ", ".join(sorted(supported_platform_names()))
        raise HTTPException(
            status_code=422,
            detail=f"Posts cannot be scheduled to {account.platform}. Choose one of: {allowed}",
        )
    existing = db.scalar(
        select(ScheduledPost).where(
            ScheduledPost.idempotency_key == payload.idempotency_key
        )
    )
    if existing:
        if existing.user_id == user_id:
            return existing
        raise HTTPException(status_code=409, detail="Idempotency key is already in use")
    _reject(
        account.account_name,
        publish_problem(
            account.platform,
            [str(url) for url in payload.media_urls],
            payload.content,
            (payload.post_metadata or {}).get("format"),
        ),
    )
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
    # Also repair rows that already have a provider id but lagged on status
    # (e.g. Graph succeeded while a twin race left status as scheduled).
    changed = False
    valid_statuses = {
        "draft",
        "scheduled",
        "queued",
        "publishing",
        "published",
        "failed",
        "cancelled",
        "archived",
    }
    for post in posts:
        provider_id = (post.provider_post_id or "").strip()
        if provider_id and post.status in {
            "scheduled",
            "queued",
            "publishing",
            "failed",
        }:
            post.status = "published"
            if post.published_at is None:
                post.published_at = datetime.now(timezone.utc)
            post.last_error_code = None
            post.last_error_message = None
            changed = True
            continue
        if post.status not in valid_statuses:
            post.status = "failed"
            post.last_error_code = post.last_error_code or "invalid_status"
            post.last_error_message = (
                post.last_error_message
                or "Post status was invalid and was not reported as published."
            )
            changed = True
    if changed:
        db.commit()
    return _attach_execution_summaries(db, posts)


def get_owned_post(db: Session, post_id: UUID, user_id: UUID) -> ScheduledPost:
    """Fetch a post within the user's ownership boundary or return 404."""
    post = db.scalar(
        select(ScheduledPost).where(
            ScheduledPost.id == post_id, ScheduledPost.user_id == user_id
        )
    )
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    _attach_execution_summaries(db, [post])
    return post


def update_post(db: Session, post: ScheduledPost, payload: PostUpdate) -> ScheduledPost:
    """Validate and apply partial changes to an editable post."""
    was_failed = post.status == "failed" and not (post.provider_post_id or "").strip()
    if post.status not in {"draft", "scheduled"} and not was_failed:
        raise HTTPException(
            status_code=409,
            detail="Only draft, scheduled or failed posts can be edited",
        )
    changes = payload.model_dump(exclude_unset=True)
    if any(value is None for value in changes.values()):
        raise HTTPException(status_code=422, detail="Post fields cannot be set to null")
    if changes.get("scheduled_at") is not None and not _aware(changes["scheduled_at"]):
        raise HTTPException(
            status_code=422, detail="scheduled_at must include a timezone"
        )
    if changes.get("connected_account_id") is not None:
        db_account = db.scalar(
            select(ConnectedAccount).where(
                ConnectedAccount.id == changes["connected_account_id"],
                ConnectedAccount.user_id == post.user_id,
                ConnectedAccount.is_active.is_(True),
            )
        )
        if db_account is None:
            raise HTTPException(
                status_code=404, detail="Active connected account not found"
            )
    if "media_urls" in changes and changes["media_urls"] is not None:
        changes["media_urls"] = [str(url) for url in changes["media_urls"]]
    if "post_metadata" in changes:
        metadata = dict(post.post_metadata or {})
        metadata.update(changes["post_metadata"] or {})
        changes["post_metadata"] = metadata
    for key, value in changes.items():
        setattr(post, key, value)
    if was_failed and changes.get("scheduled_at") is not None:
        # "Save & reschedule": a failed post goes back on the schedule fresh.
        post.status = "scheduled"
        post.attempt_count = 0
        post.last_error_code = None
        post.last_error_message = None
    if post.status != "draft":
        db.flush()
        db.refresh(post, ["connected_account"])
        try:
            ensure_publishable(post)
        except HTTPException:
            db.rollback()
            raise
    db.commit()
    db.refresh(post)
    _attach_execution_summaries(db, [post])
    return post


def delete_post(db: Session, post: ScheduledPost) -> None:
    """Delete an owned post. Remote delete first when the post was published to a network."""
    if post.status == "publishing":
        raise HTTPException(
            status_code=409, detail="A post cannot be deleted while it is publishing"
        )

    provider_post_id = (post.provider_post_id or "").strip()
    # Only attempt remote delete when we have a real provider id (not drafts / never-sent).
    if provider_post_id and not provider_post_id.startswith("inbox:"):
        account = post.connected_account
        if account is None:
            raise HTTPException(
                status_code=409,
                detail="Connected account is missing; cannot delete from the social network. The local post was kept.",
            )
        try:
            access_token = decrypt_token(account.access_token_ciphertext)
        except Exception as exc:
            raise HTTPException(
                status_code=409,
                detail="Could not read the account token. Reconnect the account, then try delete again. The local post was kept.",
            ) from exc
        if not access_token:
            raise HTTPException(
                status_code=409,
                detail="This account has no access token. Reconnect it before deleting from the network. The local post was kept.",
            )
        try:
            delete_remote(account.platform, access_token, provider_post_id)
        except PublishingError as exc:
            # Fail closed: do not remove the local row when remote delete fails.
            status = 502 if exc.status_code and exc.status_code >= 500 else 409
            if exc.code == "remote_delete_unsupported":
                status = 409
            raise HTTPException(status_code=status, detail=str(exc)) from exc

    db.delete(post)
    db.commit()


def retry_post(db: Session, post: ScheduledPost) -> ScheduledPost:
    """Mark a failed post queued; the API dispatches it after the response."""
    if post.status != "failed":
        raise HTTPException(status_code=409, detail="Only failed posts can be retried")
    if not post.connected_account.is_active:
        raise HTTPException(
            status_code=409, detail="Reconnect the connected account before retrying"
        )
    ensure_publishable(
        post
    )  # a failed post with a blocking error must be fixed (Save & reschedule) first

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
        raise HTTPException(
            status_code=409, detail="Only completed or failed posts can be archived"
        )
    post.status = "archived"
    db.commit()
    db.refresh(post)
    _attach_execution_summaries(db, [post])
    return post


def _metadata_value(mapping: object, account_id: UUID, default):
    """Look up account_id in a metadata map. Missing maps and keys return default."""
    if not isinstance(mapping, dict):
        return default
    key = str(account_id)
    return mapping[key] if key in mapping else default


def _caption_for_account(metadata: dict, account_id: UUID, fallback: str) -> str:
    """Per-account caption when custom mode is on and this account opted out of the shared one."""
    universal = metadata.get("caption")
    if not isinstance(universal, str):
        universal = fallback or ""
    if metadata.get("captionMode") == "custom":
        use_universal = _metadata_value(
            metadata.get("useUniversalCaptionByAccount"), account_id, True
        )
        if use_universal is False:
            custom = _metadata_value(metadata.get("captionsByAccount"), account_id, "")
            if isinstance(custom, str) and custom.strip():
                return custom
    return universal


def _media_selection(
    metadata: dict, account_id: UUID, platform: str | None
) -> list[str] | None:
    """Per-channel media picks (composer "Fix for me" / ticks): account first, then network default.

    Values are lists of shared media URLs. Missing keys mean "use the shared media" (old posts).
    """
    by_account = metadata.get("mediaSelectionByAccount")
    picked = (
        _metadata_value(by_account, account_id, None)
        if isinstance(by_account, dict)
        else None
    )
    if not isinstance(picked, list) and platform:
        by_network = metadata.get("mediaSelectionByNetwork")
        picked = (
            by_network.get(platform.lower()) if isinstance(by_network, dict) else None
        )
    return [str(url) for url in picked if url] if isinstance(picked, list) else None


def _ig_crop_for_account(metadata: dict, account_id, media: list[str]) -> dict:
    """Draft ``igCropByAccount`` ({ratio, offsets by URL}) -> post ``ig_crop`` ({ratio, offsets by index})."""
    all_crops = (
        metadata.get("igCropByAccount")
        if isinstance(metadata.get("igCropByAccount"), dict)
        else {}
    )
    crop = (
        all_crops.get(str(account_id))
        if isinstance(all_crops.get(str(account_id)), dict)
        else {}
    )
    out: dict = {}
    if isinstance(crop.get("ratio"), (int, float)) and crop["ratio"]:
        out["ratio"] = float(crop["ratio"])
    offs = crop.get("offsets") if isinstance(crop.get("offsets"), dict) else {}
    picked = [
        offs.get(u) if isinstance(offs.get(u), list) and len(offs.get(u)) == 2 else None
        for u in media
    ]
    if any(picked):
        out["offsets"] = [o or [0.5, 0.5] for o in picked]
    return out


def _media_for_account(
    metadata: dict, account_id: UUID, fallback: list[str], platform: str | None = None
) -> list[str]:
    """Shared URLs filtered by the account's pick, plus custom media in custom caption mode."""
    shared = metadata.get("sharedMediaUrls")
    if not isinstance(shared, list):
        shared = list(fallback or [])
    shared = [str(url) for url in shared if url]
    picked = _media_selection(metadata, account_id, platform)
    if picked is not None:
        wanted = set(picked)
        shared = [url for url in shared if url in wanted]
    if metadata.get("captionMode") != "custom":
        if picked is not None:
            return shared
        return shared or [str(url) for url in (fallback or [])]
    custom_raw = _metadata_value(
        metadata.get("channelMediaUrlsByAccount"), account_id, []
    )
    custom = (
        [str(url) for url in custom_raw if url] if isinstance(custom_raw, list) else []
    )
    inherit = _metadata_value(metadata.get("useSharedMediaByAccount"), account_id, True)
    chosen = (shared + custom) if inherit is not False else custom
    if picked is not None:
        return chosen
    return chosen or [str(url) for url in (fallback or [])]


def _resolve_draft_accounts(
    db: Session, user_id: UUID, item: PublishItem
) -> list[ConnectedAccount]:
    """Resolve active connected accounts stored on a draft publish item."""
    metadata = dict(item.metadata_json or {})
    raw_ids = metadata.get("selectedIds") or metadata.get("selected_ids") or []
    if not isinstance(raw_ids, list) or not raw_ids:
        raise HTTPException(
            status_code=422,
            detail="This draft has no connected accounts. Open it in the composer, select channels, and save again.",
        )
    account_ids: list[UUID] = []
    for raw in raw_ids:
        try:
            account_ids.append(UUID(str(raw)))
        except ValueError as exc:
            raise HTTPException(
                status_code=422, detail="Draft account selection is invalid"
            ) from exc
    accounts = list(
        db.scalars(
            select(ConnectedAccount).where(
                ConnectedAccount.user_id == user_id,
                ConnectedAccount.id.in_(account_ids),
                ConnectedAccount.is_active.is_(True),
            )
        ).all()
    )
    by_id = {account.id: account for account in accounts}
    ordered = [by_id[account_id] for account_id in account_ids if account_id in by_id]
    if len(ordered) != len(account_ids):
        raise HTTPException(
            status_code=422,
            detail="One or more selected accounts are not active. Reconnect them before scheduling.",
        )
    unsupported = sorted(
        {
            account.platform
            for account in ordered
            if account.platform not in supported_platform_names()
        }
    )
    if unsupported:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported platform in this draft: {', '.join(unsupported)}",
        )
    return ordered


def materialize_draft_posts(
    db: Session,
    user_id: UUID,
    item: PublishItem,
    *,
    when_by_account: dict[UUID, datetime] | None = None,
    default_when: datetime | None = None,
    source: str = "draft",
    idempotency_prefix: str | None = None,
) -> list[ScheduledPost]:
    """Create one scheduled post per draft account using shared caption/media metadata."""
    metadata = dict(item.metadata_json or {})
    accounts = _resolve_draft_accounts(db, user_id, item)
    now = datetime.now(timezone.utc)
    prefix = idempotency_prefix or f"{source}:{item.id}"
    created: list[ScheduledPost] = []
    for account in accounts:
        when = None
        if when_by_account and account.id in when_by_account:
            when = when_by_account[account.id]
        elif default_when is not None:
            when = default_when
        if when is None:
            raise HTTPException(
                status_code=422,
                detail=f"Missing schedule time for {account.account_name}",
            )
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        if when <= now and source != "approval":
            # Allow near-now for "post now" style; clamp a few seconds ahead for dispatcher.
            when = now
        key = f"{prefix}:{account.id}"
        existing = db.scalar(
            select(ScheduledPost).where(ScheduledPost.idempotency_key == key)
        )
        if existing is not None:
            created.append(existing)
            continue
        content = _caption_for_account(metadata, account.id, item.content).strip()
        if not content:
            raise HTTPException(
                status_code=422,
                detail=f"Add a caption for {account.account_name} before scheduling.",
            )
        if len(content) > 10000:
            raise HTTPException(
                status_code=422,
                detail=f"The caption for {account.account_name} is too long.",
            )
        from app.services.post_formats import draft_account_format

        settings = (
            metadata.get("platformSettingsByAccount")
            if isinstance(metadata.get("platformSettingsByAccount"), dict)
            else {}
        )
        account_settings = settings.get(str(account.id)) or {}
        account_format, format_error = draft_account_format(
            metadata,
            account.id,
            item.post_format,
            account_count=len(accounts),
        )
        if format_error:
            _reject(account.account_name, format_error)
        post_metadata = {
            "format": account_format,
            "settings": account_settings,
            "source": source,
            "publish_item_id": str(item.id),
        }
        if (
            account.platform == "pinterest"
            and isinstance(account_settings, dict)
            and account_settings.get("destination_url")
        ):
            post_metadata["destination_url"] = account_settings["destination_url"]
        account_media = _media_for_account(
            metadata, account.id, list(item.media_urls or []), account.platform
        )[:35]
        if account.platform == "instagram":
            post_metadata["ig_crop"] = _ig_crop_for_account(
                metadata, account.id, account_media
            )
        _reject(
            account.account_name,
            publish_problem(
                account.platform, account_media, content, post_metadata.get("format")
            ),
        )
        post = ScheduledPost(
            user_id=user_id,
            connected_account_id=account.id,
            content=content,
            media_urls=account_media,
            scheduled_at=when,
            status="scheduled",
            idempotency_key=key,
            post_metadata=post_metadata,
        )
        db.add(post)
        created.append(post)
    db.flush()
    return created


def schedule_posts_for_approved_item(
    db: Session, user_id: UUID, item: PublishItem
) -> list[ScheduledPost]:
    """Create one scheduled post per account stored on an approved draft."""
    metadata = dict(item.metadata_json or {})
    now = datetime.now(timezone.utc)
    scheduled_at = item.scheduled_at
    if scheduled_at is not None and scheduled_at.tzinfo is None:
        scheduled_at = scheduled_at.replace(tzinfo=timezone.utc)
    publish_now = (
        metadata.get("scheduleMode") == "now"
        or scheduled_at is None
        or scheduled_at <= now
    )
    when = now if publish_now else scheduled_at
    return materialize_draft_posts(
        db,
        user_id,
        item,
        default_when=when,
        source="approval",
        idempotency_prefix=f"approval:{item.id}",
    )


def schedule_draft_at(
    db: Session,
    user_id: UUID,
    item: PublishItem,
    scheduled_at: datetime,
) -> list[ScheduledPost]:
    """Turn a saved draft into scheduled posts at one exact time."""
    if item.status not in {"draft", "changes_requested"}:
        raise HTTPException(status_code=409, detail="Only drafts can be scheduled")
    if scheduled_at.tzinfo is None:
        raise HTTPException(
            status_code=422, detail="scheduled_at must include a timezone"
        )
    now = datetime.now(timezone.utc)
    if scheduled_at <= now:
        raise HTTPException(
            status_code=422, detail="Choose a future time to schedule this draft"
        )
    posts = materialize_draft_posts(
        db,
        user_id,
        item,
        default_when=scheduled_at,
        source="draft_schedule",
        idempotency_prefix=f"draft-schedule:{item.id}",
    )
    item.scheduled_at = scheduled_at
    item.status = "scheduled"
    meta = dict(item.metadata_json or {})
    meta["scheduleMode"] = "schedule"
    item.metadata_json = meta
    db.commit()
    for post in posts:
        db.refresh(post)
    return _attach_execution_summaries(db, posts)


def queue_draft(
    db: Session,
    user_id: UUID,
    item: PublishItem,
    timezone_fallback: str = "UTC",
) -> list[ScheduledPost]:
    """Place a draft into the next free queue slot for each selected account."""
    if item.status not in {"draft", "changes_requested"}:
        raise HTTPException(
            status_code=409, detail="Only drafts can be added to the queue"
        )
    from app.services import queue_slots as queue_slot_service

    accounts = _resolve_draft_accounts(db, user_id, item)
    allocation = queue_slot_service.allocate_slots(
        db,
        user_id,
        [account.id for account in accounts],
        timezone_fallback=timezone_fallback or "UTC",
    )
    when_by_account = {
        row.connected_account_id: row.scheduled_at for row in allocation.allocations
    }
    posts = materialize_draft_posts(
        db,
        user_id,
        item,
        when_by_account=when_by_account,
        source="draft_queue",
        idempotency_prefix=f"draft-queue:{item.id}",
    )
    # Store the earliest slot on the item for list display.
    times = [row.scheduled_at for row in allocation.allocations]
    item.scheduled_at = min(times) if times else item.scheduled_at
    item.status = "scheduled"
    meta = dict(item.metadata_json or {})
    meta["scheduleMode"] = "queue"
    item.metadata_json = meta
    db.commit()
    for post in posts:
        db.refresh(post)
    return _attach_execution_summaries(db, posts)
