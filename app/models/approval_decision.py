"""Append-only history of approval decisions (approved, rejected, changes requested)."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import JSON, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.models.base import Base, Timestamped, UUIDPrimaryKey


class ApprovalDecisionRecord(UUIDPrimaryKey, Timestamped, Base):
    """One decision on one approval request.

    ``approval_workflows`` only keeps the latest state of a request and is reset when a
    draft is sent for approval again. This table keeps every decision, with a snapshot of
    the post as it was reviewed, so the Approved/Rejected history survives later edits.
    """

    __tablename__ = "approval_decisions"
    __table_args__ = (
        Index("ix_approval_decisions_owner_decided", "owner_id", "decided_at"),
    )

    owner_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Kept when the draft is later deleted, so history does not disappear with it.
    item_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("publish_items.id", ondelete="SET NULL")
    )
    reviewer_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    reviewer_name: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    decision: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    comment: Mapped[str | None] = mapped_column(Text)
    decided_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, default="", nullable=False)
    media_urls: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    post_format: Mapped[str] = mapped_column(String(32), default="Post", nullable=False)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    item_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSON, default=dict, nullable=False
    )
