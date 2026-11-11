"""Approval decision history: record each decision and list past decisions."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    ApprovalDecisionRecord,
    ApprovalWorkflow,
    PublishItem,
    User,
)

DECISIONS = ("approved", "rejected", "changes_requested")


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def record_decision(
    db: Session,
    item: PublishItem,
    reviewer: User | None,
    decision: str,
    comment: str | None,
    decided_at: datetime,
) -> ApprovalDecisionRecord:
    """Add one history row with a snapshot of the item as it was reviewed (no commit)."""
    record = ApprovalDecisionRecord(
        owner_id=item.owner_id,
        item_id=item.id,
        reviewer_id=reviewer.id if reviewer is not None else None,
        reviewer_name=(
            (reviewer.full_name or reviewer.email or "") if reviewer is not None else ""
        )[:160],
        decision=decision,
        comment=comment,
        decided_at=decided_at,
        content=item.content or "",
        media_urls=list(item.media_urls or []),
        post_format=item.post_format or "Post",
        scheduled_at=item.scheduled_at,
        item_metadata=dict(item.metadata_json or {}),
    )
    db.add(record)
    return record


def list_history(
    db: Session,
    owner_id: UUID,
    decisions: list[str] | None = None,
    limit: int = 100,
) -> list[ApprovalDecisionRecord]:
    """Past decisions on the owner's items, newest first, optionally filtered by decision."""
    stmt = select(ApprovalDecisionRecord).where(
        ApprovalDecisionRecord.owner_id == owner_id
    )
    if decisions:
        stmt = stmt.where(ApprovalDecisionRecord.decision.in_(decisions))
    stmt = stmt.order_by(
        ApprovalDecisionRecord.decided_at.desc(), ApprovalDecisionRecord.id
    ).limit(max(1, min(int(limit or 100), 500)))
    return list(db.scalars(stmt).all())


def backfill_from_workflows(db: Session) -> int:
    """Copy decisions already stored on approval_workflows into the history table.

    Used once, when the history table is first created on an existing database, so
    decisions made before this table existed still show up. Rows already present for
    the same item and decision time are skipped. Returns how many rows were added.
    """
    added = 0
    rows = db.execute(
        select(ApprovalWorkflow, PublishItem)
        .join(PublishItem, PublishItem.id == ApprovalWorkflow.item_id)
        .where(
            ApprovalWorkflow.state.in_(DECISIONS),
            ApprovalWorkflow.decided_at.is_not(None),
        )
    ).all()
    for workflow, item in rows:
        exists = db.scalar(
            select(ApprovalDecisionRecord.id).where(
                ApprovalDecisionRecord.item_id == item.id,
                ApprovalDecisionRecord.decision == workflow.state,
            )
        )
        if exists is not None:
            continue
        reviewer = db.get(User, workflow.reviewer_id) if workflow.reviewer_id else None
        record_decision(
            db,
            item,
            reviewer,
            workflow.state,
            workflow.comment,
            _aware(workflow.decided_at),
        )
        added += 1
    if added:
        db.commit()
    return added
