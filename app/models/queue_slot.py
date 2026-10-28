"""Per-channel Buffer-style posting queue time slots."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.user import User

from uuid import UUID

from sqlalchemy import ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.models.base import Base, Timestamped, UUIDPrimaryKey


class QueueSlot(UUIDPrimaryKey, Timestamped, Base):
    """One weekly posting time for a user's social channel (platform)."""

    __tablename__ = "queue_slots"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "platform", "weekday", "time_local",
            name="uq_queue_slot_user_platform_weekday_time",
        ),
        Index("ix_queue_slots_user_platform", "user_id", "platform"),
    )

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    platform: Mapped[str] = mapped_column(String(40), nullable=False)
    # Monday=0 … Sunday=6 (ISO-ish; matches frontend calendar Mon-first).
    weekday: Mapped[int] = mapped_column(Integer, nullable=False)
    time_local: Mapped[str] = mapped_column(String(5), nullable=False)  # HH:MM 24h
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")
    user: Mapped["User"] = relationship()
