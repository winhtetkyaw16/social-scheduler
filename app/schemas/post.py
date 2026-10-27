"""Pydantic request and response contracts for scheduled posts."""

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator


class PostCreate(BaseModel):
    """Data required to create a post for one connected account."""

    connected_account_id: UUID
    content: str = Field(min_length=1, max_length=10000)
    media_urls: list[HttpUrl] = Field(default_factory=list, max_length=10)
    scheduled_at: datetime
    idempotency_key: str = Field(min_length=1, max_length=128)
    post_metadata: dict[str, Any] = Field(default_factory=dict)


class PostUpdate(BaseModel):
    """Partial changes accepted for an editable post."""

    connected_account_id: UUID | None = None
    content: str | None = Field(default=None, min_length=1, max_length=10000)
    media_urls: list[HttpUrl] | None = Field(default=None, max_length=10)
    scheduled_at: datetime | None = None
    post_metadata: dict[str, Any] | None = None


class PostRead(BaseModel):
    """Serialized post lifecycle, timestamps, and analytics metadata."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    connected_account_id: UUID
    content: str
    media_urls: list[str]
    scheduled_at: datetime
    status: str
    attempt_count: int
    max_attempts: int
    idempotency_key: str
    provider_post_id: str | None
    published_at: datetime | None
    last_error_code: str | None
    last_error_message: str | None
    post_metadata: dict[str, Any]
    latest_execution_outcome: str | None = None
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="wrap")
    @classmethod
    def default_missing_execution_outcome(cls, value, handler):
        """ORM rows created before a log summary was attached still serialize."""
        if value is not None and not isinstance(value, dict) and not hasattr(value, "latest_execution_outcome"):
            try:
                setattr(value, "latest_execution_outcome", None)
            except Exception:
                pass
        return handler(value)

    @field_validator("scheduled_at", "published_at", mode="before")
    @classmethod
    def attach_utc_to_naive_timestamps(cls, value: datetime | None) -> datetime | None:
        # SQLite drops timezone metadata from DateTime columns. These stored
        # values are UTC, so restore the offset before serializing the response.
        if isinstance(value, datetime) and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
