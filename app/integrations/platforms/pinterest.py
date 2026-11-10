"""Pinterest Pins API v5 publisher."""

from __future__ import annotations

import mimetypes
import time

import httpx

from app.core.exceptions import ProviderConfigurationError
from app.integrations.base import (
    ProviderHTTPError,
    ProviderPublishResult,
    SocialPlatform,
    provider_delete,
    provider_request,
)
from app.integrations.media_urls import (
    guess_media_kind,
    local_upload_path,
    public_media_url,
)
from app.services.post_formats import POST, REEL

# Media processing poll. Tests patch these; no real sleeping in tests.
POLL_INTERVAL_SECONDS = 2.0
POLL_TIMEOUT_SECONDS = 120.0
_sleep = time.sleep
_clock = time.monotonic


class PinterestPlatform(SocialPlatform):
    """Create a Pin on a connected Board from a public image URL."""

    platform = "pinterest"
    supports_remote_delete = True

    def publish(
        self,
        access_token: str,
        account_id: str,
        content: str,
        media_urls: list[str],
        format: str | None = None,
    ) -> ProviderPublishResult:
        board_id = (account_id or "").strip()
        if not board_id:
            raise ProviderConfigurationError(
                "Pinterest publishing needs a Board id. Connect again and select a Board (user identity alone is not pin-able)."
            )
        fmt = (format or "").strip()
        if fmt == REEL:
            return _publish_video_pin(access_token, board_id, content, media_urls)
        if fmt not in {"", POST}:
            raise ProviderConfigurationError(
                f"{fmt} is not available for Pinterest. Choose Pin or Video Pin. Nothing was pinned."
            )
        if any(guess_media_kind(url) == "video" for url in media_urls):
            raise ProviderConfigurationError(
                "A Pinterest photo Pin can't include a video. Choose Video Pin and add a cover image. Nothing was pinned."
            )
        if not media_urls:
            raise ProviderConfigurationError(
                "Pinterest Pins require exactly one image URL."
            )
        if len(media_urls) != 1:
            raise ProviderConfigurationError(
                "Pinterest publishing currently supports exactly one image per Pin."
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
        response = provider_request(
            "POST",
            "https://api.pinterest.com/v5/pins",
            access_token=access_token,
            json=payload,
        )
        body = response.json()
        pin_id = body.get("id")
        if not pin_id:
            raise RuntimeError(
                "Pinterest accepted the request without returning a Pin identifier"
            )
        return ProviderPublishResult(
            post_id=str(pin_id), status_code=response.status_code
        )

    def delete(self, access_token: str, provider_post_id: str) -> None:
        """Delete a Pin."""
        from urllib.parse import quote

        pin_id = (provider_post_id or "").strip()
        if not pin_id:
            raise ProviderConfigurationError("Pinterest delete needs a Pin id.")
        provider_delete(
            f"https://api.pinterest.com/v5/pins/{quote(pin_id, safe='')}",
            access_token=access_token,
        )


def _publish_video_pin(
    access_token: str, board_id: str, content: str, media_urls: list[str]
) -> ProviderPublishResult:
    """Register a video, upload it, poll until succeeded, then create the Pin.

    https://developers.pinterest.com/docs/api/v5/#operation/media/create
    Cover image is required (source_type video_id + cover_image_url).
    """
    videos = [url for url in media_urls if guess_media_kind(url) == "video"]
    images = [url for url in media_urls if guess_media_kind(url) == "image"]
    if len(videos) != 1 or len(images) != 1 or len(media_urls) != 2:
        raise ProviderConfigurationError(
            "A Pinterest Video Pin needs one video and one cover image. Nothing was pinned."
        )
    cover = public_media_url(images[0], platform="Pinterest")
    video_bytes, content_type = _video_bytes(videos[0])
    registered = provider_request(
        "POST",
        "https://api.pinterest.com/v5/media",
        access_token=access_token,
        json={"media_type": "video"},
    ).json()
    media_id = registered.get("media_id")
    upload_url = registered.get("upload_url")
    parameters = (
        registered.get("upload_parameters")
        if isinstance(registered.get("upload_parameters"), dict)
        else {}
    )
    if not media_id or not upload_url:
        raise RuntimeError("Pinterest did not return a video upload session")
    _upload_to_pinterest(str(upload_url), parameters, video_bytes, content_type)
    _wait_until_ready(access_token, str(media_id))
    title = (content or "").strip()
    description = title
    if len(title) > 100:
        title = title[:100]
    if len(description) > 800:
        description = description[:800]
    payload = {
        "board_id": board_id,
        "media_source": {
            "source_type": "video_id",
            "media_id": str(media_id),
            "cover_image_url": cover,
        },
    }
    if title:
        payload["title"] = title
        payload["description"] = description
    response = provider_request(
        "POST",
        "https://api.pinterest.com/v5/pins",
        access_token=access_token,
        json=payload,
    )
    body = response.json()
    pin_id = body.get("id")
    if not pin_id:
        raise RuntimeError(
            "Pinterest accepted the video Pin without returning a Pin identifier"
        )
    return ProviderPublishResult(post_id=str(pin_id), status_code=response.status_code)


def _video_bytes(url: str) -> tuple[bytes, str]:
    local = local_upload_path(url)
    if local is not None:
        data = local.read_bytes()
        if not data:
            raise ProviderConfigurationError("The Pinterest video file is empty.")
        guessed, _encoding = mimetypes.guess_type(str(local))
        return data, guessed or "video/mp4"
    remote = public_media_url(url, platform="Pinterest")
    # Redirects are not followed: a public URL must not bounce the download onto a private host.
    try:
        response = httpx.get(remote, timeout=120.0, follow_redirects=False)
    except httpx.HTTPError as exc:
        raise ProviderConfigurationError(
            "Could not download the Pinterest video. Use a /static/uploads file or a direct public https URL."
        ) from exc
    if response.status_code in {301, 302, 303, 307, 308}:
        raise ProviderConfigurationError(
            "The Pinterest video URL redirected. Use a direct public file URL so the download stays on that host."
        )
    if response.is_error or not response.content:
        raise ProviderConfigurationError(
            "Could not download the Pinterest video from the media URL."
        )
    content_type = (
        (response.headers.get("content-type") or "video/mp4").split(";", 1)[0].strip()
    )
    return response.content, content_type or "video/mp4"


def _upload_to_pinterest(
    upload_url: str, parameters: dict, video_bytes: bytes, content_type: str
) -> None:
    data = {
        str(key): str(value)
        for key, value in parameters.items()
        if str(key).lower() != "content-type"
    }
    try:
        response = httpx.request(
            "POST",
            upload_url,
            data=data,
            files={"file": ("video.mp4", video_bytes, content_type or "video/mp4")},
            timeout=180.0,
        )
    except httpx.TimeoutException as exc:
        raise RuntimeError("Pinterest video upload timed out") from exc
    except httpx.RequestError as exc:
        raise RuntimeError("Could not upload the video to Pinterest") from exc
    if response.is_error:
        raise ProviderHTTPError(response.status_code)


def _wait_until_ready(access_token: str, media_id: str) -> None:
    deadline = _clock() + POLL_TIMEOUT_SECONDS
    while True:
        body = provider_request(
            "GET",
            f"https://api.pinterest.com/v5/media/{media_id}",
            access_token=access_token,
        ).json()
        status = str(body.get("status") or "").lower()
        if status == "succeeded":
            return
        if status == "failed":
            raise ProviderConfigurationError(
                "Pinterest could not process this video. Nothing was pinned."
            )
        if _clock() >= deadline:
            raise ProviderConfigurationError(
                f"Pinterest is still processing this video after {int(POLL_TIMEOUT_SECONDS)}s. Nothing was pinned."
            )
        _sleep(POLL_INTERVAL_SECONDS)
