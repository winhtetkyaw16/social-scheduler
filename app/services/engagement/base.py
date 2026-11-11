"""Network-agnostic contract for comments, replies, and post insights.

Real network clients come later. Until then every registered network uses the
default methods, which raise ``NotSupported``. Callers check ``capabilities``
first so a sweep can skip work the network cannot do.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Mapping

# Capability keys shared by the registry, the API, and required-scope checks.
CAPABILITY_COMMENTS_READ = "comments_read"
CAPABILITY_COMMENT_REPLY = "comment_reply"
CAPABILITY_INSIGHTS = "insights"
CAPABILITY_KEYS = (
    CAPABILITY_COMMENTS_READ,
    CAPABILITY_COMMENT_REPLY,
    CAPABILITY_INSIGHTS,
)


class NotSupported(Exception):
    """The network has no implementation for this engagement capability."""

    def __init__(self, network: str, capability: str):
        self.network = network
        self.capability = capability
        super().__init__(f"{network} does not support {capability}")


class ReconnectRequired(Exception):
    """The account must be connected again before SocialCastly can call the network."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class AccountUnavailable(Exception):
    """The connected account is missing or inactive."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


@dataclass(frozen=True)
class EngagementCapabilities:
    """What one network can do, and which OAuth scopes each capability needs.

    ``required_scopes`` is keyed by capability (``comments_read``,
    ``comment_reply``, ``insights``). An empty map means nothing extra has been
    confirmed. This PR does not add scopes to the OAuth connect flow.
    """

    supports_comments_read: bool = False
    supports_comment_reply: bool = False
    supports_insights: bool = False
    required_scopes: Mapping[str, tuple[str, ...]] = field(default_factory=dict)

    def scopes_for(self, capability: str) -> tuple[str, ...]:
        values = self.required_scopes.get(capability) or ()
        return tuple(values)


@dataclass(frozen=True)
class ProviderComment:
    """One comment returned by a network, before it is stored."""

    provider_comment_id: str
    text: str = ""
    author_name: str | None = None
    author_handle: str | None = None
    author_avatar_url: str | None = None
    author_provider_id: str | None = None
    created_at_provider: datetime | None = None
    provider_parent_id: str | None = None
    provider_thread_root_id: str | None = None
    is_own: bool = False
    hidden: bool = False
    deleted: bool = False
    raw: dict[str, Any] | None = None


@dataclass(frozen=True)
class ProviderReply:
    """Provider id of a reply SocialCastly just posted."""

    provider_comment_id: str
    raw: dict[str, Any] | None = None


@dataclass(frozen=True)
class ProviderInsights:
    """Metrics a network reported for one post. Leave unknown metrics as None."""

    impressions: int | None = None
    reach: int | None = None
    likes: int | None = None
    comments: int | None = None
    shares: int | None = None
    saves: int | None = None
    clicks: int | None = None
    video_views: int | None = None
    engagement_rate: float | None = None
    raw: dict[str, Any] | None = None


class EngagementProvider:
    """Fetch comments, post a reply, and read insights for one network.

    ``account`` is a ``ConnectedAccount`` and ``post`` is a ``ScheduledPost``.
    ``comment`` on reply is a stored ``PostComment``. Implementations should
    call ``access_token`` rather than decrypting tokens themselves.
    """

    network: str = "unknown"
    capabilities: EngagementCapabilities = EngagementCapabilities()

    def fetch_comments(self, account, post, since: datetime | None = None) -> list[ProviderComment]:
        """Return comments created or updated since ``since`` (None means a full read)."""
        raise NotSupported(self.network, CAPABILITY_COMMENTS_READ)

    def reply_to_comment(self, account, comment, text: str) -> ProviderReply:
        """Post ``text`` as a reply to ``comment`` and return the new provider id."""
        raise NotSupported(self.network, CAPABILITY_COMMENT_REPLY)

    def fetch_insights(self, account, post) -> ProviderInsights:
        """Return the latest metrics the network exposes for ``post``."""
        raise NotSupported(self.network, CAPABILITY_INSIGHTS)

    def access_token(self, account) -> str:
        """Decrypt the current access token after the caller has refreshed it.

        Raises ``ReconnectRequired`` when the account is flagged. Does not refresh
        by itself; the sync and reply paths call ``prepare_account`` first.
        """
        from app.core.security import decrypt_token
        from app.services.engagement.tokens import reconnect_message

        if getattr(account, "needs_reconnect", False) or not getattr(account, "is_active", True):
            raise ReconnectRequired(reconnect_message(account))
        ciphertext = getattr(account, "access_token_ciphertext", None)
        if not ciphertext:
            raise ReconnectRequired(reconnect_message(account))
        return decrypt_token(ciphertext)


class UnsupportedEngagementProvider(EngagementProvider):
    """Placeholder used until a network's API and scopes are confirmed."""

    def __init__(self, network: str):
        self.network = (network or "unknown").strip().lower() or "unknown"
        self.capabilities = EngagementCapabilities()
