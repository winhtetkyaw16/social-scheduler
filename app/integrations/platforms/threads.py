"""Meta Threads API publisher (text and single image/video)."""

from __future__ import annotations

import os
import time

import httpx

from app.core.exceptions import ProviderConfigurationError
from app.integrations.base import ProviderPublishResult, SocialPlatform, provider_delete, provider_request
from app.integrations.media_urls import guess_media_kind, public_media_url


class ThreadsPlatform(SocialPlatform):
    """Create a Threads media container, then publish it."""

    platform = "threads"
    supports_remote_delete = True

    def publish(self, access_token: str, account_id: str, content: str, media_urls: list[str]) -> ProviderPublishResult:
        if not account_id or not str(account_id).strip():
            raise ProviderConfigurationError("Threads publishing needs a Threads profile id from OAuth connect.")
        text = (content or "").strip()
        if len(text) > 500:
            raise ProviderConfigurationError("Threads text posts are limited to 500 characters.")
        if not text and not media_urls:
            raise ProviderConfigurationError("Threads posts need text and/or one image or video.")
        if len(media_urls) > 1:
            raise ProviderConfigurationError(
                "Threads publishing currently supports one image or video (or text-only). "
                "Carousels are not implemented yet."
            )

        version = os.getenv("THREADS_API_VERSION", "v1.0")
        base = f"https://graph.threads.net/{version}/{account_id}"
        if media_urls:
            kind = guess_media_kind(media_urls[0])
            media = public_media_url(media_urls[0], platform="Threads")
            if kind == "video":
                container_body: dict = {"media_type": "VIDEO", "video_url": media}
            else:
                container_body = {"media_type": "IMAGE", "image_url": media}
            if text:
                container_body["text"] = text
        else:
            container_body = {"media_type": "TEXT", "text": text}

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
            time.sleep(3)
            return
        body = response.json()
        state = str(body.get("status") or "").upper()
        if state in {"FINISHED", "PUBLISHED", "READY"}:
            return
        if state in {"ERROR", "EXPIRED"}:
            detail = body.get("error_message") or state
            raise ProviderConfigurationError(f"Threads media container failed ({detail}). Check the media URL.")
        time.sleep(2)
    raise ProviderConfigurationError(
        "Threads is still processing the media after 90s. Try a smaller file or publish again shortly."
    )


    def delete(self, access_token: str, provider_post_id: str) -> None:
        """Delete a published Threads media object."""
        media_id = (provider_post_id or "").strip()
        if not media_id:
            raise ProviderConfigurationError("Threads delete needs a provider media id.")
        version = os.getenv("THREADS_API_VERSION", "v1.0")
        provider_delete(f"https://graph.threads.net/{version}/{media_id}", access_token=access_token)
