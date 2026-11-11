"""Pydantic contracts for comments, the inbox, insights, and network capabilities."""

from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

InboxStatus = Literal["unread", "unreplied", "replied", "all"]


def _utc(value: datetime | None) -> datetime | None:
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


class CommentRead(BaseModel):
    """One stored comment. ``replies`` is filled for the threaded post view."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    post_id: UUID
    social_account_id: UUID
    network: str
    provider_comment_id: str
    provider_post_id: str
    parent_comment_id: UUID | None = None
    provider_parent_id: str | None = None
    thread_root_id: UUID | None = None
    author_name: str | None = None
    author_handle: str | None = None
    author_avatar_url: str | None = None
    author_provider_id: str | None = None
    text: str
    created_at_provider: datetime | None = None
    fetched_at: datetime
    is_read: bool
    replied: bool
    replied_at: datetime | None = None
    reply_provider_id: str | None = None
    is_own: bool
    is_hidden: bool
    is_deleted: bool
    replies: list["CommentRead"] = Field(default_factory=list)

    @field_validator(
        "created_at_provider",
        "fetched_at",
        "replied_at",
        mode="before",
    )
    @classmethod
    def attach_utc(cls, value: datetime | None) -> datetime | None:
        return _utc(value)


class CommentThread(BaseModel):
    """Comments on one post, roots first, each with nested replies."""

    post_id: UUID
    comments: list[CommentRead]


class InboxComment(CommentRead):
    """A comment row in the unified inbox, with enough context to open the post."""

    account_name: str = ""
    post_excerpt: str = ""


class InboxPage(BaseModel):
    """One page of the inbox, newest first, plus unread counts."""

    items: list[InboxComment]
    total: int
    limit: int
    offset: int
    unread_count: int
    unread_by_network: dict[str, int]


class CommentReplyRequest(BaseModel):
    """Text of a reply posted to the network."""

    text: str = Field(min_length=1, max_length=8000)


class CommentReplyResult(BaseModel):
    """The stored reply and the parent comment after it was marked replied."""

    reply: CommentRead
    parent: CommentRead


class MarkReadRequest(BaseModel):
    """Mark specific comments, or every comment that matches an inbox filter."""

    comment_ids: list[UUID] = Field(default_factory=list)
    network: str | None = None
    account_id: UUID | None = None
    status: InboxStatus | None = None
    search: str | None = None
    all_matching: bool = False


class MarkReadResult(BaseModel):
    """How many comments changed from unread to read."""

    updated: int


class InsightSnapshotRead(BaseModel):
    """One captured metric row. Fields the network does not report are null."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    post_id: UUID
    social_account_id: UUID
    network: str
    captured_at: datetime
    impressions: int | None = None
    reach: int | None = None
    likes: int | None = None
    comments: int | None = None
    shares: int | None = None
    saves: int | None = None
    clicks: int | None = None
    video_views: int | None = None
    engagement_rate: float | None = None

    @field_validator("captured_at", mode="before")
    @classmethod
    def attach_utc(cls, value: datetime | None) -> datetime | None:
        return _utc(value)


class PostInsights(BaseModel):
    """Latest snapshot plus older ones, newest first."""

    post_id: UUID
    latest: InsightSnapshotRead | None
    history: list[InsightSnapshotRead]


class SyncPostResult(BaseModel):
    """Outcome of a manual refresh for one post."""

    post_id: UUID
    comments_upserted: int
    insights_captured: bool
    skipped: list[str]


class NetworkCapabilities(BaseModel):
    """What a network can do. All current networks are not supported yet."""

    network: str
    label: str
    supports_comments_read: bool
    supports_comment_reply: bool
    supports_insights: bool
    required_scopes: dict[str, list[str]]


class AccountCapabilities(BaseModel):
    """Capabilities for one connected account, including reconnect warnings."""

    account_id: UUID
    network: str
    account_name: str
    is_active: bool
    needs_reconnect: bool
    reconnect_reason: str | None = None
    supports_comments_read: bool
    supports_comment_reply: bool
    supports_insights: bool
    can_read_comments: bool
    can_reply: bool
    can_read_insights: bool
    missing_scopes: dict[str, list[str]]
    reconnect_for_permissions: bool
    message: str | None = None


class CapabilityMatrix(BaseModel):
    """Per-network support and per-account readiness for the signed-in user."""

    networks: list[NetworkCapabilities]
    accounts: list[AccountCapabilities]
