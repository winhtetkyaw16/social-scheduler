"""Backward compatible spelling; use app.services.publishing."""

from app.services.publishing import PublishingError, PublishResult, publish

__all__ = ["PublishResult", "PublishingError", "publish"]
