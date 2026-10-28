"""Social platform credentials and account state."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.scheduled_post import ScheduledPost
    from app.models.user import User

from datetime import datetime
from uuid import UUID

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.models.base import Base, Timestamped, UUIDPrimaryKey


class ConnectedAccount(UUIDPrimaryKey, Timestamped, Base):
    """A user's provider identity and encrypted publishing credentials."""

    __tablename__ = "connected_accounts"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "platform", "platform_account_id", name="uq_connected_account_owner_platform_identity"
        ),
        Index("ix_connected_accounts_user_platform", "user_id", "platform"),
    )
    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    platform: Mapped[str] = mapped_column(String(40), nullable=False)
    platform_account_id: Mapped[str] = mapped_column(String(255), nullable=False)
    account_name: Mapped[str] = mapped_column(String(255), nullable=False)
    account_type: Mapped[str] = mapped_column(String(40), nullable=False, default="user")
    parent_account_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("connected_accounts.id", ondelete="SET NULL"), nullable=True
    )
    access_token_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    refresh_token_ciphertext: Mapped[str | None] = mapped_column(Text)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    scopes: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    extra_metadata: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    user: Mapped["User"] = relationship(back_populates="connected_accounts")
    parent_account: Mapped["ConnectedAccount | None"] = relationship(
        remote_side="ConnectedAccount.id",
        foreign_keys=[parent_account_id],
    )
    scheduled_posts: Mapped[list["ScheduledPost"]] = relationship(back_populates="connected_account")


class OAuthPickSession(UUIDPrimaryKey, Timestamped, Base):
    """Short-lived OAuth result waiting for the user to pick Pages/channels/boards."""

    __tablename__ = "oauth_pick_sessions"
    __table_args__ = (Index("ix_oauth_pick_sessions_user_platform", "user_id", "platform"),)

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    platform: Mapped[str] = mapped_column(String(40), nullable=False)
    access_token_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    refresh_token_ciphertext: Mapped[str | None] = mapped_column(Text)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    scopes: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    identity_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
