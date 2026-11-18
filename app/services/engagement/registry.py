"""Engagement providers keyed by network.

LinkedIn stays unsupported. TikTok comments stay unsupported. TikTok video
counts are constructed per lookup so ``TIKTOK_ENABLE_VIDEO_LIST`` is current.
"""

from __future__ import annotations

from app.services.engagement.base import EngagementProvider, UnsupportedEngagementProvider
from app.services.engagement.providers.blocked import LinkedInEngagement, TikTokEngagement
from app.services.engagement.providers.facebook import FacebookEngagement
from app.services.engagement.providers.instagram import InstagramEngagement
from app.services.engagement.providers.pinterest import PinterestEngagement
from app.services.engagement.providers.threads import ThreadsEngagement
from app.services.engagement.providers.x import XEngagement
from app.services.engagement.providers.youtube import YouTubeEngagement

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
    "facebook": FacebookEngagement(),
    "instagram": InstagramEngagement(),
    "threads": ThreadsEngagement(),
    "x": XEngagement(),
    "linkedin": LinkedInEngagement(),
    "youtube": YouTubeEngagement(),
    "pinterest": PinterestEngagement(),
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
    """Return the provider for a network. Unknown networks are not supported."""
    key = canonical_network(network)
    if key == "tiktok":
        return TikTokEngagement()
    provider = _PROVIDERS.get(key)
    if provider is not None:
        return provider
    return UnsupportedEngagementProvider(key or "unknown")
