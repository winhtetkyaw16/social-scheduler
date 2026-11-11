"""Authenticated draft, approval, and media-library operations."""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user, get_db
from app.models import (
    ApprovalWorkflow,
    ConnectedAccount,
    MediaAsset,
    PostInternalComment,
    PublishItem,
    ScheduledPost,
    User,
)
from app.schemas.publish import (
    ApprovalDecision,
    ApprovalHistoryRead,
    BulkUploadResult,
    DraftActionResult,
    DraftQueueRequest,
    DraftScheduleRequest,
    EvergreenPostRead,
    EvergreenSettingsUpdate,
    InternalCommentCreate,
    InternalCommentRead,
    MediaAssetRead,
    PublishItemCreate,
    PublishItemRead,
    PublishItemUpdate,
)
from app.schemas.queue import (
    QueueAllocateRequest,
    QueueAllocateResponse,
    QueueNextRead,
    QueueSlotRead,
    QueueSlotsReplace,
    QueueUpcomingItem,
)
from app.services import posts as posts_service
from app.services import queue_slots as queue_slot_service

router = APIRouter()


def _owned_item(db: Session, item_id: UUID, user_id: UUID) -> PublishItem:
    """Load a draft publish item owned by user_id, with its approval row, or raise 404."""
    item = db.scalar(
        select(PublishItem)
        .options(selectinload(PublishItem.approval))
        .where(PublishItem.id == item_id, PublishItem.owner_id == user_id)
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Publish item not found")
    return item


@router.get("/drafts", response_model=list[PublishItemRead])
def list_drafts(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Drafts and items sent back for changes, newest first."""
    return list(
        db.scalars(
            select(PublishItem)
            .where(
                PublishItem.owner_id == user.id,
                PublishItem.status.in_(["draft", "changes_requested"]),
            )
            .order_by(PublishItem.updated_at.desc())
        ).all()
    )


@router.post(
    "/drafts", response_model=PublishItemRead, status_code=status.HTTP_201_CREATED
)
def create_draft(
    payload: PublishItemCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Store a new draft publish item for the signed-in user."""
    item = PublishItem(
        owner_id=user.id,
        content=payload.content,
        status="draft",
        media_urls=payload.media_urls,
        post_format=payload.post_format,
        scheduled_at=payload.scheduled_at,
        metadata_json=payload.metadata,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/drafts/{item_id}", response_model=PublishItemRead)
def update_draft(
    item_id: UUID,
    payload: PublishItemUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Patch an owned draft that is still editable."""
    item = _owned_item(db, item_id, user.id)
    if item.status not in {"draft", "changes_requested"}:
        raise HTTPException(
            status_code=409, detail="Only editable drafts can be changed"
        )
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
def delete_draft(
    item_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    """Delete an owned draft, including ones that were rejected."""
    item = _owned_item(db, item_id, user.id)
    if item.status not in {"draft", "changes_requested", "rejected"}:
        raise HTTPException(
            status_code=409, detail="This item cannot be deleted in its current state"
        )
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
    posts = posts_service.queue_draft(
        db, user.id, item, timezone_fallback=body.timezone or "UTC"
    )
    return DraftActionResult(
        draft_id=item.id,
        status=item.status,
        scheduled_post_ids=[post.id for post in posts],
        scheduled_at=item.scheduled_at,
    )


@router.post("/drafts/{item_id}/submit", response_model=PublishItemRead)
def submit_for_approval(
    item_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    """Move an owned draft with content into pending approval."""
    item = _owned_item(db, item_id, user.id)
    if item.status not in {"draft", "changes_requested"}:
        raise HTTPException(
            status_code=409, detail="Only drafts can be submitted for approval"
        )
    if not item.content.strip():
        raise HTTPException(
            status_code=422, detail="Add post content before submitting it for approval"
        )
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
def list_approvals(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    """Items the signed-in user still has to approve, oldest first."""
    return list(
        db.scalars(
            select(PublishItem)
            .options(selectinload(PublishItem.approval))
            .where(
                PublishItem.owner_id == user.id,
                PublishItem.status == "pending_approval",
            )
            .order_by(PublishItem.updated_at.asc())
        ).all()
    )


_HISTORY_FILTERS = {
    "approved": ["approved"],
    # The Rejected tab also lists drafts sent back for changes.
    "rejected": ["rejected", "changes_requested"],
    "changes_requested": ["changes_requested"],
}


@router.get("/approvals/history", response_model=list[ApprovalHistoryRead])
def list_approval_history(
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Past decisions, newest first. ``status`` is approved, rejected, or changes_requested."""
    from app.services.approval_history import list_history

    decisions = None
    if status_filter:
        decisions = _HISTORY_FILTERS.get(status_filter.strip().lower())
        if decisions is None:
            raise HTTPException(
                status_code=422,
                detail="Choose approved, rejected, or changes_requested.",
            )
    return list_history(db, user.id, decisions, limit)


@router.post("/approvals/{item_id}/decision", response_model=PublishItemRead)
def decide_approval(
    item_id: UUID,
    payload: ApprovalDecision,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Record the decision. An approval that is already due is queued to publish."""
    item = _owned_item(db, item_id, user.id)
    if item.status != "pending_approval" or item.approval is None:
        raise HTTPException(
            status_code=409, detail="This item is not awaiting approval"
        )
    due_ids: list[str] = []
    if payload.decision == "approved":
        from app.services.posts import schedule_posts_for_approved_item

        posts = schedule_posts_for_approved_item(db, user.id, item)
        now = datetime.now(timezone.utc)
        for post in posts:
            scheduled_at = post.scheduled_at
            if scheduled_at.tzinfo is None:
                scheduled_at = scheduled_at.replace(tzinfo=timezone.utc)
            if (
                post.status == "scheduled"
                and post.provider_post_id is None
                and scheduled_at <= now
            ):
                due_ids.append(str(post.id))
    decided_at = datetime.now(timezone.utc)
    item.approval.state = payload.decision
    item.approval.reviewer_id = user.id
    item.approval.comment = payload.comment
    item.approval.decided_at = decided_at
    from app.services.approval_history import record_decision

    record_decision(db, item, user, payload.decision, payload.comment, decided_at)
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
    """Media assets owned by the signed-in user, newest first."""
    return list(
        db.scalars(
            select(MediaAsset)
            .where(MediaAsset.owner_id == user.id)
            .order_by(MediaAsset.created_at.desc())
        ).all()
    )


@router.get("/posts/{post_id}/comments", response_model=list[InternalCommentRead])
def list_post_comments(
    post_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    """Internal comments on an owned scheduled post, oldest first."""
    post = db.scalar(
        select(ScheduledPost).where(
            ScheduledPost.id == post_id, ScheduledPost.user_id == user.id
        )
    )
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    comments = db.scalars(
        select(PostInternalComment)
        .where(PostInternalComment.post_id == post_id)
        .order_by(PostInternalComment.created_at.asc())
    ).all()
    return [
        {
            "id": item.id,
            "post_id": item.post_id,
            "user_id": item.user_id,
            "author_name": item.author.full_name or item.author.email,
            "body": item.body,
            "created_at": item.created_at,
        }
        for item in comments
    ]


@router.post(
    "/posts/{post_id}/comments",
    response_model=InternalCommentRead,
    status_code=status.HTTP_201_CREATED,
)
def add_post_comment(
    post_id: UUID,
    payload: InternalCommentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Add an internal comment on an owned scheduled post."""
    post = db.scalar(
        select(ScheduledPost).where(
            ScheduledPost.id == post_id, ScheduledPost.user_id == user.id
        )
    )
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
        "id": comment.id,
        "post_id": comment.post_id,
        "user_id": comment.user_id,
        "author_name": user.full_name or user.email,
        "body": comment.body,
        "created_at": comment.created_at,
    }


@router.get("/queue-slots", response_model=list[QueueSlotRead])
def get_queue_slots(
    platform: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List saved weekly posting slots (Buffer-style) for this workspace."""
    return queue_slot_service.list_slots(
        db, user.id, platform.strip().lower() if platform else None
    )


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
    return queue_slot_service.upcoming_queue(
        db, user.id, days=days, timezone_fallback=timezone or "UTC"
    )


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
        raise HTTPException(
            status_code=404, detail="Active connected account not found"
        )
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


@router.get("/evergreen", response_model=list[EvergreenPostRead])
def list_evergreen(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    """Published posts that can be re-shared, newest first, with their evergreen settings."""
    from app.services.evergreen import describe

    return describe(db, user.id)


@router.put("/evergreen/{post_id}", response_model=EvergreenPostRead)
def update_evergreen(
    post_id: UUID,
    payload: EvergreenSettingsUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Turn evergreen on or off for one post and set how often it may be re-shared."""
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    from app.services.evergreen import describe, update_settings

    post = posts_service.get_owned_post(db, post_id, user.id)
    try:
        ZoneInfo(payload.timezone)
        tz_name = payload.timezone
    except (ZoneInfoNotFoundError, ValueError):
        tz_name = "UTC"
    update_settings(db, post, payload.enabled, payload.interval_days, tz_name)
    row = next((item for item in describe(db, user.id) if item["post_id"] == post.id), None)
    if row is None:
        raise HTTPException(status_code=404, detail="Post not found")
    return row


@router.get("/bulk/template", include_in_schema=True)
def bulk_template(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> Response:
    """CSV template: the header row and one example row for one of the user's channels."""
    from app.services.bulk_csv import template_csv

    accounts = list(
        db.scalars(
            select(ConnectedAccount)
            .where(
                ConnectedAccount.user_id == user.id,
                ConnectedAccount.is_active.is_(True),
            )
            .order_by(ConnectedAccount.created_at)
        ).all()
    )
    example = "facebook"
    if accounts:
        first = accounts[0]
        same = [a for a in accounts if a.platform == first.platform]
        example = first.platform if len(same) == 1 else first.account_name
    return Response(
        content=template_csv(example),
        media_type="text/csv",
        headers={
            "Content-Disposition": 'attachment; filename="socialcastly-bulk-template.csv"'
        },
    )


@router.post("/bulk", response_model=BulkUploadResult)
async def bulk_upload(
    file: UploadFile = File(...),
    timezone_name: str = Form(default="UTC", alias="timezone"),
    dry_run: bool = Form(default=False),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Schedule posts from a CSV. Every row is checked first; one bad row means none are created."""
    from app.services.bulk_csv import MAX_BYTES, import_csv

    data = await file.read(MAX_BYTES + 1)
    result = import_csv(db, user.id, data, timezone_name, dry_run=dry_run)
    return result.as_dict(dry_run)
