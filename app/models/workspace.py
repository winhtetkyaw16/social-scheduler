"""Workspace containers owned by application users."""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.models.base import Base, Timestamped, UUIDPrimaryKey

if TYPE_CHECKING:
    from app.models.user import User


class Workspace(UUIDPrimaryKey, Timestamped, Base):
    """Default workspace created for each registered user."""

    __tablename__ = "workspaces"

    name: Mapped[str] = mapped_column(String(160), nullable=False)
    owner_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    owner: Mapped["User"] = relationship(back_populates="workspaces")
