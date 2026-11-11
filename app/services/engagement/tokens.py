"""Refresh and reconnect checks shared by the engagement sweep and reply API.

Uses the same per-account refresh as publishing. Nothing here logs token values.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy.orm import Session

from app.services.engagement.base import AccountUnavailable, ReconnectRequired
from app.services.error_messages import network_name
from app.services.token_refresh import PUBLISH_LEEWAY_SECONDS, refresh_connected_account


def reconnect_message(account) -> str:
    """Plain-language reason the user must connect this account again."""
    reason = (getattr(account, "reconnect_reason", None) or "").strip()
    if reason:
        return reason
    name = network_name(getattr(account, "platform", None))
    return f"Reconnect {name} before SocialCastly can read comments or insights."


def prepare_account(db: Session, account) -> None:
    """Refresh a token that is near expiry, then refuse accounts that need a reconnect.

    ``refresh_connected_account`` commits token changes itself and never raises for
    a provider error. A permanent failure sets ``needs_reconnect`` on the row.
    """
    if account is None or not getattr(account, "is_active", False):
        raise AccountUnavailable("This connected account is not active.")
    if getattr(account, "needs_reconnect", False):
        raise ReconnectRequired(reconnect_message(account))
    refresh_connected_account(
        db,
        account,
        window=timedelta(seconds=PUBLISH_LEEWAY_SECONDS),
    )
    db.refresh(account)
    if getattr(account, "needs_reconnect", False):
        raise ReconnectRequired(reconnect_message(account))
