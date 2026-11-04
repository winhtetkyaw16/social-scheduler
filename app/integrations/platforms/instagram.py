"""Instagram API publisher adapter."""

import ipaddress
import os
import time
from urllib.parse import urlparse, urlunparse

from app.core.config import PUBLIC_BASE_URL
from app.core.exceptions import ProviderConfigurationError
from app.integrations.media_urls import guess_media_kind
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
            "Instagram requires a publicly fetchable media URL (photos and videos). Set PUBLIC_BASE_URL to a public "
            "https origin, or attach an image that is already on a public URL."
        )
    return candidate


# Container polling (Meta: video/carousel containers must reach FINISHED before media_publish).
# Module-level so tests can patch them; no real sleeping in tests.
POLL_INTERVAL_SECONDS = 5.0
POLL_TIMEOUT_SECONDS = 300.0
MAX_CAROUSEL_ITEMS = 20
_sleep = time.sleep
_clock = time.monotonic


def _is_video(url: str) -> bool:
    return guess_media_kind(url) == "video"


class InstagramPlatform(SocialPlatform):
    """Publish photos, Reels (one video) and carousels (2-20 items) via the Instagram Graph API."""

    platform = "instagram"
    supports_remote_delete = True

    def publish(self, access_token: str, account_id: str, content: str, media_urls: list[str]) -> ProviderPublishResult:
        """Create the right media container(s), wait for processing, publish, and return Instagram's ID."""
        if not media_urls:
            raise ProviderConfigurationError(
                "Instagram needs at least one image or video; caption-only posts are not supported."
            )
        if len(media_urls) > MAX_CAROUSEL_ITEMS:
            raise ProviderConfigurationError(
                f"Instagram carousels can have at most {MAX_CAROUSEL_ITEMS} items (this post has {len(media_urls)})."
            )
        version = os.getenv("INSTAGRAM_GRAPH_API_VERSION", "v24.0")
        graph = f"https://graph.facebook.com/{version}"
        base = f"{graph}/{account_id}"

        def create(body: dict) -> str:
            data = provider_request("POST", f"{base}/media", access_token=access_token, json=body).json()
            container_id = data.get("id")
            if not container_id:
                raise RuntimeError("Instagram did not return a media container identifier")
            return str(container_id)

        if len(media_urls) == 1:
            url = media_urls[0]
            if _is_video(url):
                creation_id = create({
                    "media_type": "REELS",
                    "video_url": instagram_image_url(url),
                    "caption": content,
                    "share_to_feed": True,
                })
                _wait_for_container(graph, access_token, creation_id, "Reel")
            else:
                creation_id = create({"image_url": instagram_image_url(url), "caption": content})
        else:
            public = [instagram_image_url(u) for u in media_urls]
            children: list[str] = []
            for url in public:
                if _is_video(url):
                    child = create({"media_type": "VIDEO", "video_url": url, "is_carousel_item": True})
                    _wait_for_container(graph, access_token, child, "carousel video")
                else:
                    child = create({"image_url": url, "is_carousel_item": True})
                children.append(child)
            creation_id = create({"media_type": "CAROUSEL", "children": ",".join(children), "caption": content})
            _wait_for_container(graph, access_token, creation_id, "carousel")

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
        provider_delete(f"https://graph.facebook.com/{version}/{media_id}", access_token=access_token)


def _wait_for_container(graph: str, access_token: str, container_id: str, what: str) -> None:
    """Poll GET /{container_id}?fields=status_code until FINISHED; raise a clear error otherwise."""
    deadline = _clock() + POLL_TIMEOUT_SECONDS
    while True:
        body = provider_request(
            "GET", f"{graph}/{container_id}?fields=status_code,status", access_token=access_token
        ).json()
        state = str(body.get("status_code") or "").upper()
        if state in {"FINISHED", "PUBLISHED"}:
            return
        if state == "ERROR":
            detail = str(body.get("status") or "").strip()
            raise ProviderConfigurationError(
                f"Instagram could not process the {what} (processing error{': ' + detail if detail else ''}). "
                "Check the video format (MP4/MOV, H.264, 3 s to 15 min, up to 300 MB)."
            )
        if state == "EXPIRED":
            raise ProviderConfigurationError(
                f"Instagram processing expired for the {what} container. Publish again to create a new one."
            )
        if _clock() >= deadline:
            raise ProviderConfigurationError(
                f"Instagram is still processing the {what} after {int(POLL_TIMEOUT_SECONDS)}s. "
                "Try a smaller or shorter video, or publish again shortly."
            )
        _sleep(POLL_INTERVAL_SECONDS)
