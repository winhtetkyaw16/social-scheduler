"""Workspace content, media library assets, and approval requests."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.models.base import Base, Timestamped, UUIDPrimaryKey

if TYPE_CHECKING:
    from app.models.user import User


class PublishItem(UUIDPrimaryKey, Timestamped, Base):
    """A reusable post draft or approval item, before provider scheduling."""

    __tablename__ = "publish_items"

    owner_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    content: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="draft", nullable=False, index=True)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    media_urls: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    post_format: Mapped[str] = mapped_column(String(32), default="Post", nullable=False)
    metadata_json: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, default=dict, nullable=False)
    owner: Mapped[User] = relationship()
    approval: Mapped[ApprovalWorkflow | None] = relationship(
        back_populates="item", cascade="all, delete-orphan", uselist=False
    )


class MediaAsset(UUIDPrimaryKey, Timestamped, Base):
    """A user-owned library record for an uploaded media file."""

    __tablename__ = "media_assets"
    __table_args__ = (UniqueConstraint("owner_id", "storage_key", name="uq_media_owner_storage_key"),)

    owner_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(255), nullable=False)
    media_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(nullable=False)
    public_url: Mapped[str] = mapped_column(String(1024), nullable=False)
    alt_text: Mapped[str | None] = mapped_column(String(1000))
    owner: Mapped[User] = relationship()


class ApprovalWorkflow(UUIDPrimaryKey, Timestamped, Base):
    """Review state and decision history for one publish item."""

    __tablename__ = "approval_workflows"

    item_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("publish_items.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    requested_by_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    reviewer_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    state: Mapped[str] = mapped_column(String(32), default="pending", nullable=False, index=True)
    comment: Mapped[str | None] = mapped_column(Text)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    item: Mapped[PublishItem] = relationship(back_populates="approval")


class PostInternalComment(UUIDPrimaryKey, Timestamped, Base):
    """Private workspace note attached to one user's scheduled post."""

    __tablename__ = "post_internal_comments"

    post_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("scheduled_posts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    author: Mapped[User] = relationship()
