"""TikTok Content Posting API publisher (direct post, inbox fallback)."""

from __future__ import annotations

import httpx

from app.core.exceptions import ProviderConfigurationError
from app.integrations.base import ProviderHTTPError, ProviderPublishResult, SocialPlatform
from app.integrations.media_urls import guess_media_kind, local_upload_path, public_media_url

_DIRECT_INIT = "https://open.tiktokapis.com/v2/post/publish/video/init/"
_INBOX_INIT = "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/"
_CREATOR_INFO = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/"


class TikTokPlatform(SocialPlatform):
    """Publish one video via TikTok Content Posting (direct when allowed, else inbox draft)."""

    platform = "tiktok"

    def publish(self, access_token: str, account_id: str, content: str, media_urls: list[str]) -> ProviderPublishResult:
        if not account_id or not str(account_id).strip():
            raise ProviderConfigurationError("TikTok publishing needs the creator open_id from OAuth connect.")
        if not media_urls:
            raise ProviderConfigurationError(
                "TikTok publishing requires exactly one video. Text-only posts are not supported by the Content Posting API."
            )
        if len(media_urls) != 1:
            raise ProviderConfigurationError("TikTok publishing currently supports exactly one video per post.")
        if guess_media_kind(media_urls[0]) == "image":
            raise ProviderConfigurationError(
                "TikTok photo posting is not implemented yet in SocialStudio. Attach one video file or URL."
            )

        title = (content or "").strip()
        if len(title) > 2200:
            raise ProviderConfigurationError("TikTok captions are limited to 2200 characters.")

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

        privacy = _privacy_level(access_token)
        direct_body = {
            "post_info": {
                "title": title or " ",
                "privacy_level": privacy,
                "disable_duet": False,
                "disable_comment": False,
                "disable_stitch": False,
                "video_cover_timestamp_ms": 1000,
            },
            "source_info": source_info,
        }

        direct = _tiktok_json_post(access_token, _DIRECT_INIT, direct_body)
        if direct is not None:
            return _finish_tiktok_publish(access_token, direct, upload_bytes, mode="direct")

        # Direct Post often needs app audit / video.publish. Fall back to inbox draft (video.upload).
        inbox_body = {"source_info": source_info}
        inbox = _tiktok_json_post(access_token, _INBOX_INIT, inbox_body, raise_on_error=True)
        assert inbox is not None
        return _finish_tiktok_publish(access_token, inbox, upload_bytes, mode="inbox")


def _privacy_level(access_token: str) -> str:
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
    preferred = ("PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY")
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
    ok = (not response.is_error) and (not err_code or err_code.lower() in {"ok", "0", ""})
    if ok:
        data = payload.get("data") if isinstance(payload, dict) else None
        return data if isinstance(data, dict) else {}
    if not raise_on_error:
        # Likely unaudited direct-post or missing video.publish — caller may fall back.
        if response.status_code in {401, 403} or "scope" in err_msg.lower() or "audit" in err_msg.lower():
            return None
        if err_code and err_code.lower() not in {"ok"}:
            return None
        raise ProviderHTTPError(response.status_code)
    if response.status_code in {401, 403}:
        raise ProviderConfigurationError(
            "TikTok refused publishing (missing video.upload / video.publish scopes, or the app needs TikTok audit). "
            f"Provider message: {err_msg or response.status_code}"
        )
    if "url" in err_msg.lower() or "domain" in err_msg.lower() or "verify" in err_msg.lower():
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
