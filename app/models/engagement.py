"""Comments and insight snapshots collected from connected social networks.

Networks differ, so metric columns stay nullable and provider payloads are kept
in ``raw`` for a later, network-specific reader. ``raw`` is not returned by the API.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy import false as sql_false
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.models.base import Base, Timestamped, UUIDPrimaryKey, utc_now
from app.models.connected_account import ConnectedAccount
from app.models.scheduled_post import ScheduledPost


class PostComment(UUIDPrimaryKey, Timestamped, Base):
    """One comment or reply on a published post, as last fetched from the network."""

    __tablename__ = "post_comments"
    __table_args__ = (
        UniqueConstraint(
            "social_account_id",
            "network",
            "provider_comment_id",
            name="uq_post_comments_account_network_provider",
        ),
        Index("ix_post_comments_post_created", "post_id", "created_at_provider"),
        Index("ix_post_comments_account_read", "social_account_id", "is_read"),
        Index("ix_post_comments_parent", "parent_comment_id"),
    )

    post_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("scheduled_posts.id", ondelete="CASCADE"),
        nullable=False,
    )
    social_account_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("connected_accounts.id", ondelete="CASCADE"),
        nullable=False,
    )
    network: Mapped[str] = mapped_column(String(40), nullable=False)
    provider_comment_id: Mapped[str] = mapped_column(String(255), nullable=False)
    provider_post_id: Mapped[str] = mapped_column(String(255), nullable=False)
    parent_comment_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("post_comments.id", ondelete="SET NULL"),
        nullable=True,
    )
    provider_parent_id: Mapped[str | None] = mapped_column(String(255))
    # Local root of the thread. Null on the root comment itself.
    thread_root_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("post_comments.id", ondelete="SET NULL"),
        nullable=True,
    )
    provider_thread_root_id: Mapped[str | None] = mapped_column(String(255))
    author_name: Mapped[str | None] = mapped_column(String(255))
    author_handle: Mapped[str | None] = mapped_column(String(255))
    author_avatar_url: Mapped[str | None] = mapped_column(String(1024))
    author_provider_id: Mapped[str | None] = mapped_column(String(255))
    text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at_provider: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    is_read: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=sql_false(), nullable=False
    )
    replied: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=sql_false(), nullable=False
    )
    replied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reply_provider_id: Mapped[str | None] = mapped_column(String(255))
    is_own: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=sql_false(), nullable=False
    )
    is_hidden: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=sql_false(), nullable=False
    )
    is_deleted: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=sql_false(), nullable=False
    )
    raw: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)

    post: Mapped["ScheduledPost"] = relationship()
    social_account: Mapped["ConnectedAccount"] = relationship()
    parent: Mapped["PostComment | None"] = relationship(
        "PostComment",
        remote_side="PostComment.id",
        foreign_keys=[parent_comment_id],
        overlaps="thread_root",
    )
    thread_root: Mapped["PostComment | None"] = relationship(
        "PostComment",
        remote_side="PostComment.id",
        foreign_keys=[thread_root_id],
        overlaps="parent",
    )


class PostInsightsSnapshot(UUIDPrimaryKey, Timestamped, Base):
    """Point-in-time metrics for one published post. Unused metrics stay null."""

    __tablename__ = "post_insights_snapshots"
    __table_args__ = (
        Index("ix_post_insights_post_captured", "post_id", "captured_at"),
        Index("ix_post_insights_account_captured", "social_account_id", "captured_at"),
    )

    post_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("scheduled_posts.id", ondelete="CASCADE"),
        nullable=False,
    )
    social_account_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("connected_accounts.id", ondelete="CASCADE"),
        nullable=False,
    )
    network: Mapped[str] = mapped_column(String(40), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    impressions: Mapped[int | None] = mapped_column(Integer)
    reach: Mapped[int | None] = mapped_column(Integer)
    likes: Mapped[int | None] = mapped_column(Integer)
    comments: Mapped[int | None] = mapped_column(Integer)
    shares: Mapped[int | None] = mapped_column(Integer)
    saves: Mapped[int | None] = mapped_column(Integer)
    clicks: Mapped[int | None] = mapped_column(Integer)
    video_views: Mapped[int | None] = mapped_column(Integer)
    engagement_rate: Mapped[float | None] = mapped_column(Float)
    raw: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)

    post: Mapped[ScheduledPost] = relationship()
    social_account: Mapped[ConnectedAccount] = relationship()
