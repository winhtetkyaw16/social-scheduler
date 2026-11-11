"""Evergreen posts: re-share published posts when a channel's queue runs empty.

Settings live on the original post's metadata (``post_metadata["evergreen"]``)::

    {"enabled": true, "interval_days": 30}

A re-share is a new scheduled post (a copy) with ``post_metadata["evergreen_source_id"]``
pointing at the original. The original is never re-published in place, so its history
and provider id stay intact.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import ConnectedAccount, ScheduledPost

logger = logging.getLogger(__name__)

DEFAULT_INTERVAL_DAYS = 30
MIN_INTERVAL_DAYS = 1
MAX_INTERVAL_DAYS = 365
# Only fill a free slot that starts within this window, so evergreen posts never
# claim far-future slots that the user may still fill by hand.
LOOKAHEAD = timedelta(hours=24)
PENDING_STATUSES = ("scheduled", "queued", "publishing")
ENGAGEMENT_KEYS = (
    "likes",
    "comments",
    "shares",
    "reposts",
    "saves",
    "clicks",
    "reactions",
)


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def settings_for(post: ScheduledPost) -> dict[str, Any]:
    """{"enabled": bool, "interval_days": int} for a post (defaults when unset)."""
    meta = post.post_metadata if isinstance(post.post_metadata, dict) else {}
    raw = meta.get("evergreen") if isinstance(meta.get("evergreen"), dict) else {}
    try:
        interval = int(raw.get("interval_days") or DEFAULT_INTERVAL_DAYS)
    except (TypeError, ValueError):
        interval = DEFAULT_INTERVAL_DAYS
    interval = max(MIN_INTERVAL_DAYS, min(MAX_INTERVAL_DAYS, interval))
    tz_name = raw.get("timezone") if isinstance(raw.get("timezone"), str) else ""
    return {
        "enabled": bool(raw.get("enabled")),
        "interval_days": interval,
        "timezone": tz_name or "UTC",
    }


def source_id_of(post: ScheduledPost) -> str | None:
    meta = post.post_metadata if isinstance(post.post_metadata, dict) else {}
    value = meta.get("evergreen_source_id")
    return str(value) if value else None


def engagement_score(post: ScheduledPost) -> float | None:
    """Engagement total stored on the post, or None when no engagement data exists.

    Reads ``post_metadata["engagement"]`` (a number) or ``post_metadata["metrics"]``
    (a dict of counts such as likes/comments/shares). Nothing in the app writes these
    yet; the hook is here so ranking uses real numbers as soon as they are stored.
    """
    meta = post.post_metadata if isinstance(post.post_metadata, dict) else {}
    value = meta.get("engagement")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    metrics = meta.get("metrics")
    if isinstance(metrics, dict):
        numbers = [
            float(metrics[key])
            for key in ENGAGEMENT_KEYS
            if isinstance(metrics.get(key), (int, float))
            and not isinstance(metrics.get(key), bool)
        ]
        if numbers:
            return sum(numbers)
    return None


def update_settings(
    db: Session,
    post: ScheduledPost,
    enabled: bool,
    interval_days: int,
    timezone_name: str = "UTC",
) -> ScheduledPost:
    """Turn evergreen on or off for one of the user's posts."""
    if source_id_of(post):
        raise HTTPException(
            status_code=409,
            detail="This is a re-share of another post. Change the original post instead.",
        )
    if post.status in {"archived", "cancelled", "draft"}:
        raise HTTPException(
            status_code=409,
            detail="Only scheduled or published posts can be re-shared.",
        )
    if not MIN_INTERVAL_DAYS <= int(interval_days) <= MAX_INTERVAL_DAYS:
        raise HTTPException(
            status_code=422,
            detail=f"Choose between {MIN_INTERVAL_DAYS} and {MAX_INTERVAL_DAYS} days.",
        )
    meta = dict(post.post_metadata or {})
    # The timezone is only used for the suggested times when no queue slots are saved.
    meta["evergreen"] = {
        "enabled": bool(enabled),
        "interval_days": int(interval_days),
        "timezone": (timezone_name or "UTC")[:64],
    }
    post.post_metadata = meta
    db.commit()
    db.refresh(post)
    return post


def _copies_by_source(
    db: Session, user_id: UUID | None = None
) -> dict[str, list[ScheduledPost]]:
    stmt = select(ScheduledPost)
    if user_id is not None:
        stmt = stmt.where(ScheduledPost.user_id == user_id)
    out: dict[str, list[ScheduledPost]] = {}
    for post in db.scalars(stmt).all():
        source = source_id_of(post)
        if source:
            out.setdefault(source, []).append(post)
    return out


def last_published_at(
    post: ScheduledPost, copies: list[ScheduledPost]
) -> datetime | None:
    """Latest time the post or any of its re-shares went out."""
    times = [
        _aware(item.published_at)
        for item in [post, *copies]
        if item.status == "published" and item.published_at is not None
    ]
    return max(times) if times else None


def describe(db: Session, user_id: UUID) -> list[dict[str, Any]]:
    """Published originals the user can make evergreen, newest first, with their state."""
    copies = _copies_by_source(db, user_id)
    posts = db.scalars(
        select(ScheduledPost)
        .where(
            ScheduledPost.user_id == user_id,
            ScheduledPost.status.in_(["published", "scheduled", "queued"]),
        )
        .order_by(ScheduledPost.created_at.desc())
    ).all()
    rows: list[dict[str, Any]] = []
    for post in posts:
        if source_id_of(post):
            continue
        settings = settings_for(post)
        own = copies.get(str(post.id), [])
        last = last_published_at(post, own)
        pending = next(
            (
                _aware(copy.scheduled_at)
                for copy in own
                if copy.status in PENDING_STATUSES
            ),
            None,
        )
        if post.status != "published" and not settings["enabled"]:
            continue
        rows.append(
            {
                "post_id": post.id,
                "connected_account_id": post.connected_account_id,
                "content": post.content,
                "media_urls": list(post.media_urls or []),
                "status": post.status,
                "enabled": settings["enabled"],
                "interval_days": settings["interval_days"],
                "last_published_at": last,
                "next_eligible_at": (
                    last + timedelta(days=settings["interval_days"]) if last else None
                ),
                "reshare_scheduled_at": pending,
                "times_reshared": sum(1 for copy in own if copy.status == "published"),
            }
        )
    return rows


def pick_best(candidates: list[tuple[ScheduledPost, datetime]]) -> ScheduledPost | None:
    """Choose which eligible post to re-share.

    ``candidates`` are (post, last_published_at) pairs that are already past their
    interval. The rule:

    1. If any candidate has engagement data (see ``engagement_score``), pick the one
       with the highest engagement. Candidates without data count as 0. Ties go to the
       post that was last published longest ago.
    2. Otherwise pick the post whose last publish is the oldest, so every evergreen post
       gets its turn before any repeats.

    Remaining ties are broken by post id so the choice is stable across processes.
    """
    if not candidates:
        return None
    scores = {post.id: engagement_score(post) for post, _ in candidates}
    if any(score is not None for score in scores.values()):
        ranked = sorted(
            candidates,
            key=lambda pair: (-(scores[pair[0].id] or 0.0), pair[1], str(pair[0].id)),
        )
    else:
        ranked = sorted(candidates, key=lambda pair: (pair[1], str(pair[0].id)))
    return ranked[0][0]


def requeue_evergreen_once(
    db: Session, now: datetime | None = None
) -> list[ScheduledPost]:
    """Fill empty queue slots with evergreen re-shares. Returns the posts created.

    For each active channel that has evergreen posts:

    - Skip it if a re-share for that channel is already waiting (one at a time).
    - Find the channel's next free queue slot. Skip unless it starts within 24 hours,
      so slots the user may still fill stay free.
    - From the channel's evergreen posts that are past their interval and have no
      re-share waiting, pick one with ``pick_best`` and schedule a copy in that slot.

    Never double-posts: each copy's idempotency key is
    ``evergreen:<post>:<time it last went out>`` (unique in the database), so two
    schedulers running at once cannot create the same re-share twice, and publishing
    still goes through the worker's atomic claim.
    """
    from app.services import queue_slots as queue_slot_service
    from app.services.posts import publish_problem

    now = _aware(now) or datetime.now(timezone.utc)
    originals = [
        post
        for post in db.scalars(
            select(ScheduledPost).where(ScheduledPost.status == "published")
        ).all()
        if not source_id_of(post) and settings_for(post)["enabled"]
    ]
    if not originals:
        return []
    copies = _copies_by_source(db)
    by_account: dict[UUID, list[ScheduledPost]] = {}
    for post in originals:
        by_account.setdefault(post.connected_account_id, []).append(post)

    created: list[ScheduledPost] = []
    for account_id, posts in by_account.items():
        account = db.get(ConnectedAccount, account_id)
        if account is None or not account.is_active:
            continue
        waiting = any(
            copy.status in PENDING_STATUSES and copy.connected_account_id == account_id
            for post in posts
            for copy in copies.get(str(post.id), [])
        )
        if waiting:
            continue
        try:
            slot = queue_slot_service.next_slot_for_account(
                db,
                account.user_id,
                account,
                timezone_fallback=settings_for(posts[0])["timezone"],
            )
        except HTTPException:
            continue
        slot_at = _aware(slot.scheduled_at)
        if slot_at - now > LOOKAHEAD:
            continue
        candidates: list[tuple[ScheduledPost, datetime]] = []
        for post in posts:
            own = copies.get(str(post.id), [])
            last = last_published_at(post, own)
            if last is None:
                continue
            # A re-share that failed since the last publish waits for the user (Retry or
            # delete it) instead of being tried again in every free slot.
            if any(
                copy.status == "failed" and (_aware(copy.scheduled_at) or now) >= last
                for copy in own
            ):
                continue
            if last + timedelta(days=settings_for(post)["interval_days"]) > slot_at:
                continue
            meta = post.post_metadata if isinstance(post.post_metadata, dict) else {}
            if publish_problem(
                account.platform,
                list(post.media_urls or []),
                post.content,
                meta.get("format"),
            ):
                continue
            candidates.append((post, last))
        best = pick_best(candidates)
        if best is None:
            continue
        best_last = next(last for post, last in candidates if post.id == best.id)
        # One re-share per publish of the post: the key names the post and the time it
        # last went out, so a second scheduler racing this one hits the unique key.
        key = f"evergreen:{best.id}:{best_last.astimezone(timezone.utc):%Y%m%dT%H%M%S}"
        if db.scalar(
            select(ScheduledPost.id).where(ScheduledPost.idempotency_key == key)
        ):
            continue
        meta = dict(best.post_metadata or {})
        meta.pop("evergreen", None)
        for stale in ("engagement", "metrics", "publish_item_id"):
            meta.pop(stale, None)
        meta["evergreen_source_id"] = str(best.id)
        meta["source"] = "evergreen"
        copy = ScheduledPost(
            user_id=best.user_id,
            connected_account_id=account_id,
            content=best.content,
            media_urls=list(best.media_urls or []),
            scheduled_at=slot_at,
            status="scheduled",
            idempotency_key=key,
            post_metadata=meta,
        )
        db.add(copy)
        try:
            db.commit()
        except IntegrityError:
            # Another scheduler created this exact re-share first.
            db.rollback()
            continue
        logger.info("Evergreen re-share of %s scheduled for %s", best.id, slot_at)
        created.append(copy)
    return created
