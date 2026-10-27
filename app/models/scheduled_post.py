"""Scheduled social posts and their publishing lifecycle state."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.connected_account import ConnectedAccount
    from app.models.execution_log import ExecutionLog
    from app.models.user import User

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import JSON, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.models.base import Base, Timestamped, UUIDPrimaryKey


class ScheduledPost(UUIDPrimaryKey, Timestamped, Base):
    """One post scheduled for a single connected social account."""

    __tablename__ = "scheduled_posts"
    __table_args__ = (
        CheckConstraint(
            "status IN ('draft','scheduled','queued','publishing','published','failed','cancelled','archived')",
            name="valid_status",
        ),
        CheckConstraint("attempt_count >= 0 AND max_attempts > 0", name="valid_attempt_limits"),
        Index("ix_posts_due", "status", "scheduled_at"),
        Index("ix_posts_user_created", "user_id", "created_at"),
    )
    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    connected_account_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("connected_accounts.id", ondelete="RESTRICT"), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    media_urls: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    provider_post_id: Mapped[str | None] = mapped_column(String(255))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error_code: Mapped[str | None] = mapped_column(String(100))
    last_error_message: Mapped[str | None] = mapped_column(Text)
    post_metadata: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, default=dict, nullable=False)
    user: Mapped["User"] = relationship(back_populates="scheduled_posts")
    connected_account: Mapped["ConnectedAccount"] = relationship(back_populates="scheduled_posts")
    execution_logs: Mapped[list["ExecutionLog"]] = relationship(
        back_populates="scheduled_post", cascade="all, delete-orphan"
    )
