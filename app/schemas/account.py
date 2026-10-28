"""Pydantic input and output contracts for connected accounts."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.integrations.platform_catalog import (
    account_type_label,
    connectable_platform_names,
    publishable_platform_names,
)


def _can_publish(platform: str, account_type: str) -> bool:
    if platform not in publishable_platform_names():
        return False
    if platform == "facebook" and account_type in {"login", "user"}:
        return False
    if platform == "pinterest" and account_type == "user":
        return False
    if account_type == "login":
        return False
    return True



class AccountCreate(BaseModel):
    """Validated provider credentials and metadata used to connect an account."""

    platform: str = Field(min_length=1, max_length=40)
    platform_account_id: str = Field(min_length=1, max_length=255)
    account_name: str = Field(min_length=1, max_length=255)
    account_type: str | None = Field(default=None, max_length=40)
    parent_account_id: UUID | None = None
    access_token: str = Field(min_length=1)
    refresh_token: str | None = None
    token_expires_at: datetime | None = None
    scopes: list[str] = Field(default_factory=list)
    extra_metadata: dict = Field(default_factory=dict)

    @field_validator("platform")
    @classmethod
    def platform_must_be_connectable(cls, value: str) -> str:
        normalized = value.strip().lower()
        allowed = connectable_platform_names()
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



def extract_avatar_url(meta: dict | None) -> str | None:
    """Pick a public profile photo URL from provider metadata shapes."""
    if not isinstance(meta, dict):
        return None
    for key in (
        "avatar_url",
        "profile_image_url",
        "profile_picture_url",
        "threads_profile_picture_url",
        "profile_image",
        "picture",
    ):
        value = meta.get(key)
        if isinstance(value, str):
            url = value.strip()
            if url.startswith(("http://", "https://")):
                return url
        if isinstance(value, dict):
            nested = value.get("data") if isinstance(value.get("data"), dict) else value
            if isinstance(nested, dict):
                url = nested.get("url")
                if isinstance(url, str):
                    url = url.strip()
                    if url.startswith(("http://", "https://")):
                        return url
    return None


class AccountRead(BaseModel):
    """Safe public representation of an account without secret tokens."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    platform: str
    platform_account_id: str
    account_name: str
    account_type: str = "user"
    account_type_label: str = ""
    parent_account_id: UUID | None = None
    token_expires_at: datetime | None
    scopes: list[str]
    is_active: bool
    can_publish: bool = False
    created_at: datetime
    extra_metadata: dict = Field(default_factory=dict)
    avatar_url: str | None = None

    @classmethod
    def from_account(cls, account) -> "AccountRead":
        platform = getattr(account, "platform", "") or ""
        account_type = getattr(account, "account_type", None) or "user"
        meta = getattr(account, "extra_metadata", None) or {}
        return cls(
            id=account.id,
            platform=platform,
            platform_account_id=account.platform_account_id,
            account_name=account.account_name,
            account_type=account_type,
            account_type_label=account_type_label(platform, account_type),
            parent_account_id=getattr(account, "parent_account_id", None),
            token_expires_at=account.token_expires_at,
            scopes=list(account.scopes or []),
            is_active=bool(account.is_active),
            can_publish=_can_publish(platform, account_type),
            created_at=account.created_at,
            extra_metadata=meta,
            avatar_url=extract_avatar_url(meta),
        )


class DestinationChoice(BaseModel):
    id: str
    name: str
    account_type: str
    category: str | None = None
    custom_url: str | None = None
    description: str | None = None


class DestinationList(BaseModel):
    platform: str
    pick_session_id: str
    identity: dict = Field(default_factory=dict)
    destinations: list[dict]
    notes: str = ""


class DestinationSave(BaseModel):
    pick_session_id: UUID
    destination_ids: list[str] = Field(min_length=1)
