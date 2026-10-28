"""Facebook Pages (and Groups) Graph API publisher."""

from __future__ import annotations

import os

from app.core.exceptions import ProviderConfigurationError
from app.integrations.base import ProviderPublishResult, SocialPlatform, provider_delete, provider_request
from app.integrations.media_urls import guess_media_kind, public_media_url


class FacebookPlatform(SocialPlatform):
    """Publish text and/or one photo to a Facebook Page or Group feed."""

    platform = "facebook"
    supports_remote_delete = True

    def publish(self, access_token: str, account_id: str, content: str, media_urls: list[str]) -> ProviderPublishResult:
        if not account_id or not str(account_id).strip():
            raise ProviderConfigurationError(
                "Facebook publishing needs a Page or Group id. Personal profiles are not publishable destinations."
            )
        if not (content or "").strip() and not media_urls:
            raise ProviderConfigurationError("Facebook posts need text and/or an image.")
        if len(media_urls) > 1:
            raise ProviderConfigurationError(
                "Facebook publishing currently supports one image (or text-only). Multi-photo posts are not implemented yet."
            )
        version = os.getenv("FACEBOOK_GRAPH_API_VERSION", "v21.0")
        base = f"https://graph.facebook.com/{version}/{account_id}"

        if media_urls:
            kind = guess_media_kind(media_urls[0])
            if kind == "video":
                raise ProviderConfigurationError(
                    "Facebook Page video upload is not implemented yet. Attach one image, or post text only."
                )
            image_url = public_media_url(media_urls[0], platform="Facebook")
            payload: dict = {"url": image_url, "published": True}
            if (content or "").strip():
                payload["caption"] = content
            response = provider_request("POST", f"{base}/photos", access_token=access_token, json=payload)
            body = response.json()
            post_id = body.get("post_id") or body.get("id")
            if not post_id:
                raise RuntimeError("Facebook accepted the photo without returning a post identifier")
            return ProviderPublishResult(post_id=str(post_id), status_code=response.status_code)

        response = provider_request(
            "POST", f"{base}/feed", access_token=access_token, json={"message": content}
        )
        body = response.json()
        post_id = body.get("id")
        if not post_id:
            raise RuntimeError("Facebook accepted the request without returning a post identifier")
        return ProviderPublishResult(post_id=str(post_id), status_code=response.status_code)


    def delete(self, access_token: str, provider_post_id: str) -> None:
        """Delete a Page/Group post via Graph API."""
        post_id = (provider_post_id or "").strip()
        if not post_id:
            raise ProviderConfigurationError("Facebook delete needs a provider post id.")
        version = os.getenv("FACEBOOK_GRAPH_API_VERSION", "v21.0")
        provider_delete(f"https://graph.facebook.com/{version}/{post_id}", access_token=access_token)
