"""Compatibility exports for the shared SQLAlchemy declarative metadata."""

from app.models.base import Base, Timestamped, UUIDPrimaryKey, utc_now

__all__ = ["Base", "Timestamped", "UUIDPrimaryKey", "utc_now"]
