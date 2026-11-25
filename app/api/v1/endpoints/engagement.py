"""Authenticated comments, inbox, insights, and capability routes."""

import logging
from contextlib import contextmanager
from math import ceil, isfinite
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.integrations.base import ProviderHTTPError
from app.models import User
from app.models.engagement import PostComment
from app.schemas.engagement import (
    CapabilityMatrix,
    CommentHideRequest,
    CommentRead,
    CommentReplyRequest,
    CommentReplyResult,
    CommentThread,
    InboxComment,
    InboxPage,
    InboxPost,
    InboxPostsPage,
    InboxStatus,
    MarkReadRequest,
    MarkReadResult,
    PostInsights,
    SyncPostResult,
)
from app.services.engagement import registry
from app.services.engagement.base import (
    AccountUnavailable,
    CreditsRequired,
    EngagementRetryableError,
    NotSupported,
    ProviderAuthError,
    ReconnectRequired,
    RemotePostDeleted,
)
from app.services.engagement.copy import (
    comments_unavailable,
    hide_unavailable,
    insights_unavailable,
    reconnect_for_comments,
)
from app.services.engagement.http import auth_message
from app.services.engagement.inbox import (
    capability_matrix,
    comments_for_post,
    get_owned_comment,
    inbox_page,
    inbox_posts_page,
    insights_for_post,
    mark_comment_read,
    mark_comment_unread,
    mark_comments_read,
)
from app.services.engagement.sync import store_own_reply, sync_one_post
from app.services.engagement.tokens import prepare_account
from app.services.posts import get_owned_post

router = APIRouter()
logger = logging.getLogger(__name__)


def _unsupported(provider, capability: str) -> HTTPException:
    reason = (provider.capabilities.reasons or {}).get(capability)
    if reason:
        detail = reason
    elif capability == "insights":
        detail = insights_unavailable(provider.network)
    elif capability == "hide_reply":
        detail = hide_unavailable(provider.network)
    else:
        detail = comments_unavailable(provider.network)
    return HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=detail)


def _remember_auth_failure(db: Session, account, exc: ReconnectRequired) -> None:
    """Persist needs_reconnect when the network rejected the token or a permission."""
    if not isinstance(exc, ProviderAuthError) or account is None:
        return
    if account.platform == "facebook" and exc.kind == "permission":
        return
    from app.services.token_refresh import mark_needs_reconnect

    mark_needs_reconnect(db, account, auth_message(account, exc.kind))


@contextmanager
def _comment_action_errors(db, account, provider, comment, capability, fallback):
    try:
        yield
    except NotSupported:
        if capability == "delete_comment":
            raise HTTPException(501, "Comment deletion is unavailable on this network.") from None
        raise _unsupported(provider, capability) from None
    except (CreditsRequired, HTTPException):
        raise
    except ProviderAuthError as exc:
        if exc.kind == "permission":
            raise HTTPException(403, "The network did not grant permission for this action.") from None
        _remember_auth_failure(db, account, exc)
        raise HTTPException(409, auth_message(account, exc.kind)) from None
    except (ReconnectRequired, AccountUnavailable) as exc:
        raise HTTPException(409, str(exc)) from None
    except EngagementRetryableError as exc:
        if exc.category == "rate_limit":
            delay = exc.retry_after_seconds
            if delay is not None and isfinite(delay) and delay > 0:
                seconds = ceil(delay)
                raise HTTPException(429, f"The network is busy. Try again in {seconds} seconds.",
                                    headers={"Retry-After": str(seconds)}) from None
            raise HTTPException(429, "The network is limiting requests. Try again later.") from None
        raise HTTPException(502, fallback) from None
    except ProviderHTTPError as exc:
        if exc.status_code in (404, 410):
            raise HTTPException(409, "The network could not find this comment. Refresh the post.") from None
        if exc.status_code == 403:
            raise HTTPException(403, "The network did not grant permission for this action.") from None
        raise HTTPException(502, fallback) from None
    except Exception:
        logger.exception("Comment action failed action=%s comment=%s network=%s",
                         capability, comment.id, provider.network)
        raise HTTPException(502, fallback) from None


def _comment_read(row: PostComment, replies: list[CommentRead] | None = None) -> CommentRead:
    item = CommentRead.model_validate(row)
    item.replies = list(replies or [])
    return item


def _thread(rows: list[PostComment]) -> list[CommentRead]:
    nodes = {row.id: _comment_read(row) for row in rows}
    roots: list[CommentRead] = []
    for row in rows:
        node = nodes[row.id]
        parent = nodes.get(row.parent_comment_id) if row.parent_comment_id else None
        if parent is None or parent.id == node.id:
            roots.append(node)
        else:
            parent.replies.append(node)

    def sort_key(item: CommentRead):
        return item.created_at_provider or item.fetched_at

    def sort_tree(items: list[CommentRead]) -> None:
        items.sort(key=sort_key)
        for item in items:
            sort_tree(item.replies)

    sort_tree(roots)
    return roots


@router.get("/inbox", response_model=InboxPage)
def get_inbox(
    network: str | None = None,
    account_id: UUID | None = None,
    status_filter: InboxStatus = Query(default="all", alias="status"),
    search: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InboxPage:
    """Comments on the signed-in user's posts, newest first."""
    page = inbox_page(
        db,
        user.id,
        network=network,
        account_id=account_id,
        status=status_filter,
        search=search,
        limit=limit,
        offset=offset,
    )
    items: list[InboxComment] = []
    for row in page["items"]:
        base = CommentRead.model_validate(row).model_dump()
        base["replied"] = row.id in page["replied_parents"]
        account = page["accounts"].get(row.social_account_id)
        post = page["posts"].get(row.post_id)
        content = (getattr(post, "content", "") or "").strip()
        media = getattr(post, "media_urls", None) or []
        published = getattr(post, "published_at", None) or getattr(post, "scheduled_at", None)
        items.append(
            InboxComment(
                **base,
                account_name=getattr(account, "account_name", "") or "",
                post_excerpt=content,
                post_thumb=str(media[0]) if media else "",
                post_published_at=published,
                kind="comment",
            )
        )
    return InboxPage(
        items=items,
        total=page["total"],
        limit=page["limit"],
        offset=page["offset"],
        unread_count=page["unread_count"],
        unread_by_network=page["unread_by_network"],
        counts=page["counts"],
    )


@router.get("/inbox/posts", response_model=InboxPostsPage)
def get_inbox_posts(
    network: str | None = None,
    account_id: UUID | None = None,
    search: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InboxPostsPage:
    """Published posts on inbox networks, newest first, including posts with no comments."""
    page = inbox_posts_page(
        db,
        user.id,
        network=network,
        account_id=account_id,
        search=search,
        limit=limit,
        offset=offset,
    )
    return InboxPostsPage(
        items=[InboxPost(**item) for item in page["items"]],
        total=page["total"],
        limit=page["limit"],
        offset=page["offset"],
    )


@router.get("/engagement/capabilities", response_model=CapabilityMatrix)
def get_capabilities(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Per-network support and per-account readiness. No network calls."""
    return capability_matrix(db, user.id)


@router.post("/comments/read", response_model=MarkReadResult)
def mark_read_bulk(
    payload: MarkReadRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MarkReadResult:
    """Mark specific comments read, or every comment matching an inbox filter."""
    if not payload.comment_ids and not payload.all_matching:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Provide comment_ids or set all_matching to mark a filtered set.",
        )
    updated, missing = mark_comments_read(
        db,
        user.id,
        comment_ids=list(payload.comment_ids),
        network=payload.network,
        account_id=payload.account_id,
        status=payload.status,
        search=payload.search,
        all_matching=payload.all_matching,
    )
    if missing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    return MarkReadResult(updated=updated)


@router.post("/comments/{comment_id}/unread", response_model=CommentRead)
def mark_unread(
    comment_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CommentRead:
    """Put the unread dot back on one owned comment."""
    comment = get_owned_comment(db, comment_id, user.id)
    if comment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    return _comment_read(mark_comment_unread(db, comment))


@router.post("/comments/{comment_id}/read", response_model=CommentRead)
def mark_read(
    comment_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CommentRead:
    """Mark one owned comment as read."""
    comment = get_owned_comment(db, comment_id, user.id)
    if comment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    return _comment_read(mark_comment_read(db, comment))


@router.post("/comments/{comment_id}/reply", response_model=CommentReplyResult)
def reply_to_comment(
    comment_id: UUID,
    payload: CommentReplyRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CommentReplyResult:
    """Post a reply on the network and store it as a child comment.

    Returns 501 when the network cannot reply yet, and 409 when the account
    needs to be connected again.
    """
    comment = get_owned_comment(db, comment_id, user.id)
    if comment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    if comment.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This comment was deleted and cannot be replied to.",
        )
    post = get_owned_post(db, comment.post_id, user.id)
    account = comment.social_account or post.connected_account
    provider = registry.get_engagement_provider(comment.network or getattr(account, "platform", ""))
    if not provider.capabilities.supports_comment_reply:
        raise _unsupported(provider, "comment_reply")
    with _comment_action_errors(
        db, account, provider, comment, "comment_reply",
        "The network did not confirm your reply. Refresh the post before trying again.",
    ):
        prepare_account(db, account)
        result = provider.reply_to_comment(account, comment, payload.text.strip())
        child = store_own_reply(db, comment, account, post, payload.text.strip(), result)
    return CommentReplyResult(reply=_comment_read(child), parent=_comment_read(comment))


@router.delete("/comments/{comment_id}", status_code=204)
def delete_comment(
    comment_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    comment = get_owned_comment(db, comment_id, user.id)
    if comment is None:
        raise HTTPException(404, "Comment not found")
    if comment.is_deleted:
        return Response(status_code=204)
    post = get_owned_post(db, comment.post_id, user.id)
    account = post.connected_account
    if (not account or account.user_id != user.id or comment.social_account_id != account.id
            or registry.canonical_network(comment.network) != registry.canonical_network(account.platform)
            or comment.provider_post_id != post.provider_post_id):
        raise HTTPException(409, "The comment does not match this connected post.")
    provider = registry.get_engagement_provider(account.platform)
    if not provider.delete_scopes:
        raise HTTPException(501, "This network does not support deleting comments in SocialCastly.")
    if (provider.network == "youtube" and comment.author_provider_id and
            comment.is_own != (comment.author_provider_id == account.platform_account_id)):
        raise HTTPException(409, "Refresh this post to verify the comment author before removing it.")
    if provider.deletes_own_only and not comment.is_own:
        raise HTTPException(403, "Only your own replies can be deleted on this network.")
    if not set(provider.delete_scopes).issubset(account.scopes or []):
        raise HTTPException(403, "This account has not granted permission to remove comments.")
    if not (comment.provider_comment_id or "").strip():
        raise HTTPException(409, "This comment has no network ID.")
    with _comment_action_errors(
        db, account, provider, comment, "delete_comment",
        "The network did not confirm comment removal. Refresh the post before trying again.",
    ):
        prepare_account(db, account)
        provider.delete_comment(account, comment)
    comment.is_deleted = True
    if provider.network in {"youtube", "facebook", "instagram"}:
        # A removed parent no longer has a visible discussion on these networks.
        descendants = select(PostComment.id).where(PostComment.id == comment.id).cte(recursive=True)
        descendants = descendants.union(select(PostComment.id).where(
            PostComment.post_id == post.id, PostComment.parent_comment_id == descendants.c.id
        ))
        db.execute(update(PostComment).where(PostComment.id.in_(select(descendants.c.id)))
                   .values(is_deleted=True).execution_options(synchronize_session=False))
    db.commit()
    return Response(status_code=204)


@router.post("/comments/{comment_id}/hide", response_model=CommentRead)
def hide_comment(
    comment_id: UUID,
    payload: CommentHideRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CommentRead:
    """Hide or unhide a reply when the network documents that action."""
    comment = get_owned_comment(db, comment_id, user.id)
    if comment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    if comment.is_deleted:
        raise HTTPException(409, "This comment was deleted and cannot be moderated.")
    post = get_owned_post(db, comment.post_id, user.id)
    account = comment.social_account or post.connected_account
    provider = registry.get_engagement_provider(comment.network or getattr(account, "platform", ""))
    if not provider.capabilities.supports_hide_reply:
        raise _unsupported(provider, "hide_reply")
    if not account or not account.is_active:
        raise HTTPException(409, "This connected account is not active.")
    if not (comment.provider_comment_id or "").strip():
        raise HTTPException(409, "Refresh this post before changing comment visibility.")
    if provider.network == "threads" and (
        comment.parent_comment_id or
        (comment.provider_parent_id and comment.provider_parent_id != post.provider_post_id)
    ):
        raise HTTPException(status_code=409, detail="Threads only allows hiding top-level replies.")
    missing = [
        scope
        for scope in provider.capabilities.scopes_for("hide_reply")
        if scope not in set(account.scopes or [])
    ]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=reconnect_for_comments(getattr(account, "platform", None)),
        )
    with _comment_action_errors(
        db, account, provider, comment, "hide_reply",
        "The network did not confirm the visibility change. Refresh the post before trying again.",
    ):
        prepare_account(db, account)
        provider.hide_reply(account, comment, payload.hidden)
    comment.is_hidden = payload.hidden
    db.commit()
    db.refresh(comment)
    return _comment_read(comment)


@router.get("/posts/{post_id}/comments", response_model=CommentThread)
def get_post_comments(
    post_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CommentThread:
    """Threaded comments for one owned post."""
    get_owned_post(db, post_id, user.id)
    return CommentThread(post_id=post_id, comments=_thread(comments_for_post(db, post_id)))


@router.get("/posts/{post_id}/insights", response_model=PostInsights)
def get_post_insights(
    post_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PostInsights:
    """Latest insight snapshot and older ones for an owned post."""
    get_owned_post(db, post_id, user.id)
    history = insights_for_post(db, post_id)
    return PostInsights(
        post_id=post_id,
        latest=history[0] if history else None,
        history=history,
    )


@router.post("/posts/{post_id}/engagement/sync", response_model=SyncPostResult)
def sync_post_engagement(
    post_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Refresh comments and insights for one owned published post."""
    post = get_owned_post(db, post_id, user.id)
    if post.remote_status == "deleted":
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This post is no longer available on the network.",
        )
    if post.status != "published" or not (post.provider_post_id or "").strip():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only a published post with a network id can be refreshed.",
        )
    try:
        return sync_one_post(db, post)
    except RemotePostDeleted:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This post is no longer available on the network.",
        ) from None
    except NotSupported as exc:
        provider = registry.get_engagement_provider(exc.network)
        raise _unsupported(provider, exc.capability) from None
    except CreditsRequired:
        raise
    except ReconnectRequired as exc:
        account = post.connected_account
        if account.platform in {"linkedin", "tiktok", "x", "pinterest"} and isinstance(exc, ProviderAuthError) and exc.kind == "permission":
            raise HTTPException(status_code=403, detail=f"This {account.platform} connection does not have access to this post.") from None
        _remember_auth_failure(db, account, exc)
        if account.platform == "facebook" and isinstance(exc, ProviderAuthError) and exc.kind == "permission":
            raise HTTPException(status_code=403, detail="Facebook did not allow SocialCastly to read this Page's posts.") from None
        detail = exc.message if not isinstance(exc, ProviderAuthError) else auth_message(account, exc.kind)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from None
    except AccountUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.message) from None
    except Exception:
        logger.exception("Engagement sync failed post=%s", post_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="SocialCastly could not refresh this post. Try again.",
        ) from None
