"""TikTok Content Posting API publisher (direct post, inbox fallback)."""

from __future__ import annotations

import httpx

from app.core.exceptions import ProviderConfigurationError
from app.integrations.base import (
    ProviderHTTPError,
    ProviderPublishResult,
    SocialPlatform,
)
from app.integrations.media_urls import (
    guess_media_kind,
    local_upload_path,
    public_media_url,
)
from app.services.post_formats import POST, REEL, STORY

_DIRECT_INIT = "https://open.tiktokapis.com/v2/post/publish/video/init/"
_INBOX_INIT = "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/"
_CONTENT_INIT = "https://open.tiktokapis.com/v2/post/publish/content/init/"
MAX_PHOTOS = 35
_CREATOR_INFO = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/"


class TikTokPlatform(SocialPlatform):
    """Publish one video or 1-35 photos via TikTok Content Posting (direct when allowed, else inbox draft)."""

    platform = "tiktok"
    supports_remote_delete = False

    def publish(
        self,
        access_token: str,
        account_id: str,
        content: str,
        media_urls: list[str],
        settings: dict | None = None,
        format: str | None = None,
    ) -> ProviderPublishResult:
        fmt = (format or "").strip()
        if fmt == STORY:
            raise ProviderConfigurationError(
                "TikTok Story is not part of TikTok's Content Posting API. "
                "Choose Photo post or Video. Nothing was posted."
            )
        if fmt not in {"", POST, REEL}:
            raise ProviderConfigurationError(
                f"{fmt} is not available for TikTok. Choose Photo post or Video. Nothing was posted."
            )
        if not account_id or not str(account_id).strip():
            raise ProviderConfigurationError(
                "TikTok publishing needs the creator open_id from OAuth connect."
            )
        if not media_urls:
            raise ProviderConfigurationError(
                "TikTok publishing requires exactly one video. Text-only posts are not supported by the Content Posting API."
            )
        kinds = [guess_media_kind(m) for m in media_urls]
        if fmt == POST and "video" in kinds:
            raise ProviderConfigurationError(
                "A TikTok photo post needs photos, not a video. Switch the format to Video. Nothing was posted."
            )
        if fmt == REEL and kinds != ["video"]:
            raise ProviderConfigurationError(
                "A TikTok video needs exactly one video. It was not posted as a photo post."
            )
        if all(k == "image" for k in kinds):
            return _publish_photos(access_token, content, media_urls, settings)
        if "image" in kinds:
            raise ProviderConfigurationError(
                "TikTok posts one video or up to 35 photos, not a mix. Pick photos or the video."
            )
        if len(media_urls) != 1:
            raise ProviderConfigurationError(
                "TikTok publishing supports exactly one video per post."
            )

        title = (content or "").strip()
        if len(title) > 2200:
            raise ProviderConfigurationError(
                "TikTok captions are limited to 2200 characters."
            )

        local = local_upload_path(media_urls[0])
        if local is not None:
            video_bytes = local.read_bytes()
            if not video_bytes:
                raise ProviderConfigurationError("The TikTok video file is empty.")
            source_info = {
                "source": "FILE_UPLOAD",
                "video_size": len(video_bytes),
                "chunk_size": len(video_bytes),
                "total_chunk_count": 1,
            }
            upload_bytes = video_bytes
            pull_url = None
        else:
            pull_url = public_media_url(media_urls[0], platform="TikTok")
            if not pull_url.startswith("https://"):
                raise ProviderConfigurationError(
                    "TikTok PULL_FROM_URL requires an https media URL on a domain verified in the TikTok developer portal."
                )
            source_info = {"source": "PULL_FROM_URL", "video_url": pull_url}
            upload_bytes = None

        privacy = _privacy_level(access_token, settings)
        direct_body = {
            "post_info": {
                "title": title or " ",
                "privacy_level": privacy,
                "disable_duet": not _allowed(settings, "allow_duet"),
                "disable_comment": not _allowed(settings, "allow_comments"),
                "disable_stitch": not _allowed(settings, "allow_stitch"),
                "video_cover_timestamp_ms": 1000,
            },
            "source_info": source_info,
        }

        direct = _tiktok_json_post(access_token, _DIRECT_INIT, direct_body)
        if direct is not None:
            return _finish_tiktok_publish(
                access_token, direct, upload_bytes, mode="direct"
            )

        # Direct Post often needs app audit / video.publish. Fall back to inbox draft (video.upload).
        inbox_body = {"source_info": source_info}
        inbox = _tiktok_json_post(
            access_token, _INBOX_INIT, inbox_body, raise_on_error=True
        )
        assert inbox is not None
        return _finish_tiktok_publish(access_token, inbox, upload_bytes, mode="inbox")

    def delete(self, access_token: str, provider_post_id: str) -> None:
        """TikTok Content Posting API has no general remote delete for live posts."""
        raise ProviderConfigurationError(
            "Remote delete is not supported for TikTok. "
            "Remove the video in the TikTok app, then delete it here, or leave it in SocialStudio."
        )


def _publish_photos(
    access_token: str, content: str, media_urls: list[str], settings: dict | None = None
) -> ProviderPublishResult:
    """Photo post (1-35 images). TikTok only supports PULL_FROM_URL for photos, so every image must be on a
    public https URL whose domain/prefix is verified in the TikTok developer portal (URL properties).
    """
    if len(media_urls) > MAX_PHOTOS:
        raise ProviderConfigurationError(
            f"TikTok photo posts can have up to {MAX_PHOTOS} photos. This post has {len(media_urls)}."
        )
    urls = []
    for url in media_urls:
        public = public_media_url(url, platform="TikTok")
        if not public.startswith("https://"):
            raise ProviderConfigurationError(
                "TikTok photo posts need https photo URLs on a domain verified in the TikTok developer portal. "
                "Set PUBLIC_BASE_URL to that verified https origin."
            )
        urls.append(public)
    text = (content or "").strip()
    first_line = text.splitlines()[0] if text else ""
    privacy = _privacy_level(access_token, settings)
    source_info = {
        "source": "PULL_FROM_URL",
        "photo_cover_index": 0,
        "photo_images": urls,
    }
    post_info = {
        "title": first_line[:90],
        "description": text[:4000],
        "privacy_level": privacy,
        "disable_comment": not _allowed(settings, "allow_comments"),
        "auto_add_music": True,
    }
    body = {
        "post_info": post_info,
        "source_info": source_info,
        "post_mode": "DIRECT_POST",
        "media_type": "PHOTO",
    }
    direct = _tiktok_json_post(access_token, _CONTENT_INIT, body)
    if direct is not None:
        return _finish_tiktok_publish(access_token, direct, None, mode="direct")
    # Without Direct Post approval, send to the creator's TikTok inbox (needs video.upload).
    inbox_info = {k: post_info[k] for k in ("title", "description")}
    body = {
        "post_info": inbox_info,
        "source_info": source_info,
        "post_mode": "MEDIA_UPLOAD",
        "media_type": "PHOTO",
    }
    inbox = _tiktok_json_post(access_token, _CONTENT_INIT, body, raise_on_error=True)
    assert inbox is not None
    return _finish_tiktok_publish(access_token, inbox, None, mode="inbox")


# Composer "Visibility" -> Content Posting API privacy_level (must be one of creator_info's options).
TIKTOK_PRIVACY = {
    "Public": "PUBLIC_TO_EVERYONE",
    "Friends": "MUTUAL_FOLLOW_FRIENDS",
    "Only me": "SELF_ONLY",
}


def _allowed(settings: dict | None, key: str) -> bool:
    value = (settings or {}).get(key, True)
    return value is not False and str(value).lower() not in {"false", "0", "off"}


def _privacy_level(access_token: str, settings: dict | None = None) -> str:
    try:
        response = httpx.post(
            _CREATOR_INFO,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json; charset=UTF-8",
            },
            json={},
            timeout=30.0,
        )
    except httpx.HTTPError:
        return "SELF_ONLY"
    if response.is_error:
        return "SELF_ONLY"
    data = (response.json() or {}).get("data") or {}
    options = data.get("privacy_level_options") or []
    if not isinstance(options, list) or not options:
        return "SELF_ONLY"
    wanted = TIKTOK_PRIVACY.get(str((settings or {}).get("audience") or ""))
    if wanted and wanted in options:
        return wanted
    preferred = (
        "PUBLIC_TO_EVERYONE",
        "MUTUAL_FOLLOW_FRIENDS",
        "FOLLOWER_OF_CREATOR",
        "SELF_ONLY",
    )
    for level in preferred:
        if level in options:
            return level
    return str(options[0])


def _tiktok_json_post(
    access_token: str, url: str, body: dict, *, raise_on_error: bool = False
) -> dict | None:
    try:
        response = httpx.post(
            url,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json; charset=UTF-8",
            },
            json=body,
            timeout=60.0,
        )
    except httpx.TimeoutException as exc:
        raise RuntimeError("TikTok request timed out") from exc
    except httpx.RequestError as exc:
        raise RuntimeError("Could not connect to TikTok") from exc
    payload = {}
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    error = payload.get("error") if isinstance(payload, dict) else None
    err_code = ""
    err_msg = ""
    if isinstance(error, dict):
        err_code = str(error.get("code") or "")
        err_msg = str(error.get("message") or "")
    ok = (not response.is_error) and (
        not err_code or err_code.lower() in {"ok", "0", ""}
    )
    if ok:
        data = payload.get("data") if isinstance(payload, dict) else None
        return data if isinstance(data, dict) else {}
    if not raise_on_error:
        # Likely unaudited direct-post or missing video.publish — caller may fall back.
        if (
            response.status_code in {401, 403}
            or "scope" in err_msg.lower()
            or "audit" in err_msg.lower()
        ):
            return None
        if err_code and err_code.lower() not in {"ok"}:
            return None
        raise ProviderHTTPError(response.status_code)
    if response.status_code in {401, 403}:
        raise ProviderConfigurationError(
            "TikTok refused publishing (missing video.upload / video.publish scopes, or the app needs TikTok audit). "
            f"Provider message: {err_msg or response.status_code}"
        )
    if (
        "url" in err_msg.lower()
        or "domain" in err_msg.lower()
        or "verify" in err_msg.lower()
    ):
        raise ProviderConfigurationError(
            "TikTok could not pull the video URL. Verify the media domain in the TikTok developer portal "
            "(URL properties), or upload via /static/uploads so SocialStudio can FILE_UPLOAD."
        )
    if response.is_error or (err_code and err_code.lower() not in {"ok"}):
        raise ProviderConfigurationError(
            f"TikTok publishing failed ({err_code or response.status_code}): {err_msg or 'see TikTok developer console'}"
        )
    return payload.get("data") if isinstance(payload, dict) else {}


def _finish_tiktok_publish(
    access_token: str, data: dict, upload_bytes: bytes | None, *, mode: str
) -> ProviderPublishResult:
    publish_id = data.get("publish_id")
    upload_url = data.get("upload_url")
    if upload_bytes is not None and upload_url:
        try:
            uploaded = httpx.put(
                upload_url,
                content=upload_bytes,
                headers={
                    "Content-Type": "video/mp4",
                    "Content-Length": str(len(upload_bytes)),
                    "Content-Range": f"bytes 0-{len(upload_bytes) - 1}/{len(upload_bytes)}",
                },
                timeout=600.0,
            )
        except httpx.TimeoutException as exc:
            raise RuntimeError("TikTok video upload timed out") from exc
        except httpx.RequestError as exc:
            raise RuntimeError("Could not upload the video bytes to TikTok") from exc
        if uploaded.is_error:
            raise ProviderHTTPError(uploaded.status_code)
    if not publish_id:
        raise RuntimeError("TikTok accepted the request without returning a publish_id")
    # Inbox drafts are not live until the creator finishes in the TikTok app.
    # Prefix keeps the provider id honest in execution logs / UI.
    post_id = str(publish_id) if mode == "direct" else f"inbox:{publish_id}"
    return ProviderPublishResult(post_id=post_id, status_code=200)
