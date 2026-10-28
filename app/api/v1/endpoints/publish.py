"""Authenticated draft, approval, and media-library operations."""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user, get_db
from app.models import ApprovalWorkflow, ConnectedAccount, MediaAsset, PostInternalComment, PublishItem, ScheduledPost, User
from app.schemas.publish import (
    ApprovalDecision,
    DraftActionResult,
    DraftQueueRequest,
    DraftScheduleRequest,
    InternalCommentCreate,
    InternalCommentRead,
    MediaAssetRead,
    PublishItemCreate,
    PublishItemRead,
    PublishItemUpdate,
)
from app.services import posts as posts_service
from app.schemas.queue import (
    QueueAllocateRequest,
    QueueAllocateResponse,
    QueueNextRead,
    QueueSlotRead,
    QueueSlotsReplace,
    QueueUpcomingItem,
)
from app.services import queue_slots as queue_slot_service

router = APIRouter()


def _owned_item(db: Session, item_id: UUID, user_id: UUID) -> PublishItem:
    item = db.scalar(
        select(PublishItem).options(selectinload(PublishItem.approval)).where(
            PublishItem.id == item_id, PublishItem.owner_id == user_id
        )
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Publish item not found")
    return item


@router.get("/drafts", response_model=list[PublishItemRead])
def list_drafts(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list(db.scalars(
        select(PublishItem).where(PublishItem.owner_id == user.id, PublishItem.status.in_(["draft", "changes_requested"]))
        .order_by(PublishItem.updated_at.desc())
    ).all())


@router.post("/drafts", response_model=PublishItemRead, status_code=status.HTTP_201_CREATED)
def create_draft(payload: PublishItemCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = PublishItem(
        owner_id=user.id, content=payload.content, status="draft", media_urls=payload.media_urls,
        post_format=payload.post_format, scheduled_at=payload.scheduled_at, metadata_json=payload.metadata,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/drafts/{item_id}", response_model=PublishItemRead)
def update_draft(item_id: UUID, payload: PublishItemUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = _owned_item(db, item_id, user.id)
    if item.status not in {"draft", "changes_requested"}:
        raise HTTPException(status_code=409, detail="Only editable drafts can be changed")
    for key, value in payload.model_dump(exclude_unset=True).items():
        if key == "metadata":
            item.metadata_json = value or {}
        elif key == "scheduled_at":
            item.scheduled_at = value
        elif value is not None:
            setattr(item, key, value)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/drafts/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_draft(item_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = _owned_item(db, item_id, user.id)
    if item.status not in {"draft", "changes_requested", "rejected"}:
        raise HTTPException(status_code=409, detail="This item cannot be deleted in its current state")
    db.delete(item)
    db.commit()



@router.post("/drafts/{item_id}/schedule", response_model=DraftActionResult)
def schedule_draft(
    item_id: UUID,
    payload: DraftScheduleRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create scheduled posts from a durable draft at one exact datetime."""
    item = _owned_item(db, item_id, user.id)
    posts = posts_service.schedule_draft_at(db, user.id, item, payload.scheduled_at)
    return DraftActionResult(
        draft_id=item.id,
        status=item.status,
        scheduled_post_ids=[post.id for post in posts],
        scheduled_at=item.scheduled_at,
    )


@router.post("/drafts/{item_id}/queue", response_model=DraftActionResult)
def queue_draft(
    item_id: UUID,
    payload: DraftQueueRequest | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Place a durable draft into the next free queue slot per selected account."""
    item = _owned_item(db, item_id, user.id)
    body = payload or DraftQueueRequest()
    posts = posts_service.queue_draft(db, user.id, item, timezone_fallback=body.timezone or "UTC")
    return DraftActionResult(
        draft_id=item.id,
        status=item.status,
        scheduled_post_ids=[post.id for post in posts],
        scheduled_at=item.scheduled_at,
    )


@router.post("/drafts/{item_id}/submit", response_model=PublishItemRead)
def submit_for_approval(item_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = _owned_item(db, item_id, user.id)
    if item.status not in {"draft", "changes_requested"}:
        raise HTTPException(status_code=409, detail="Only drafts can be submitted for approval")
    if not item.content.strip():
        raise HTTPException(status_code=422, detail="Add post content before submitting it for approval")
    item.status = "pending_approval"
    if item.approval is None:
        item.approval = ApprovalWorkflow(requested_by_id=user.id, state="pending")
    else:
        item.approval.state = "pending"
        item.approval.comment = None
        item.approval.decided_at = None
    db.commit()
    db.refresh(item)
    return item


@router.get("/approvals", response_model=list[PublishItemRead])
def list_approvals(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list(db.scalars(
        select(PublishItem).options(selectinload(PublishItem.approval))
        .where(PublishItem.owner_id == user.id, PublishItem.status == "pending_approval")
        .order_by(PublishItem.updated_at.asc())
    ).all())


@router.post("/approvals/{item_id}/decision", response_model=PublishItemRead)
def decide_approval(
    item_id: UUID,
    payload: ApprovalDecision,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    item = _owned_item(db, item_id, user.id)
    if item.status != "pending_approval" or item.approval is None:
        raise HTTPException(status_code=409, detail="This item is not awaiting approval")
    due_ids: list[str] = []
    if payload.decision == "approved":
        from app.services.posts import schedule_posts_for_approved_item

        posts = schedule_posts_for_approved_item(db, user.id, item)
        now = datetime.now(timezone.utc)
        for post in posts:
            scheduled_at = post.scheduled_at
            if scheduled_at.tzinfo is None:
                scheduled_at = scheduled_at.replace(tzinfo=timezone.utc)
            if post.status == "scheduled" and post.provider_post_id is None and scheduled_at <= now:
                due_ids.append(str(post.id))
    item.approval.state = payload.decision
    item.approval.reviewer_id = user.id
    item.approval.comment = payload.comment
    item.approval.decided_at = datetime.now(timezone.utc)
    item.status = "approved" if payload.decision == "approved" else payload.decision
    db.commit()
    if due_ids:
        from app.api.v1.endpoints.posts import enqueue_immediate_publish

        for post_id in due_ids:
            background_tasks.add_task(enqueue_immediate_publish, post_id)
    db.refresh(item)
    return item


@router.get("/library", response_model=list[MediaAssetRead])
def list_library(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list(db.scalars(
        select(MediaAsset).where(MediaAsset.owner_id == user.id).order_by(MediaAsset.created_at.desc())
    ).all())


@router.get("/posts/{post_id}/comments", response_model=list[InternalCommentRead])
def list_post_comments(post_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    post = db.scalar(select(ScheduledPost).where(ScheduledPost.id == post_id, ScheduledPost.user_id == user.id))
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    comments = db.scalars(
        select(PostInternalComment).where(PostInternalComment.post_id == post_id)
        .order_by(PostInternalComment.created_at.asc())
    ).all()
    return [
        {"id": item.id, "post_id": item.post_id, "user_id": item.user_id,
         "author_name": item.author.full_name or item.author.email, "body": item.body, "created_at": item.created_at}
        for item in comments
    ]


@router.post("/posts/{post_id}/comments", response_model=InternalCommentRead, status_code=status.HTTP_201_CREATED)
def add_post_comment(
    post_id: UUID,
    payload: InternalCommentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    post = db.scalar(select(ScheduledPost).where(ScheduledPost.id == post_id, ScheduledPost.user_id == user.id))
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=422, detail="Comment cannot be blank")
    comment = PostInternalComment(post_id=post_id, user_id=user.id, body=body)
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return {
        "id": comment.id, "post_id": comment.post_id, "user_id": comment.user_id,
        "author_name": user.full_name or user.email, "body": comment.body, "created_at": comment.created_at,
    }


@router.get("/queue-slots", response_model=list[QueueSlotRead])
def get_queue_slots(
    platform: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List saved weekly posting slots (Buffer-style) for this workspace."""
    return queue_slot_service.list_slots(db, user.id, platform.strip().lower() if platform else None)


@router.put("/queue-slots", response_model=list[QueueSlotRead])
def put_queue_slots(
    payload: QueueSlotsReplace,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Replace all weekly slots for one platform."""
    return queue_slot_service.replace_platform_slots(db, user.id, payload)


@router.get("/queue/upcoming", response_model=list[QueueUpcomingItem])
def get_queue_upcoming(
    days: int = 14,
    timezone: str = "UTC",
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Upcoming slot timeline with filled/empty assignments for active accounts."""
    return queue_slot_service.upcoming_queue(db, user.id, days=days, timezone_fallback=timezone or "UTC")


@router.get("/queue/next", response_model=QueueNextRead)
def get_queue_next(
    connected_account_id: UUID,
    timezone: str = "UTC",
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return the next free queue slot for one connected account."""
    account = db.scalar(
        select(ConnectedAccount).where(
            ConnectedAccount.id == connected_account_id,
            ConnectedAccount.user_id == user.id,
            ConnectedAccount.is_active.is_(True),
        )
    )
    if account is None:
        raise HTTPException(status_code=404, detail="Active connected account not found")
    return queue_slot_service.next_slot_for_account(
        db, user.id, account, timezone_fallback=timezone or "UTC"
    )


@router.post("/queue/allocate", response_model=QueueAllocateResponse)
def post_queue_allocate(
    payload: QueueAllocateRequest,
    timezone: str = "UTC",
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Allocate next free slots for several accounts without creating posts yet."""
    return queue_slot_service.allocate_slots(
        db, user.id, payload.connected_account_ids, timezone_fallback=timezone or "UTC"
    )
