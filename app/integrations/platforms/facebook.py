"""Facebook Pages (and Groups) Graph API publisher."""

from __future__ import annotations

import logging
import os

import httpx

from app.core.exceptions import ProviderConfigurationError
from app.integrations.base import (
    ProviderHTTPError,
    ProviderPublishResult,
    SocialPlatform,
    provider_delete,
    provider_error_summary,
    provider_request,
)
from app.integrations.media_urls import guess_media_kind, public_media_url
from app.services.post_formats import POST, REEL, STORY

logger = logging.getLogger(__name__)


class FacebookPlatform(SocialPlatform):
    """Publish text, one or more photos, or one video to a Facebook Page or Group."""

    platform = "facebook"
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
        result = self._publish(
            access_token, account_id, content, media_urls, format=format
        )
        first_comment = str((settings or {}).get("first_comment") or "").strip()
        if first_comment:
            # Graph API: POST /{object-id}/comments. Best effort: the post is already live, so a failed
            # comment must not fail (and re-run) the publish.
            version = os.getenv("FACEBOOK_GRAPH_API_VERSION", "v21.0")
            try:
                provider_request(
                    "POST",
                    f"https://graph.facebook.com/{version}/{result.post_id}/comments",
                    access_token=access_token,
                    json={"message": first_comment[:8000]},
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "Facebook first comment failed for %s: %s",
                    result.post_id,
                    type(exc).__name__,
                )
        return result

    def _publish(
        self,
        access_token: str,
        account_id: str,
        content: str,
        media_urls: list[str],
        format: str | None = None,
    ) -> ProviderPublishResult:
        if not account_id or not str(account_id).strip():
            raise ProviderConfigurationError(
                "Facebook publishing needs a Page or Group id. Personal profiles are not publishable destinations."
            )
        fmt = (format or "").strip()
        version = os.getenv("FACEBOOK_GRAPH_API_VERSION", "v21.0")
        base = f"https://graph.facebook.com/{version}/{account_id}"
        # Story and Reel never fall through to /feed, /photos, or /videos.
        if fmt == REEL:
            return _publish_reel(access_token, base, content, media_urls)
        if fmt == STORY:
            return _publish_story(access_token, base, media_urls)
        if fmt not in {"", POST}:
            raise ProviderConfigurationError(
                f"{fmt} is not available for Facebook. Choose Post, Reel / video, or Story. Nothing was published."
            )
        if not (content or "").strip() and not media_urls:
            raise ProviderConfigurationError(
                "Facebook posts need text and/or an image."
            )
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
            response = provider_request(
                "POST", f"{base}/videos", access_token=access_token, json=payload
            )
            body = response.json()
            post_id = body.get("post_id") or body.get("id")
            if not post_id:
                raise RuntimeError(
                    "Facebook accepted the video without returning a video identifier"
                )
            return ProviderPublishResult(
                post_id=str(post_id), status_code=response.status_code
            )

        if len(media_urls) == 1:
            image_url = public_media_url(media_urls[0], platform="Facebook")
            payload = {"url": image_url, "published": True}
            if text:
                payload["caption"] = content
            response = provider_request(
                "POST", f"{base}/photos", access_token=access_token, json=payload
            )
            body = response.json()
            post_id = body.get("post_id") or body.get("id")
            if not post_id:
                raise RuntimeError(
                    "Facebook accepted the photo without returning a post identifier"
                )
            return ProviderPublishResult(
                post_id=str(post_id), status_code=response.status_code
            )

        if media_urls:
            # Multi-photo: upload each photo unpublished, then one feed post with attached_media.
            photo_ids: list[str] = []
            for url in media_urls:
                body = provider_request(
                    "POST",
                    f"{base}/photos",
                    access_token=access_token,
                    json={
                        "url": public_media_url(url, platform="Facebook"),
                        "published": False,
                    },
                ).json()
                if not body.get("id"):
                    raise RuntimeError(
                        "Facebook accepted a photo without returning a photo identifier"
                    )
                photo_ids.append(str(body["id"]))
            payload = {"attached_media": [{"media_fbid": pid} for pid in photo_ids]}
            if text:
                payload["message"] = content
            response = provider_request(
                "POST", f"{base}/feed", access_token=access_token, json=payload
            )
            body = response.json()
            post_id = body.get("id")
            if not post_id:
                raise RuntimeError(
                    "Facebook accepted the request without returning a post identifier"
                )
            return ProviderPublishResult(
                post_id=str(post_id), status_code=response.status_code
            )

        response = provider_request(
            "POST", f"{base}/feed", access_token=access_token, json={"message": content}
        )
        body = response.json()
        post_id = body.get("id")
        if not post_id:
            raise RuntimeError(
                "Facebook accepted the request without returning a post identifier"
            )
        return ProviderPublishResult(
            post_id=str(post_id), status_code=response.status_code
        )

    def delete(self, access_token: str, provider_post_id: str) -> None:
        """Delete a Page/Group post via Graph API."""
        post_id = (provider_post_id or "").strip()
        if not post_id:
            raise ProviderConfigurationError(
                "Facebook delete needs a provider post id."
            )
        version = os.getenv("FACEBOOK_GRAPH_API_VERSION", "v21.0")
        provider_delete(
            f"https://graph.facebook.com/{version}/{post_id}", access_token=access_token
        )


def _publish_reel(
    access_token: str, base: str, content: str, media_urls: list[str]
) -> ProviderPublishResult:
    """Page Reels: upload_phase=start, hosted file upload, upload_phase=finish.

    https://developers.facebook.com/docs/video-api/guides/reels-publishing/
    """
    if len(media_urls) != 1 or guess_media_kind(media_urls[0]) != "video":
        raise ProviderConfigurationError(
            "A Facebook Reel needs exactly one video. It was not published as a Page post."
        )
    video_url = public_media_url(media_urls[0], platform="Facebook")
    edge = f"{base}/video_reels"
    started = provider_request(
        "POST",
        edge,
        access_token=access_token,
        json={"upload_phase": "start"},
    ).json()
    video_id = started.get("video_id")
    upload_url = started.get("upload_url")
    if not video_id or not upload_url:
        raise RuntimeError("Facebook did not return a Reel upload session")
    _rupload(str(upload_url), access_token, video_url)
    finish = {
        "upload_phase": "finish",
        "video_id": str(video_id),
        "video_state": "PUBLISHED",
    }
    if (content or "").strip():
        finish["description"] = content
    response = provider_request("POST", edge, access_token=access_token, json=finish)
    body = response.json()
    if body.get("success") is False:
        raise ProviderConfigurationError(
            "Facebook did not publish this Reel. It was not published as a Page video."
        )
    post_id = body.get("post_id") or body.get("id") or video_id
    return ProviderPublishResult(post_id=str(post_id), status_code=response.status_code)


def _publish_story(
    access_token: str, base: str, media_urls: list[str]
) -> ProviderPublishResult:
    """Photo Stories and Video Stories. Never a feed photo or Page video.

    https://developers.facebook.com/docs/video-api/guides/page-stories/
    """
    if len(media_urls) != 1:
        raise ProviderConfigurationError(
            "A Facebook Story needs one photo or one video. It was not published to the feed."
        )
    kind = guess_media_kind(media_urls[0])
    if kind == "video":
        return _video_story(access_token, base, media_urls[0])
    if kind == "image":
        return _photo_story(access_token, base, media_urls[0])
    raise ProviderConfigurationError(
        "A Facebook Story needs one photo or one video. It was not published to the feed."
    )


def _photo_story(access_token: str, base: str, url: str) -> ProviderPublishResult:
    uploaded = provider_request(
        "POST",
        f"{base}/photos",
        access_token=access_token,
        json={"url": public_media_url(url, platform="Facebook"), "published": False},
    ).json()
    photo_id = uploaded.get("id")
    if not photo_id:
        raise RuntimeError("Facebook did not return a photo id for this Story")
    response = provider_request(
        "POST",
        f"{base}/photo_stories",
        access_token=access_token,
        json={"photo_id": str(photo_id)},
    )
    body = response.json()
    if body.get("success") is False:
        raise ProviderConfigurationError(
            "Facebook did not publish this photo Story. It was not posted to the feed."
        )
    post_id = body.get("post_id") or body.get("id")
    if not post_id:
        raise RuntimeError("Facebook did not return a Story id")
    return ProviderPublishResult(post_id=str(post_id), status_code=response.status_code)


def _video_story(access_token: str, base: str, url: str) -> ProviderPublishResult:
    video_url = public_media_url(url, platform="Facebook")
    edge = f"{base}/video_stories"
    started = provider_request(
        "POST",
        edge,
        access_token=access_token,
        json={"upload_phase": "start"},
    ).json()
    video_id = started.get("video_id")
    upload_url = started.get("upload_url")
    if not video_id or not upload_url:
        raise RuntimeError("Facebook did not return a video Story upload session")
    _rupload(str(upload_url), access_token, video_url)
    response = provider_request(
        "POST",
        edge,
        access_token=access_token,
        json={"upload_phase": "finish", "video_id": str(video_id)},
    )
    body = response.json()
    if body.get("success") is False:
        raise ProviderConfigurationError(
            "Facebook did not publish this video Story. It was not posted to the feed."
        )
    post_id = body.get("post_id") or body.get("id") or video_id
    return ProviderPublishResult(post_id=str(post_id), status_code=response.status_code)


def _rupload(upload_url: str, access_token: str, file_url: str) -> None:
    """Hosted-file upload. Meta's rupload edge expects an OAuth header, not Bearer."""
    try:
        response = httpx.request(
            "POST",
            upload_url,
            headers={"Authorization": f"OAuth {access_token}", "file_url": file_url},
            timeout=120.0,
        )
    except httpx.TimeoutException as exc:
        raise RuntimeError("Facebook video upload timed out") from exc
    except httpx.RequestError as exc:
        raise RuntimeError("Could not upload the video to Facebook") from exc
    if response.is_error:
        raise ProviderHTTPError(response.status_code, provider_error_summary(response))
    try:
        body = response.json()
    except Exception:
        body = {}
    if isinstance(body, dict) and body.get("success") is False:
        raise ProviderConfigurationError(
            "Facebook could not upload this video. It was not published as a feed video."
        )
