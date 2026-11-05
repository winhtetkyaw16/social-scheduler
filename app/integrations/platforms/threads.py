"""Meta Threads API publisher (text, single image/video, and carousels of 2-20 items)."""

from __future__ import annotations

import os
import time

import httpx

from app.core.exceptions import ProviderConfigurationError
from app.integrations.base import ProviderPublishResult, SocialPlatform, provider_delete, provider_request
from app.integrations.media_urls import guess_media_kind, public_media_url


MAX_CAROUSEL_ITEMS = 20
_sleep = time.sleep

# Popover label -> Threads reply_control (POST /{threads-user-id}/threads). "Everyone" omits it (API default).
THREADS_REPLY_CONTROL = {
    "Everyone": "everyone",
    "Accounts you follow": "accounts_you_follow",
    "Only accounts you mention": "mentioned_only",
    "Followers only": "followers_only",
}


def threads_reply_control(settings: dict | None) -> str | None:
    value = THREADS_REPLY_CONTROL.get(str((settings or {}).get("reply_control") or "Everyone"))
    return None if value in (None, "everyone") else value


class ThreadsPlatform(SocialPlatform):
    """Create a Threads media container, then publish it."""

    platform = "threads"
    supports_remote_delete = True

    def publish(
        self, access_token: str, account_id: str, content: str, media_urls: list[str], settings: dict | None = None
    ) -> ProviderPublishResult:
        if not account_id or not str(account_id).strip():
            raise ProviderConfigurationError("Threads publishing needs a Threads profile id from OAuth connect.")
        text = (content or "").strip()
        if len(text) > 500:
            raise ProviderConfigurationError("Threads text posts are limited to 500 characters.")
        if not text and not media_urls:
            raise ProviderConfigurationError("Threads posts need text and/or one image or video.")
        if len(media_urls) > MAX_CAROUSEL_ITEMS:
            raise ProviderConfigurationError(
                f"Threads carousels can have at most {MAX_CAROUSEL_ITEMS} items (this post has {len(media_urls)})."
            )

        version = os.getenv("THREADS_API_VERSION", "v1.0")
        base = f"https://graph.threads.net/{version}/{account_id}"

        def item_body(url: str) -> dict:
            media = public_media_url(url, platform="Threads")
            if guess_media_kind(url) == "video":
                return {"media_type": "VIDEO", "video_url": media}
            return {"media_type": "IMAGE", "image_url": media}

        if len(media_urls) > 1:
            # Carousel: one child container per item (is_carousel_item), then a CAROUSEL container.
            children: list[str] = []
            for url in media_urls:
                child = provider_request(
                    "POST", f"{base}/threads", access_token=access_token,
                    json={**item_body(url), "is_carousel_item": True},
                ).json().get("id")
                if not child:
                    raise RuntimeError("Threads did not return a carousel item container identifier")
                _wait_for_threads_container(access_token, version, str(child))
                children.append(str(child))
            container_body: dict = {"media_type": "CAROUSEL", "children": ",".join(children)}
            if text:
                container_body["text"] = text
        elif media_urls:
            container_body = item_body(media_urls[0])
            if text:
                container_body["text"] = text
        else:
            container_body = {"media_type": "TEXT", "text": text}

        reply_control = threads_reply_control(settings)
        if reply_control:
            container_body["reply_control"] = reply_control  # set on the top-level container only
        container = provider_request("POST", f"{base}/threads", access_token=access_token, json=container_body).json()
        creation_id = container.get("id")
        if not creation_id:
            raise RuntimeError("Threads did not return a media container identifier")

        if media_urls:
            _wait_for_threads_container(access_token, version, str(creation_id))

        result = provider_request(
            "POST",
            f"{base}/threads_publish",
            access_token=access_token,
            json={"creation_id": creation_id},
        ).json()
        post_id = result.get("id")
        if not post_id:
            raise RuntimeError("Threads did not return a published media identifier")
        return ProviderPublishResult(post_id=str(post_id), status_code=200)



    def delete(self, access_token: str, provider_post_id: str) -> None:
        """Delete a published Threads media object."""
        media_id = (provider_post_id or "").strip()
        if not media_id:
            raise ProviderConfigurationError("Threads delete needs a provider media id.")
        version = os.getenv("THREADS_API_VERSION", "v1.0")
        provider_delete(f"https://graph.threads.net/{version}/{media_id}", access_token=access_token)


def _wait_for_threads_container(access_token: str, version: str, creation_id: str) -> None:
    """Poll until Threads finishes processing media, or fail with a clear error."""
    deadline = time.time() + 90
    url = f"https://graph.threads.net/{version}/{creation_id}"
    while time.time() < deadline:
        try:
            response = httpx.get(
                url,
                params={"fields": "status,error_message"},
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=30.0,
            )
        except httpx.HTTPError as exc:
            raise RuntimeError("Could not check Threads media container status") from exc
        if response.is_error:
            # Give the container a moment and let publish decide; avoid blocking forever.
            _sleep(3)
            return
        body = response.json()
        state = str(body.get("status") or "").upper()
        if state in {"FINISHED", "PUBLISHED", "READY"}:
            return
        if state in {"ERROR", "EXPIRED"}:
            detail = body.get("error_message") or state
            raise ProviderConfigurationError(f"Threads media container failed ({detail}). Check the media URL.")
        _sleep(2)
    raise ProviderConfigurationError(
        "Threads is still processing the media after 90s. Try a smaller file or publish again shortly."
    )

