"""Engagement providers keyed by network.

Every network SocialCastly can publish to is registered. Each one is a
not-supported stub until a follow-up confirms the API and the OAuth scopes
already requested at connect time. This module does not change those scopes.
"""

from __future__ import annotations

from app.services.engagement.base import EngagementProvider, UnsupportedEngagementProvider

# Stable product order. "twitter" is accepted as an alias of "x" at lookup time.
NETWORKS: tuple[str, ...] = (
    "facebook",
    "instagram",
    "threads",
    "x",
    "linkedin",
    "youtube",
    "tiktok",
    "pinterest",
)

_PROVIDERS: dict[str, EngagementProvider] = {
    network: UnsupportedEngagementProvider(network) for network in NETWORKS
}


def canonical_network(network: str | None) -> str:
    """Lower-case network id. The legacy ``twitter`` name maps to ``x``."""
    key = (network or "").strip().lower()
    if key == "twitter":
        return "x"
    return key


def supported_networks() -> tuple[str, ...]:
    """Networks that have an engagement provider entry, in product order."""
    return NETWORKS


def get_engagement_provider(network: str | None) -> EngagementProvider:
    """Return the provider for a network. Unknown networks are also not supported."""
    key = canonical_network(network)
    provider = _PROVIDERS.get(key)
    if provider is not None:
        return provider
    return UnsupportedEngagementProvider(key or "unknown")
