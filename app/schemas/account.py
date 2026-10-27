"""Pydantic input and output contracts for connected accounts."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.integrations.registry import supported_platform_names


class AccountCreate(BaseModel):
    """Validated provider credentials and metadata used to connect an account."""

    platform: str = Field(min_length=1, max_length=40)
    platform_account_id: str = Field(min_length=1, max_length=255)
    account_name: str = Field(min_length=1, max_length=255)
    access_token: str = Field(min_length=1)
    refresh_token: str | None = None
    token_expires_at: datetime | None = None
    scopes: list[str] = Field(default_factory=list)

    @field_validator("platform")
    @classmethod
    def platform_must_have_a_publisher(cls, value: str) -> str:
        normalized = value.strip().lower()
        allowed = supported_platform_names()
        if normalized not in allowed:
            names = ", ".join(sorted(allowed))
            raise ValueError(f"Unsupported platform. Choose one of: {names}")
        return normalized

    @field_validator("token_expires_at")
    @classmethod
    def require_timezone_on_expiry(cls, value: datetime | None) -> datetime | None:
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("token_expires_at must include a timezone")
        return value


class OAuthStart(BaseModel):
    """Browser redirect that begins a provider authorization-code flow."""

    platform: str
    authorization_url: str


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
