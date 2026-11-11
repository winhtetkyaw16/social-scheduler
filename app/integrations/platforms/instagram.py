"""Instagram API publisher adapter."""

import logging
import os
import time

from app.core.exceptions import ProviderConfigurationError
from app.integrations.base import (
    ProviderPublishResult,
    SocialPlatform,
    provider_delete,
    provider_request,
)
from app.integrations.media_urls import guess_media_kind, public_media_url
from app.services.post_formats import POST, REEL, STORY

logger = logging.getLogger(__name__)


def instagram_image_url(url: str) -> str:
    """Return a media URL Instagram's servers can fetch.

    Relative ``/media`` and ``/static/uploads`` paths are rewritten by
    ``public_media_url`` onto ``PUBLIC_BASE_URL``.
    """
    return public_media_url(url, platform="Instagram")


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

    def publish(
        self,
        access_token: str,
        account_id: str,
        content: str,
        media_urls: list[str],
        settings: dict | None = None,
        format: str | None = None,
    ) -> ProviderPublishResult:
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

        alt_text = str((settings or {}).get("alt_text") or "").strip()[:1000]

        def image_body(body: dict) -> dict:
            # alt_text: image containers only (single image or carousel image item), not Reels/videos.
            return {**body, "alt_text": alt_text} if alt_text else body

        def create(body: dict) -> str:
            data = provider_request(
                "POST", f"{base}/media", access_token=access_token, json=body
            ).json()
            container_id = data.get("id")
            if not container_id:
                raise RuntimeError(
                    "Instagram did not return a media container identifier"
                )
            return str(container_id)

        fmt = (format or "").strip()
        # Story and Reel are their own containers. They must not become a feed image, a carousel, or share_to_feed.
        if fmt == STORY:
            if len(media_urls) != 1:
                raise ProviderConfigurationError(
                    "An Instagram Story needs one photo or one video. It was not published to the feed."
                )
            url = media_urls[0]
            if _is_video(url):
                creation_id = create(
                    {
                        "media_type": "STORIES",
                        "video_url": instagram_image_url(url),
                    }
                )
                _wait_for_container(graph, access_token, creation_id, "Story")
            else:
                creation_id = create(
                    {
                        "media_type": "STORIES",
                        "image_url": instagram_image_url(url),
                    }
                )
        elif fmt == REEL:
            if len(media_urls) != 1 or not _is_video(media_urls[0]):
                raise ProviderConfigurationError(
                    "An Instagram Reel needs exactly one video. It was not published as a carousel or feed post."
                )
            creation_id = create(
                {
                    "media_type": "REELS",
                    "video_url": instagram_image_url(media_urls[0]),
                    "caption": content,
                    "share_to_feed": True,
                }
            )
            _wait_for_container(graph, access_token, creation_id, "Reel")
        elif fmt not in {"", POST}:
            raise ProviderConfigurationError(
                f"{fmt} is not available for Instagram. Choose Post, Reel, or Story. Nothing was published."
            )
        elif len(media_urls) == 1:
            url = media_urls[0]
            if _is_video(url):
                # Instagram's content publishing API has no separate feed-video type.
                # A Post with one video is a Reel that is also shared to the feed. A Story never takes this path.
                creation_id = create(
                    {
                        "media_type": "REELS",
                        "video_url": instagram_image_url(url),
                        "caption": content,
                        "share_to_feed": True,
                    }
                )
                _wait_for_container(graph, access_token, creation_id, "Reel")
            else:
                creation_id = create(
                    image_body(
                        {"image_url": instagram_image_url(url), "caption": content}
                    )
                )
        else:
            public = [instagram_image_url(u) for u in media_urls]
            children: list[str] = []
            for url in public:
                if _is_video(url):
                    child = create(
                        {
                            "media_type": "VIDEO",
                            "video_url": url,
                            "is_carousel_item": True,
                        }
                    )
                    _wait_for_container(graph, access_token, child, "carousel video")
                else:
                    child = create(
                        image_body({"image_url": url, "is_carousel_item": True})
                    )
                children.append(child)
            creation_id = create(
                {
                    "media_type": "CAROUSEL",
                    "children": ",".join(children),
                    "caption": content,
                }
            )
            _wait_for_container(graph, access_token, creation_id, "carousel")

        result = provider_request(
            "POST",
            f"{base}/media_publish",
            access_token=access_token,
            json={"creation_id": creation_id},
        ).json()
        post_id = result.get("id")
        if not post_id:
            raise RuntimeError("Instagram did not return a published media identifier")
        if (settings or {}).get("disable_comments") is True:
            # IG Media update: POST /{ig-media-id}?comment_enabled=false. Best effort, the post is live.
            try:
                provider_request(
                    "POST",
                    f"{graph}/{post_id}",
                    access_token=access_token,
                    json={"comment_enabled": False},
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "Instagram comment_enabled update failed for %s: %s",
                    post_id,
                    type(exc).__name__,
                )
        return ProviderPublishResult(post_id=str(post_id), status_code=200)

    def delete(self, access_token: str, provider_post_id: str) -> None:
        """Delete published Instagram media."""
        media_id = (provider_post_id or "").strip()
        if not media_id:
            raise ProviderConfigurationError(
                "Instagram delete needs a provider media id."
            )
        version = os.getenv("INSTAGRAM_GRAPH_API_VERSION", "v24.0")
        provider_delete(
            f"https://graph.facebook.com/{version}/{media_id}",
            access_token=access_token,
        )


def _wait_for_container(
    graph: str, access_token: str, container_id: str, what: str
) -> None:
    """Poll GET /{container_id}?fields=status_code until FINISHED; raise a clear error otherwise."""
    deadline = _clock() + POLL_TIMEOUT_SECONDS
    while True:
        body = provider_request(
            "GET",
            f"{graph}/{container_id}?fields=status_code,status",
            access_token=access_token,
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
