"""Authenticated comments, inbox, insights, and capability routes."""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
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
    NotSupported,
    ProviderAuthError,
    ReconnectRequired,
)
from app.services.engagement.http import auth_message
from app.services.engagement.inbox import (
    capability_matrix,
    comments_for_post,
    get_owned_comment,
    inbox_page,
    insights_for_post,
    mark_comment_read,
    mark_comments_read,
)
from app.services.engagement.sync import store_own_reply, sync_one_post
from app.services.engagement.tokens import prepare_account
from app.services.error_messages import network_name
from app.services.posts import get_owned_post

router = APIRouter()
logger = logging.getLogger(__name__)


def _unsupported(provider, capability: str, action: str) -> HTTPException:
    name = network_name(provider.network)
    detail = f"{name} does not support {action} yet."
    reason = (provider.capabilities.reasons or {}).get(capability)
    if reason:
        detail = f"{detail} {reason}"
    return HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=detail)


def _remember_auth_failure(db: Session, account, exc: ReconnectRequired) -> None:
    """Persist needs_reconnect when the network rejected the token or a permission."""
    if not isinstance(exc, ProviderAuthError) or account is None:
        return
    from app.services.token_refresh import mark_needs_reconnect

    mark_needs_reconnect(db, account, auth_message(account, exc.kind))


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
        account = page["accounts"].get(row.social_account_id)
        post = page["posts"].get(row.post_id)
        content = (getattr(post, "content", "") or "").strip()
        items.append(
            InboxComment(
                **base,
                account_name=getattr(account, "account_name", "") or "",
                post_excerpt=content[:140],
            )
        )
    return InboxPage(
        items=items,
        total=page["total"],
        limit=page["limit"],
        offset=page["offset"],
        unread_count=page["unread_count"],
        unread_by_network=page["unread_by_network"],
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
        raise _unsupported(provider, "comment_reply", "replying to comments")
    try:
        prepare_account(db, account)
        result = provider.reply_to_comment(account, comment, payload.text.strip())
        child = store_own_reply(db, comment, account, post, payload.text.strip(), result)
    except NotSupported:
        raise _unsupported(provider, "comment_reply", "replying to comments") from None
    except CreditsRequired as exc:
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=exc.message) from None
    except ReconnectRequired as exc:
        _remember_auth_failure(db, account, exc)
        detail = exc.message if not isinstance(exc, ProviderAuthError) else auth_message(account, exc.kind)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from None
    except AccountUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.message) from None
    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "Comment reply failed comment=%s account=%s network=%s",
            comment_id,
            getattr(account, "id", None),
            provider.network,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The network could not post that reply. Try again.",
        ) from None
    return CommentReplyResult(reply=_comment_read(child), parent=_comment_read(comment))


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
    post = get_owned_post(db, comment.post_id, user.id)
    account = comment.social_account or post.connected_account
    provider = registry.get_engagement_provider(comment.network or getattr(account, "platform", ""))
    if not provider.capabilities.supports_hide_reply:
        raise _unsupported(provider, "hide_reply", "hiding replies")
    missing = [
        scope
        for scope in provider.capabilities.scopes_for("hide_reply")
        if scope not in set(account.scopes or [])
    ]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Reconnect needed for new permissions",
        )
    try:
        prepare_account(db, account)
        provider.hide_reply(account, comment, payload.hidden)
    except NotSupported:
        raise _unsupported(provider, "hide_reply", "hiding replies") from None
    except CreditsRequired as exc:
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=exc.message) from None
    except ReconnectRequired as exc:
        _remember_auth_failure(db, account, exc)
        detail = exc.message if not isinstance(exc, ProviderAuthError) else auth_message(account, exc.kind)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from None
    except AccountUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.message) from None
    except HTTPException:
        raise
    except Exception:
        logger.exception("Hide reply failed comment=%s network=%s", comment_id, provider.network)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The network could not update that reply. Try again.",
        ) from None
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
    if post.status != "published" or not (post.provider_post_id or "").strip():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only a published post with a network id can be refreshed.",
        )
    try:
        return sync_one_post(db, post)
    except CreditsRequired as exc:
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=exc.message) from None
    except ReconnectRequired as exc:
        account = post.connected_account
        _remember_auth_failure(db, account, exc)
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
