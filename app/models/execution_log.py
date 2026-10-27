"""Immutable attempt history for provider publishing tasks."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.scheduled_post import ScheduledPost

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import JSON, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.models.base import Base, UUIDPrimaryKey, utc_now


class ExecutionLog(UUIDPrimaryKey, Base):
    """Provider attempt outcome and diagnostic metadata for one post."""

    __tablename__ = "execution_logs"
    __table_args__ = (
        CheckConstraint("outcome IN ('started','succeeded','retrying','failed','skipped')", name="valid_outcome"),
        CheckConstraint("attempt_number > 0", name="positive_attempt_number"),
        Index("ix_execution_logs_post_created", "scheduled_post_id", "created_at"),
    )
    scheduled_post_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("scheduled_posts.id", ondelete="CASCADE"), nullable=False
    )
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    outcome: Mapped[str] = mapped_column(String(20), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    provider_request_id: Mapped[str | None] = mapped_column(String(255))
    provider_status_code: Mapped[int | None] = mapped_column(Integer)
    error_code: Mapped[str | None] = mapped_column(String(100))
    error_message: Mapped[str | None] = mapped_column(Text)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    scheduled_post: Mapped["ScheduledPost"] = relationship(back_populates="execution_logs")
