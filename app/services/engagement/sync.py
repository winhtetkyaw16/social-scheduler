"""Store comments and insight snapshots, and sync published posts.

Upserts are keyed by account, network, and provider comment id. A second fetch
updates the same row and does not clear ``is_read`` or ``replied``. Insight
snapshots from the periodic sweep are stored at most once per post per hour.
A manual sync can force a new snapshot.
"""

from __future__ import annotations

import logging
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import ConnectedAccount, ScheduledPost
from app.models.engagement import PostComment, PostInsightsSnapshot
from app.services.engagement import registry
from app.services.engagement.base import (
    AccountUnavailable,
    NotSupported,
    ProviderComment,
    ProviderInsights,
    ProviderReply,
    ReconnectRequired,
)
from app.services.engagement.tokens import prepare_account

logger = logging.getLogger(__name__)

# Periodic sweep only. Manual refresh passes force_insights=True.
INSIGHTS_MIN_INTERVAL = timedelta(hours=1)


def lookback_days() -> int:
    """How many days of published posts the sweep visits. Invalid values use 30."""
    raw = os.getenv("ENGAGEMENT_SYNC_LOOKBACK_DAYS", "30")
    try:
        return max(1, int(raw))
    except ValueError:
        return 30


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def upsert_comments(
    db: Session,
    post: ScheduledPost,
    account: ConnectedAccount,
    comments: list[ProviderComment],
) -> int:
    """Insert or update comments for one post. Returns how many rows were touched."""
    network = registry.canonical_network(getattr(account, "platform", None)) or (
        post_network(post, account)
    )
    incoming: list[ProviderComment] = []
    seen: set[str] = set()
    for item in reversed(comments or []):
        provider_id = (item.provider_comment_id or "").strip()
        if not provider_id or provider_id in seen:
            continue
        seen.add(provider_id)
        incoming.append(item)
    incoming.reverse()
    if not incoming:
        return 0

    provider_ids = [item.provider_comment_id.strip() for item in incoming]
    existing = {
        row.provider_comment_id: row
        for row in db.scalars(
            select(PostComment).where(
                PostComment.social_account_id == account.id,
                PostComment.network == network,
                PostComment.provider_comment_id.in_(provider_ids),
            )
        ).all()
    }
    now = datetime.now(timezone.utc)
    provider_post_id = (post.provider_post_id or "").strip()
    touched: list[PostComment] = []
    for item in incoming:
        provider_id = item.provider_comment_id.strip()
        row = existing.get(provider_id)
        if row is None:
            row = PostComment(
                post_id=post.id,
                social_account_id=account.id,
                network=network,
                provider_comment_id=provider_id,
                provider_post_id=provider_post_id,
                text=item.text or "",
                is_read=False,
                replied=False,
                is_own=bool(item.is_own),
                raw=dict(item.raw or {}),
            )
            db.add(row)
            existing[provider_id] = row
        row.post_id = post.id
        row.provider_post_id = provider_post_id or row.provider_post_id
        row.text = item.text or ""
        row.author_name = item.author_name
        row.author_handle = item.author_handle
        row.author_avatar_url = item.author_avatar_url
        row.author_provider_id = item.author_provider_id
        if item.created_at_provider is not None:
            row.created_at_provider = _utc(item.created_at_provider)
        row.fetched_at = now
        row.provider_parent_id = (item.provider_parent_id or None) or None
        row.provider_thread_root_id = (item.provider_thread_root_id or None) or None
        row.is_own = bool(item.is_own) or bool(row.is_own)
        row.is_hidden = bool(item.hidden)
        row.is_deleted = bool(item.deleted)
        row.raw = dict(item.raw or {})
        touched.append(row)
    db.flush()
    _link_threads(db, account.id, network, touched)
    db.flush()
    return len(touched)


def _link_threads(
    db: Session, account_id: UUID, network: str, rows: list[PostComment]
) -> None:
    """Point parent and thread-root foreign keys at rows we already stored."""
    needed: set[str] = set()
    for row in rows:
        if row.provider_parent_id:
            needed.add(row.provider_parent_id)
        if row.provider_thread_root_id:
            needed.add(row.provider_thread_root_id)
    if not needed:
        return
    known = {
        item.provider_comment_id: item
        for item in db.scalars(
            select(PostComment).where(
                PostComment.social_account_id == account_id,
                PostComment.network == network,
                PostComment.provider_comment_id.in_(needed),
            )
        ).all()
    }
    for row in rows:
        parent = known.get(row.provider_parent_id or "")
        if parent is not None and parent.id != row.id:
            row.parent_comment_id = parent.id
        root = known.get(row.provider_thread_root_id or "")
        if root is not None and root.id != row.id:
            row.thread_root_id = root.thread_root_id or root.id
        elif parent is not None and parent.id != row.id:
            row.thread_root_id = parent.thread_root_id or parent.id


def post_network(post: ScheduledPost, account: ConnectedAccount | None) -> str:
    platform = getattr(account, "platform", None) or ""
    return registry.canonical_network(platform)


def insights_due(db: Session, post_id: UUID, now: datetime | None = None) -> bool:
    """True when the post has no snapshot, or the newest one is at least an hour old."""
    latest = db.scalar(
        select(PostInsightsSnapshot)
        .where(PostInsightsSnapshot.post_id == post_id)
        .order_by(PostInsightsSnapshot.captured_at.desc())
        .limit(1)
    )
    if latest is None:
        return True
    captured = _utc(latest.captured_at)
    if captured is None:
        return True
    current = now or datetime.now(timezone.utc)
    return current - captured >= INSIGHTS_MIN_INTERVAL


def store_insights(
    db: Session,
    post: ScheduledPost,
    account: ConnectedAccount,
    payload: ProviderInsights,
    *,
    captured_at: datetime | None = None,
) -> PostInsightsSnapshot:
    """Append one snapshot. Callers decide whether the hourly throttle allows it."""
    snapshot = PostInsightsSnapshot(
        post_id=post.id,
        social_account_id=account.id,
        network=post_network(post, account),
        captured_at=captured_at or datetime.now(timezone.utc),
        impressions=payload.impressions,
        reach=payload.reach,
        likes=payload.likes,
        comments=payload.comments,
        shares=payload.shares,
        saves=payload.saves,
        clicks=payload.clicks,
        video_views=payload.video_views,
        engagement_rate=payload.engagement_rate,
        raw=dict(payload.raw or {}),
    )
    db.add(snapshot)
    db.flush()
    return snapshot


def posts_in_lookback(
    db: Session,
    now: datetime | None = None,
    *,
    user_id: UUID | None = None,
) -> list[ScheduledPost]:
    """Published posts that have a provider id and fall inside the lookback window."""
    current = now or datetime.now(timezone.utc)
    cutoff = current - timedelta(days=lookback_days())
    activity = func.coalesce(ScheduledPost.published_at, ScheduledPost.updated_at)
    stmt = select(ScheduledPost).where(
        ScheduledPost.status == "published",
        ScheduledPost.provider_post_id.is_not(None),
        ScheduledPost.provider_post_id != "",
        activity >= cutoff,
    )
    if user_id is not None:
        stmt = stmt.where(ScheduledPost.user_id == user_id)
    return list(db.scalars(stmt).all())


def _latest_comment_time(db: Session, post_id: UUID) -> datetime | None:
    value = db.scalar(
        select(func.max(PostComment.created_at_provider)).where(PostComment.post_id == post_id)
    )
    return _utc(value)


def _sync_one_post(
    db: Session,
    account: ConnectedAccount,
    post: ScheduledPost,
    *,
    force_insights: bool,
) -> dict[str, int | bool | list[str]]:
    provider = registry.get_engagement_provider(account.platform)
    caps = provider.capabilities
    skipped: list[str] = []
    comments_upserted = 0
    insights_captured = False
    if caps.supports_comments_read:
        try:
            batch = provider.fetch_comments(account, post, _latest_comment_time(db, post.id))
        except NotSupported:
            skipped.append("comments_read")
        else:
            comments_upserted = upsert_comments(db, post, account, list(batch or []))
    else:
        skipped.append("comments_read")
    if caps.supports_insights and (force_insights or insights_due(db, post.id)):
        try:
            payload = provider.fetch_insights(account, post)
        except NotSupported:
            skipped.append("insights")
        else:
            if payload is not None:
                store_insights(db, post, account, payload)
                insights_captured = True
    elif not caps.supports_insights:
        skipped.append("insights")
    return {
        "comments_upserted": comments_upserted,
        "insights_captured": insights_captured,
        "skipped": skipped,
    }


def sync_posts(
    db: Session,
    posts: list[ScheduledPost],
    *,
    force_insights: bool = False,
) -> dict:
    """Sync the given posts. One account's failure does not stop the others.

    ``ReconnectRequired`` is counted as a skip. Any other exception is counted
    as an error, logged with the account id and network, and the sweep continues.
    """
    summary = {
        "posts_seen": len(posts),
        "posts_synced": 0,
        "comments_upserted": 0,
        "insights_captured": 0,
        "skipped": 0,
        "reconnects": 0,
        "errors": 0,
    }
    grouped: dict[UUID, list[ScheduledPost]] = defaultdict(list)
    for post in posts:
        grouped[post.connected_account_id].append(post)
    for account_id, account_posts in grouped.items():
        account = db.get(ConnectedAccount, account_id)
        try:
            prepare_account(db, account)
        except ReconnectRequired:
            summary["reconnects"] += 1
            summary["skipped"] += len(account_posts)
            logger.info(
                "Engagement sync skipped account=%s network=%s outcome=reconnect",
                account_id,
                getattr(account, "platform", ""),
            )
            continue
        except AccountUnavailable:
            summary["errors"] += len(account_posts)
            logger.info(
                "Engagement sync skipped account=%s outcome=inactive",
                account_id,
            )
            continue
        except Exception:
            db.rollback()
            summary["errors"] += len(account_posts)
            logger.exception(
                "Engagement sync failed account=%s network=%s outcome=error",
                account_id,
                getattr(account, "platform", ""),
            )
            continue
        for post in account_posts:
            try:
                result = _sync_one_post(db, account, post, force_insights=force_insights)
                db.commit()
            except ReconnectRequired:
                db.rollback()
                summary["reconnects"] += 1
                summary["skipped"] += 1
                logger.info(
                    "Engagement sync skipped post=%s account=%s outcome=reconnect",
                    post.id,
                    account_id,
                )
                continue
            except Exception:
                db.rollback()
                summary["errors"] += 1
                logger.exception(
                    "Engagement sync failed post=%s account=%s network=%s outcome=error",
                    post.id,
                    account_id,
                    getattr(account, "platform", ""),
                )
                continue
            summary["posts_synced"] += 1
            summary["comments_upserted"] += int(result["comments_upserted"])
            if result["insights_captured"]:
                summary["insights_captured"] += 1
            if result["skipped"] == ["comments_read", "insights"] or (
                not result["comments_upserted"] and not result["insights_captured"] and result["skipped"]
            ):
                # Unsupported capabilities are a skip, not a failure.
                if set(result["skipped"]) >= {"comments_read", "insights"}:
                    summary["skipped"] += 1
    return summary


def run_engagement_sweep(db: Session, now: datetime | None = None) -> dict:
    """Sync every published post inside the lookback window."""
    posts = posts_in_lookback(db, now)
    summary = sync_posts(db, posts, force_insights=False)
    logger.info(
        "Engagement sync posts_seen=%s posts_synced=%s comments=%s insights=%s "
        "skipped=%s reconnects=%s errors=%s",
        summary["posts_seen"],
        summary["posts_synced"],
        summary["comments_upserted"],
        summary["insights_captured"],
        summary["skipped"],
        summary["reconnects"],
        summary["errors"],
    )
    return summary


def sync_one_post(db: Session, post: ScheduledPost) -> dict:
    """Manual refresh for one post. Raises ``ReconnectRequired`` for the API to map to 409.

    The hourly insight throttle does not apply here, so the user gets a new snapshot
    when the network supports insights.
    """
    account = db.get(ConnectedAccount, post.connected_account_id)
    prepare_account(db, account)
    try:
        result = _sync_one_post(db, account, post, force_insights=True)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {
        "post_id": post.id,
        "comments_upserted": int(result["comments_upserted"]),
        "insights_captured": bool(result["insights_captured"]),
        "skipped": list(result["skipped"]),
    }


def store_own_reply(
    db: Session,
    parent: PostComment,
    account: ConnectedAccount,
    post: ScheduledPost,
    text: str,
    reply: ProviderReply,
) -> PostComment:
    """Mark the parent replied and store our reply as its child. Safe to call twice."""
    now = datetime.now(timezone.utc)
    provider_id = (reply.provider_comment_id or "").strip()
    if not provider_id:
        raise RuntimeError("The network did not return a reply id")
    parent.replied = True
    parent.replied_at = now
    parent.reply_provider_id = provider_id
    parent.is_read = True
    payload = ProviderComment(
        provider_comment_id=provider_id,
        text=text,
        author_name=account.account_name,
        author_provider_id=account.platform_account_id,
        created_at_provider=now,
        provider_parent_id=parent.provider_comment_id,
        is_own=True,
        raw=dict(reply.raw or {}),
    )
    upsert_comments(db, post, account, [payload])
    child = db.scalar(
        select(PostComment).where(
            PostComment.social_account_id == account.id,
            PostComment.network == parent.network,
            PostComment.provider_comment_id == provider_id,
        )
    )
    if child is None:
        raise RuntimeError("Reply was not stored")
    child.parent_comment_id = parent.id
    child.thread_root_id = parent.thread_root_id or parent.id
    child.is_own = True
    child.is_read = True
    child.provider_parent_id = parent.provider_comment_id
    db.commit()
    db.refresh(child)
    db.refresh(parent)
    return child
