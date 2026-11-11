"""Inbox, threaded comments, read state, and the capability matrix.

Every query is limited to posts owned by the signed-in user.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import ConnectedAccount, ScheduledPost
from app.models.engagement import PostComment, PostInsightsSnapshot
from app.services.engagement import registry
from app.services.engagement.base import (
    CAPABILITY_HIDE_REPLY,
    CAPABILITY_INSIGHTS,
    CAPABILITY_KEYS,
    EngagementCapabilities,
)
from app.services.engagement.parsing import granted_scopes
from app.services.oauth_scopes import YOUTUBE_ANALYTICS
from app.services.engagement.copy import reconnect_for_comments
from app.services.engagement.tokens import reconnect_message
from app.services.error_messages import network_name

INBOX_STATUSES = ("unread", "unreplied", "replied", "all")


def _count(db: Session, stmt) -> int:
    """Count rows of a select without inheriting its ORDER BY."""
    sub = stmt.order_by(None).subquery()
    return int(db.scalar(select(func.count()).select_from(sub)) or 0)


def _owned_comment_stmt(user_id: UUID):
    return (
        select(PostComment)
        .join(ScheduledPost, ScheduledPost.id == PostComment.post_id)
        .where(ScheduledPost.user_id == user_id)
    )


def get_owned_comment(db: Session, comment_id: UUID, user_id: UUID) -> PostComment | None:
    """The comment when the parent post belongs to ``user_id``, else None."""
    return db.scalar(
        _owned_comment_stmt(user_id).where(PostComment.id == comment_id)
    )


def comments_for_post(db: Session, post_id: UUID) -> list[PostComment]:
    """Every stored comment on a post, oldest first, including deleted ones."""
    return list(
        db.scalars(
            select(PostComment)
            .where(PostComment.post_id == post_id)
            .order_by(
                func.coalesce(PostComment.created_at_provider, PostComment.fetched_at),
                PostComment.id,
            )
        ).all()
    )


def _apply_inbox_filters(
    stmt,
    *,
    network: str | None,
    account_id: UUID | None,
    status: str | None,
    search: str | None,
    include_deleted: bool,
):
    if not include_deleted:
        stmt = stmt.where(PostComment.is_deleted.is_(False))
    if network:
        stmt = stmt.where(func.lower(PostComment.network) == network.strip().lower())
    if account_id is not None:
        stmt = stmt.where(PostComment.social_account_id == account_id)
    if status == "unread":
        stmt = stmt.where(PostComment.is_read.is_(False))
    elif status == "unreplied":
        stmt = stmt.where(
            PostComment.replied.is_(False),
            PostComment.is_own.is_(False),
        )
    elif status == "replied":
        stmt = stmt.where(PostComment.replied.is_(True))
    needle = (search or "").strip().lower()
    if needle:
        pattern = f"%{needle}%"
        stmt = stmt.where(
            or_(
                func.lower(PostComment.text).like(pattern),
                func.lower(func.coalesce(PostComment.author_name, "")).like(pattern),
                func.lower(func.coalesce(PostComment.author_handle, "")).like(pattern),
            )
        )
    return stmt


def inbox_page(
    db: Session,
    user_id: UUID,
    *,
    network: str | None = None,
    account_id: UUID | None = None,
    status: str = "all",
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """Newest comments first, plus unread counts for the same account and network."""
    base = _owned_comment_stmt(user_id)
    filtered = _apply_inbox_filters(
        base,
        network=network,
        account_id=account_id,
        status=status if status in INBOX_STATUSES else "all",
        search=search,
        include_deleted=False,
    )
    order = func.coalesce(PostComment.created_at_provider, PostComment.fetched_at)
    total = _count(db, filtered)
    rows = list(
        db.scalars(
            filtered.order_by(order.desc(), PostComment.id.desc()).limit(limit).offset(offset)
        ).all()
    )
    unread_stmt = _apply_inbox_filters(
        _owned_comment_stmt(user_id),
        network=network,
        account_id=account_id,
        status="unread",
        search=None,
        include_deleted=False,
    )
    unread_count = _count(db, unread_stmt)
    grouped = _apply_inbox_filters(
        select(PostComment.network, func.count(PostComment.id))
        .join(ScheduledPost, ScheduledPost.id == PostComment.post_id)
        .where(ScheduledPost.user_id == user_id),
        network=network,
        account_id=account_id,
        status="unread",
        search=None,
        include_deleted=False,
    ).group_by(PostComment.network)
    by_network_rows = db.execute(grouped).all()
    account_ids = {row.social_account_id for row in rows}
    post_ids = {row.post_id for row in rows}
    accounts = {
        item.id: item
        for item in db.scalars(select(ConnectedAccount).where(ConnectedAccount.id.in_(account_ids))).all()
    } if account_ids else {}
    posts = {
        item.id: item
        for item in db.scalars(select(ScheduledPost).where(ScheduledPost.id.in_(post_ids))).all()
    } if post_ids else {}
    return {
        "items": rows,
        "accounts": accounts,
        "posts": posts,
        "total": int(total),
        "limit": limit,
        "offset": offset,
        "unread_count": int(unread_count),
        "unread_by_network": {name: int(count) for name, count in by_network_rows},
    }


def mark_comment_read(db: Session, comment: PostComment) -> PostComment:
    """Mark one comment read. Already-read comments stay read."""
    comment.is_read = True
    db.commit()
    db.refresh(comment)
    return comment


def mark_comments_read(
    db: Session,
    user_id: UUID,
    *,
    comment_ids: list[UUID] | None = None,
    network: str | None = None,
    account_id: UUID | None = None,
    status: str | None = None,
    search: str | None = None,
    all_matching: bool = False,
) -> tuple[int, list[UUID]]:
    """Mark owned comments read.

    Explicit ids that are not owned are returned as ``missing`` so the API can 404.
    ``all_matching`` uses the inbox filters. With no status, that means unread comments.
    """
    if comment_ids:
        found = list(
            db.scalars(_owned_comment_stmt(user_id).where(PostComment.id.in_(comment_ids))).all()
        )
        found_ids = {row.id for row in found}
        missing = [comment_id for comment_id in comment_ids if comment_id not in found_ids]
        updated = 0
        for row in found:
            if not row.is_read:
                row.is_read = True
                updated += 1
        if not missing:
            db.commit()
        else:
            db.rollback()
        return updated, missing

    if not all_matching:
        return 0, []
    effective_status = status if status in INBOX_STATUSES else "unread"
    stmt = _apply_inbox_filters(
        _owned_comment_stmt(user_id),
        network=network,
        account_id=account_id,
        status=effective_status,
        search=search,
        include_deleted=False,
    )
    rows = list(db.scalars(stmt).all())
    updated = 0
    for row in rows:
        if not row.is_read:
            row.is_read = True
            updated += 1
    db.commit()
    return updated, []


def insights_for_post(db: Session, post_id: UUID, *, limit: int = 200) -> list[PostInsightsSnapshot]:
    """Newest snapshot first."""
    return list(
        db.scalars(
            select(PostInsightsSnapshot)
            .where(PostInsightsSnapshot.post_id == post_id)
            .order_by(PostInsightsSnapshot.captured_at.desc(), PostInsightsSnapshot.id.desc())
            .limit(limit)
        ).all()
    )


def _missing_scopes(caps: EngagementCapabilities, granted: set[str]) -> dict[str, list[str]]:
    missing: dict[str, list[str]] = {}
    for key in CAPABILITY_KEYS:
        required = caps.scopes_for(key)
        missing[key] = [scope for scope in required if scope not in granted]
    return missing


def _supported_flag(caps: EngagementCapabilities, key: str) -> bool:
    if key == "comments_read":
        return caps.supports_comments_read
    if key == "comment_reply":
        return caps.supports_comment_reply
    if key == CAPABILITY_HIDE_REPLY:
        return caps.supports_hide_reply
    return caps.supports_insights


def insights_allowed(caps: EngagementCapabilities, granted: set[str], missing: list[str]) -> bool:
    """True when insights can run, including YouTube's statistics fallback."""
    if not caps.supports_insights:
        return False
    if not missing:
        return True
    if not caps.insights_fallback_scopes:
        return False
    if set(missing) <= {YOUTUBE_ANALYTICS} and any(
        scope in granted for scope in caps.insights_fallback_scopes
    ):
        return True
    return False


def capability_matrix(db: Session, user_id: UUID) -> dict:
    """Per-network support, and per-account flags the UI can hide or warn on."""
    networks = []
    for name in registry.supported_networks():
        provider = registry.get_engagement_provider(name)
        caps = provider.capabilities
        networks.append(
            {
                "network": name,
                "label": network_name(name),
                "supports_comments_read": caps.supports_comments_read,
                "supports_comment_reply": caps.supports_comment_reply,
                "supports_insights": caps.supports_insights,
                "supports_hide_reply": caps.supports_hide_reply,
                "required_scopes": {
                    key: list(caps.scopes_for(key)) for key in CAPABILITY_KEYS
                },
                "reasons": {
                    key: str(caps.reasons.get(key) or "")
                    for key in CAPABILITY_KEYS
                    if caps.reasons.get(key)
                },
                "notes": caps.notes or "",
            }
        )
    accounts = list(
        db.scalars(
            select(ConnectedAccount)
            .where(ConnectedAccount.user_id == user_id)
            .order_by(ConnectedAccount.created_at)
        ).all()
    )
    account_rows = []
    for account in accounts:
        provider = registry.get_engagement_provider(account.platform)
        caps = provider.capabilities
        granted = granted_scopes(account)
        missing = _missing_scopes(caps, granted)
        reconnect_for_permissions = any(
            _supported_flag(caps, key) and bool(missing[key]) for key in CAPABILITY_KEYS
        )
        needs_reconnect = bool(account.needs_reconnect)
        usable = account.is_active and not needs_reconnect

        def can(flag: bool, key: str) -> bool:
            if key == CAPABILITY_INSIGHTS:
                return bool(usable and insights_allowed(caps, granted, missing[key]))
            return bool(flag and usable and not missing[key])

        if needs_reconnect:
            message = reconnect_message(account)
        elif reconnect_for_permissions:
            message = reconnect_for_comments(account.platform)
        else:
            message = None
        account_rows.append(
            {
                "account_id": account.id,
                "network": registry.canonical_network(account.platform),
                "account_name": account.account_name,
                "is_active": bool(account.is_active),
                "needs_reconnect": needs_reconnect,
                "reconnect_reason": account.reconnect_reason,
                "supports_comments_read": caps.supports_comments_read,
                "supports_comment_reply": caps.supports_comment_reply,
                "supports_insights": caps.supports_insights,
                "supports_hide_reply": caps.supports_hide_reply,
                "can_read_comments": can(caps.supports_comments_read, "comments_read"),
                "can_reply": can(caps.supports_comment_reply, "comment_reply"),
                "can_read_insights": can(caps.supports_insights, "insights"),
                "can_hide_reply": can(caps.supports_hide_reply, CAPABILITY_HIDE_REPLY),
                "missing_scopes": missing,
                "reconnect_for_permissions": reconnect_for_permissions,
                "message": message,
            }
        )
    return {"networks": networks, "accounts": account_rows}
