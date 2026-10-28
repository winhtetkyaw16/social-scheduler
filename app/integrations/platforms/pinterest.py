"""Pinterest Pins API v5 publisher."""

from __future__ import annotations

from app.core.exceptions import ProviderConfigurationError
from app.integrations.base import ProviderPublishResult, SocialPlatform, provider_request
from app.integrations.media_urls import guess_media_kind, public_media_url


class PinterestPlatform(SocialPlatform):
    """Create a Pin on a connected Board from a public image URL."""

    platform = "pinterest"

    def publish(self, access_token: str, account_id: str, content: str, media_urls: list[str]) -> ProviderPublishResult:
        board_id = (account_id or "").strip()
        if not board_id:
            raise ProviderConfigurationError(
                "Pinterest publishing needs a Board id. Connect again and select a Board (user identity alone is not pin-able)."
            )
        if not media_urls:
            raise ProviderConfigurationError("Pinterest Pins require exactly one image URL.")
        if len(media_urls) != 1:
            raise ProviderConfigurationError("Pinterest publishing currently supports exactly one image per Pin.")
        if guess_media_kind(media_urls[0]) == "video":
            raise ProviderConfigurationError(
                "Pinterest video Pins need a separate media upload flow that is not implemented yet. Use one image."
            )
        image_url = public_media_url(media_urls[0], platform="Pinterest")
        title = (content or "").strip()
        description = title
        if len(title) > 100:
            title = title[:100]
        if len(description) > 800:
            description = description[:800]
        payload = {
            "board_id": board_id,
            "media_source": {"source_type": "image_url", "url": image_url},
        }
        if title:
            payload["title"] = title
            payload["description"] = description
        response = provider_request("POST", "https://api.pinterest.com/v5/pins", access_token=access_token, json=payload)
        body = response.json()
        pin_id = body.get("id")
        if not pin_id:
            raise RuntimeError("Pinterest accepted the request without returning a Pin identifier")
        return ProviderPublishResult(post_id=str(pin_id), status_code=response.status_code)
