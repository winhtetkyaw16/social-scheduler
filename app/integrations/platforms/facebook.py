"""Facebook Pages (and Groups) Graph API publisher."""

from __future__ import annotations

import os

from app.core.exceptions import ProviderConfigurationError
from app.integrations.base import ProviderPublishResult, SocialPlatform, provider_delete, provider_request
from app.integrations.media_urls import guess_media_kind, public_media_url


class FacebookPlatform(SocialPlatform):
    """Publish text, one or more photos, or one video to a Facebook Page or Group."""

    platform = "facebook"
    supports_remote_delete = True

    def publish(self, access_token: str, account_id: str, content: str, media_urls: list[str]) -> ProviderPublishResult:
        if not account_id or not str(account_id).strip():
            raise ProviderConfigurationError(
                "Facebook publishing needs a Page or Group id. Personal profiles are not publishable destinations."
            )
        if not (content or "").strip() and not media_urls:
            raise ProviderConfigurationError("Facebook posts need text and/or an image.")
        version = os.getenv("FACEBOOK_GRAPH_API_VERSION", "v21.0")
        base = f"https://graph.facebook.com/{version}/{account_id}"
        text = (content or "").strip()
        kinds = [guess_media_kind(u) for u in media_urls]

        if "video" in kinds:
            if len(media_urls) > 1:
                raise ProviderConfigurationError(
                    "Facebook posts can have several photos or one video, not a mix. Remove the video or the photos."
                )
            # Graph API: POST /{page-id}/videos with file_url (Facebook fetches the public URL).
            video_url = public_media_url(media_urls[0], platform="Facebook")
            payload: dict = {"file_url": video_url, "published": True}
            if text:
                payload["description"] = content
            response = provider_request("POST", f"{base}/videos", access_token=access_token, json=payload)
            body = response.json()
            post_id = body.get("post_id") or body.get("id")
            if not post_id:
                raise RuntimeError("Facebook accepted the video without returning a video identifier")
            return ProviderPublishResult(post_id=str(post_id), status_code=response.status_code)

        if len(media_urls) == 1:
            image_url = public_media_url(media_urls[0], platform="Facebook")
            payload = {"url": image_url, "published": True}
            if text:
                payload["caption"] = content
            response = provider_request("POST", f"{base}/photos", access_token=access_token, json=payload)
            body = response.json()
            post_id = body.get("post_id") or body.get("id")
            if not post_id:
                raise RuntimeError("Facebook accepted the photo without returning a post identifier")
            return ProviderPublishResult(post_id=str(post_id), status_code=response.status_code)

        if media_urls:
            # Multi-photo: upload each photo unpublished, then one feed post with attached_media.
            photo_ids: list[str] = []
            for url in media_urls:
                body = provider_request(
                    "POST", f"{base}/photos", access_token=access_token,
                    json={"url": public_media_url(url, platform="Facebook"), "published": False},
                ).json()
                if not body.get("id"):
                    raise RuntimeError("Facebook accepted a photo without returning a photo identifier")
                photo_ids.append(str(body["id"]))
            payload = {"attached_media": [{"media_fbid": pid} for pid in photo_ids]}
            if text:
                payload["message"] = content
            response = provider_request("POST", f"{base}/feed", access_token=access_token, json=payload)
            body = response.json()
            post_id = body.get("id")
            if not post_id:
                raise RuntimeError("Facebook accepted the request without returning a post identifier")
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
