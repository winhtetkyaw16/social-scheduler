"""Sentences shown in the product.

Do not mention credits, APIs, permissions, or scopes here. Those words stay in
logs, code comments, and the pull request description.
"""

from __future__ import annotations

from app.services.error_messages import network_name

X_UNAVAILABLE_CODE = "x_unavailable"


def comments_unavailable(network: str | None) -> str:
    """Shown when a network cannot provide comments or replies."""
    return f"Comments from {network_name(network)} aren't available in SocialCastly yet"


def insights_unavailable(network: str | None) -> str:
    """Shown when a network cannot provide post insights."""
    return f"Insights from {network_name(network)} aren't available in SocialCastly yet"


def hide_unavailable(network: str | None) -> str:
    """Shown when hiding a reply is not available."""
    return f"Hiding replies from {network_name(network)} isn't available in SocialCastly yet"


def reconnect_for_comments(network: str | None) -> str:
    """Shown when an account must be connected again before comments or insights work."""
    return f"Reconnect your {network_name(network)} account to see comments and insights"
