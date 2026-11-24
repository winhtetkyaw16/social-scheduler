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
        from app.services.engagement.copy import reconnect_for_comments

        if account.platform != "facebook" or account.reconnect_reason != reconnect_for_comments("facebook"):
            raise ReconnectRequired(reconnect_message(account))
        # Older versions flagged a whole Page for a single missing post.
        # Only clear that legacy flag after the saved token can read its own Page.
        from app.core.security import decrypt_token
        from app.services.engagement.providers.facebook import _graph
        from app.services.engagement.http import request_json

        token = decrypt_token(account.access_token_ciphertext)
        identity = request_json("GET", _graph("me"), access_token=token, params={"fields": "id"})
        if str(identity.get("id") or "") != account.platform_account_id:
            raise ReconnectRequired(reconnect_message(account))
        page = request_json("GET", _graph(f"{account.platform_account_id}/published_posts"),
                            access_token=token, params={"fields": "id", "limit": "1"})
        if not isinstance(page.get("data"), list):
            raise ReconnectRequired(reconnect_message(account))
        account.needs_reconnect = False
        account.reconnect_reason = None
        db.commit()
    refresh_connected_account(
        db,
        account,
        window=timedelta(seconds=PUBLISH_LEEWAY_SECONDS),
    )
    db.refresh(account)
    if getattr(account, "needs_reconnect", False):
        raise ReconnectRequired(reconnect_message(account))
