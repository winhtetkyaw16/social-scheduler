"""Registry that maps provider identifiers to adapter implementations."""

from app.core.exceptions import ProviderConfigurationError
from app.integrations.base import SocialPlatform
from app.integrations.platform_catalog import publishable_platform_names
from app.integrations.platforms.facebook import FacebookPlatform
from app.integrations.platforms.instagram import InstagramPlatform
from app.integrations.platforms.linkedin import LinkedInPlatform
from app.integrations.platforms.pinterest import PinterestPlatform
from app.integrations.platforms.threads import ThreadsPlatform
from app.integrations.platforms.tiktok import TikTokPlatform
from app.integrations.platforms.x import XPlatform
from app.integrations.platforms.youtube import YouTubePlatform

_PROVIDERS = {
    "instagram": InstagramPlatform,
    "linkedin": LinkedInPlatform,
    "x": XPlatform,
    "facebook": FacebookPlatform,
    "youtube": YouTubePlatform,
    "tiktok": TikTokPlatform,
    "pinterest": PinterestPlatform,
    "threads": ThreadsPlatform,
}


def supported_platform_names() -> frozenset[str]:
    """Return platform ids that have a publisher adapter (can schedule/publish)."""
    return publishable_platform_names()


def get_platform(name: str) -> SocialPlatform:
    """Instantiate the adapter registered for a platform name."""
    try:
        return _PROVIDERS[name.lower()]()
    except KeyError as exc:
        raise ProviderConfigurationError(f"Unsupported social platform: {name}") from exc
