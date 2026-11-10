"""Contracts for drafts, library assets, and approval workflow."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PublishItemCreate(BaseModel):
    """Body for creating a draft publish item."""

    content: str = Field(default="", max_length=10000)
    media_urls: list[str] = Field(default_factory=list, max_length=35)
    post_format: str = Field(default="Post", max_length=32)
    scheduled_at: datetime | None = None
    status: str = Field(default="draft", pattern="^(draft|pending_approval)$")
    metadata: dict[str, Any] = Field(default_factory=dict)


class PublishItemUpdate(BaseModel):
    """Partial update for an editable draft. Omitted fields stay as they are."""

    content: str | None = Field(default=None, max_length=10000)
    media_urls: list[str] | None = Field(default=None, max_length=35)
    post_format: str | None = Field(default=None, max_length=32)
    scheduled_at: datetime | None = None
    metadata: dict[str, Any] | None = None


class PublishItemRead(BaseModel):
    """Draft or approval item returned to the client."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    owner_id: UUID
    content: str
    status: str
    scheduled_at: datetime | None
    media_urls: list[str]
    post_format: str
    metadata_json: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class ApprovalDecision(BaseModel):
    """Approve, request changes, or reject, with an optional comment."""

    decision: str = Field(pattern="^(approved|changes_requested|rejected)$")
    comment: str | None = Field(default=None, max_length=2000)


class MediaAssetRead(BaseModel):
    """One file in the user's media library."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    filename: str
    media_type: str
    size_bytes: int
    public_url: str
    alt_text: str | None
    created_at: datetime


class MediaUploadResponse(BaseModel):
    """Response returned immediately after an uploaded asset is stored."""

    id: UUID
    url: str
    filename: str
    media_type: str
    size_bytes: int


class InternalCommentCreate(BaseModel):
    """Body of a new internal comment on a scheduled post."""

    body: str = Field(min_length=1, max_length=5000)


class InternalCommentRead(BaseModel):
    """Internal comment, including the author's display name."""

    id: UUID
    post_id: UUID
    user_id: UUID
    author_name: str
    body: str
    created_at: datetime


class DraftScheduleRequest(BaseModel):
    """Exact datetime for turning a durable draft into scheduled posts."""

    scheduled_at: datetime


class DraftQueueRequest(BaseModel):
    """Optional timezone hint when placing a draft into queue slots."""

    timezone: str = Field(default="UTC", min_length=1, max_length=64)


class DraftActionResult(BaseModel):
    """Draft conversion summary plus the created scheduled posts count."""

    draft_id: UUID
    status: str
    scheduled_post_ids: list[UUID]
    scheduled_at: datetime | None = None
