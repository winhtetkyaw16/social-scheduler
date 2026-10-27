"""Registry that maps provider identifiers to adapter implementations."""

from app.core.exceptions import ProviderConfigurationError
from app.integrations.base import SocialPlatform
from app.integrations.platforms.instagram import InstagramPlatform
from app.integrations.platforms.linkedin import LinkedInPlatform
from app.integrations.platforms.x import XPlatform

_PROVIDERS = {"instagram": InstagramPlatform, "linkedin": LinkedInPlatform, "x": XPlatform}


def supported_platform_names() -> frozenset[str]:
    """Return platform ids that have a publisher adapter."""
    return frozenset(_PROVIDERS)


def get_platform(name: str) -> SocialPlatform:
    """Instantiate the adapter registered for a platform name."""
    try:
        return _PROVIDERS[name.lower()]()
    except KeyError as exc:
        raise ProviderConfigurationError(f"Unsupported social platform: {name}") from exc
