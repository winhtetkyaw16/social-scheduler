"""Instagram API publisher adapter."""

import ipaddress
import os
from urllib.parse import urlparse, urlunparse

from app.core.config import PUBLIC_BASE_URL
from app.core.exceptions import ProviderConfigurationError
from app.integrations.base import ProviderPublishResult, SocialPlatform, provider_delete, provider_request

_LOCAL_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal"}


def _host_is_public(hostname: str | None) -> bool:
    if not hostname:
        return False
    host = hostname.strip().lower().rstrip(".")
    if host in _LOCAL_HOSTS or host.endswith(".local") or host.endswith(".localhost"):
        return False
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return True
    return not (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        or address.is_multicast
        or address.is_unspecified
    )


def instagram_image_url(url: str) -> str:
    """Return an image URL Instagram's servers can fetch, or explain why they cannot.

    Relative upload paths and URLs on this app's ``/static/uploads`` path are
    rewritten onto ``PUBLIC_BASE_URL`` when that origin is publicly reachable.
    """
    candidate = url.strip()
    public_base = (os.getenv("PUBLIC_BASE_URL") or PUBLIC_BASE_URL or "").rstrip("/")
    if candidate.startswith("/") and public_base:
        candidate = f"{public_base}{candidate}"
    parsed = urlparse(candidate)
    if parsed.path.startswith("/static/uploads/") and public_base:
        base = urlparse(public_base)
        if _host_is_public(base.hostname):
            parsed = parsed._replace(scheme=base.scheme, netloc=base.netloc)
            candidate = urlunparse(parsed)
    if parsed.scheme not in {"http", "https"} or not _host_is_public(parsed.hostname):
        raise ProviderConfigurationError(
            "Instagram requires a publicly fetchable image URL. Set PUBLIC_BASE_URL to a public "
            "https origin, or attach an image that is already on a public URL."
        )
    return candidate


class InstagramPlatform(SocialPlatform):
    """Publish supported image posts through the Instagram API with Instagram Login."""

    platform = "instagram"
    supports_remote_delete = True

    def publish(self, access_token: str, account_id: str, content: str, media_urls: list[str]) -> ProviderPublishResult:
        """Create a media container, publish it, and return Instagram's ID."""
        if len(media_urls) != 1:
            raise ProviderConfigurationError("Instagram publishing currently requires exactly one public image URL")
        image_url = instagram_image_url(media_urls[0])
        version = os.getenv("INSTAGRAM_GRAPH_API_VERSION", "v24.0")
        base = f"https://graph.instagram.com/{version}/{account_id}"
        container = provider_request(
            "POST", f"{base}/media", access_token=access_token, json={"image_url": image_url, "caption": content}
        ).json()
        creation_id = container.get("id")
        if not creation_id:
            raise RuntimeError("Instagram did not return a media container identifier")
        result = provider_request(
            "POST", f"{base}/media_publish", access_token=access_token, json={"creation_id": creation_id}
        ).json()
        post_id = result.get("id")
        if not post_id:
            raise RuntimeError("Instagram did not return a published media identifier")
        return ProviderPublishResult(post_id=str(post_id), status_code=200)


    def delete(self, access_token: str, provider_post_id: str) -> None:
        """Delete published Instagram media."""
        media_id = (provider_post_id or "").strip()
        if not media_id:
            raise ProviderConfigurationError("Instagram delete needs a provider media id.")
        version = os.getenv("INSTAGRAM_GRAPH_API_VERSION", "v24.0")
        provider_delete(f"https://graph.instagram.com/{version}/{media_id}", access_token=access_token)
