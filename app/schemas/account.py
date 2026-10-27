"""Pydantic input and output contracts for connected accounts."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class AccountCreate(BaseModel):
    """Validated provider credentials and metadata used to connect an account."""

    platform: str = Field(min_length=1, max_length=40, pattern=r"^(x|facebook|instagram|youtube|tiktok|linkedin|pinterest|threads|telegram|reddit)$")
    platform_account_id: str = Field(min_length=1, max_length=255)
    account_name: str = Field(min_length=1, max_length=255)
    access_token: str = Field(min_length=1)
    refresh_token: str | None = None
    token_expires_at: datetime | None = None
    scopes: list[str] = Field(default_factory=list)

    @field_validator("token_expires_at")
    @classmethod
    def require_timezone_on_expiry(cls, value: datetime | None) -> datetime | None:
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("token_expires_at must include a timezone")
        return value


class AccountRead(BaseModel):
    """Safe public representation of an account without secret tokens."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    platform: str
    platform_account_id: str
    account_name: str
    token_expires_at: datetime | None
    scopes: list[str]
    is_active: bool
    created_at: datetime
