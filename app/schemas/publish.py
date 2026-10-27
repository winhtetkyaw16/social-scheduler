"""Contracts for drafts, library assets, and approval workflow."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PublishItemCreate(BaseModel):
    content: str = Field(default="", max_length=10000)
    media_urls: list[str] = Field(default_factory=list, max_length=10)
    post_format: str = Field(default="Post", max_length=32)
    scheduled_at: datetime | None = None
    status: str = Field(default="draft", pattern="^(draft|pending_approval)$")
    metadata: dict[str, Any] = Field(default_factory=dict)


class PublishItemUpdate(BaseModel):
    content: str | None = Field(default=None, max_length=10000)
    media_urls: list[str] | None = Field(default=None, max_length=10)
    post_format: str | None = Field(default=None, max_length=32)
    scheduled_at: datetime | None = None
    metadata: dict[str, Any] | None = None


class PublishItemRead(BaseModel):
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
    decision: str = Field(pattern="^(approved|changes_requested|rejected)$")
    comment: str | None = Field(default=None, max_length=2000)


class MediaAssetRead(BaseModel):
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
    body: str = Field(min_length=1, max_length=5000)


class InternalCommentRead(BaseModel):
    id: UUID
    post_id: UUID
    user_id: UUID
    author_name: str
    body: str
    created_at: datetime
