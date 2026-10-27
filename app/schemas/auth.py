"""Validation schemas for registration, sign-in, and bearer tokens."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserCreate(BaseModel):
    """Registration input with profile, workspace, and password details."""

    full_name: str = Field(min_length=1, max_length=160)
    workspace_name: str = Field(min_length=1, max_length=160)
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)


class UserLogin(BaseModel):
    """Sign-in credentials."""

    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserOut(BaseModel):
    """Safe public representation of an application user."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    full_name: str
    workspace_name: str
    is_active: bool
    is_verified: bool
    created_at: datetime


class Token(BaseModel):
    """Bearer access token plus a refresh token for silent renewal."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    full_name: str = ""
    workspace_name: str = "My Workspace"


class RefreshRequest(BaseModel):
    """Refresh-token exchange used to mint a new access token."""

    refresh_token: str = Field(min_length=1)
