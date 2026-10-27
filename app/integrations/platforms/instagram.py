"""Instagram Graph API publisher adapter."""

import os

from app.core.exceptions import ProviderConfigurationError
from app.integrations.base import ProviderPublishResult, SocialPlatform, provider_request


class InstagramPlatform(SocialPlatform):
    """Publish supported image posts through the Instagram Graph API."""

    platform = "instagram"

    def publish(self, access_token: str, account_id: str, content: str, media_urls: list[str]) -> ProviderPublishResult:
        """Create a media container, publish it, and return Instagram's ID."""
        if len(media_urls) != 1:
            raise ProviderConfigurationError("Instagram publishing currently requires exactly one public image URL")
        version = os.getenv("INSTAGRAM_GRAPH_API_VERSION", "v24.0")
        base = f"https://graph.facebook.com/{version}/{account_id}"
        container = provider_request(
            "POST", f"{base}/media", access_token=access_token, json={"image_url": media_urls[0], "caption": content}
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
