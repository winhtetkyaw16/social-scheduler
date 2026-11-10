"""YouTube Data API v3 video upload publisher."""

from __future__ import annotations

import mimetypes

import httpx

from app.core.exceptions import ProviderConfigurationError
from app.integrations.base import ProviderHTTPError, ProviderPublishResult, SocialPlatform, provider_delete
from app.integrations.media_urls import guess_media_kind, local_upload_path, public_media_url
from app.services.media_probe import measure_bytes
from app.services.post_formats import POST, REEL, SHORT, short_problem



# Composer "Platform settings" -> YouTube Data API v3 videos.insert (snippet.categoryId, status.*).
YOUTUBE_CATEGORY_IDS = {
    "Film & Animation": "1", "Autos & Vehicles": "2", "Music": "10", "Pets & Animals": "15", "Sports": "17",
    "Travel & Events": "19", "Gaming": "20", "People & Blogs": "22", "Comedy": "23", "Entertainment": "24",
    "News & Politics": "25", "Howto & Style": "26", "Education": "27", "Science & Technology": "28",
}
_YOUTUBE_PRIVACY = {"public": "public", "unlisted": "unlisted", "private": "private"}


def youtube_privacy(settings: dict | None) -> str:
    raw = str((settings or {}).get("privacy_status") or "public").strip().lower()
    return _YOUTUBE_PRIVACY.get(raw, "public")


def youtube_category_id(settings: dict | None) -> str:
    raw = str((settings or {}).get("category") or "").strip()
    if raw.isdigit():
        return raw
    return YOUTUBE_CATEGORY_IDS.get(raw, "22")


def youtube_made_for_kids(settings: dict | None) -> bool:
    s = settings or {}
    if "made_for_kids" in s:
        return bool(s.get("made_for_kids"))
    return s.get("audience_classification") == "Made for kids"

class YouTubePlatform(SocialPlatform):
    """Upload one video to the authenticated channel via resumable upload."""

    platform = "youtube"
    supports_remote_delete = True

    def publish(
        self, access_token: str, account_id: str, content: str, media_urls: list[str],
        settings: dict | None = None, format: str | None = None,
    ) -> ProviderPublishResult:
        fmt = (format or "").strip()
        if fmt == POST:
            raise ProviderConfigurationError(
                "YouTube Community posts are not available through YouTube's API. "
                "Choose Video or Short. Nothing was uploaded."
            )
        if fmt not in {"", REEL, SHORT}:
            raise ProviderConfigurationError(
                f"{fmt} is not available for YouTube. Choose Video or Short. Nothing was uploaded."
            )
        if not account_id or not str(account_id).strip():
            raise ProviderConfigurationError("YouTube publishing needs a Channel id from OAuth connect.")
        if not media_urls:
            raise ProviderConfigurationError(
                "YouTube publishing requires exactly one video file or public video URL. Text-only posts are not supported."
            )
        if len(media_urls) != 1:
            raise ProviderConfigurationError("YouTube publishing currently supports exactly one video per upload.")
        if guess_media_kind(media_urls[0]) == "image":
            raise ProviderConfigurationError("YouTube publishing requires a video, not an image.")

        video_bytes, content_type = _load_video_bytes(media_urls[0])
        if fmt == SHORT:
            # Classification only. videos.insert has no Shorts flag and this does not add #Shorts.
            problem = short_problem(measure_bytes(video_bytes))
            if problem:
                raise ProviderConfigurationError(problem)
        title, description = _title_and_description(content)
        metadata = {
            "snippet": {
                "title": title,
                "description": description,
                "categoryId": youtube_category_id(settings),
            },
            "status": {
                "privacyStatus": youtube_privacy(settings),
                "selfDeclaredMadeForKids": youtube_made_for_kids(settings),
            },
        }

        try:
            init = httpx.post(
                "https://www.googleapis.com/upload/youtube/v3/videos",
                params={"uploadType": "resumable", "part": "snippet,status"},
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json; charset=UTF-8",
                    "X-Upload-Content-Length": str(len(video_bytes)),
                    "X-Upload-Content-Type": content_type,
                },
                json=metadata,
                timeout=60.0,
            )
        except httpx.TimeoutException as exc:
            raise RuntimeError("YouTube upload session timed out") from exc
        except httpx.RequestError as exc:
            raise RuntimeError("Could not connect to YouTube") from exc
        if init.is_error:
            if init.status_code in {401, 403}:
                raise ProviderConfigurationError(
                    "YouTube refused the upload (missing youtube.upload / youtube.force-ssl scope, "
                    "or the Google app is unverified). Reconnect the channel after enabling upload scopes."
                )
            raise ProviderHTTPError(init.status_code)
        upload_url = init.headers.get("location") or init.headers.get("Location")
        if not upload_url:
            raise RuntimeError("YouTube did not return a resumable upload URL")

        try:
            uploaded = httpx.put(
                upload_url,
                content=video_bytes,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": content_type,
                    "Content-Length": str(len(video_bytes)),
                },
                timeout=600.0,
            )
        except httpx.TimeoutException as exc:
            raise RuntimeError("YouTube video upload timed out") from exc
        except httpx.RequestError as exc:
            raise RuntimeError("Could not upload the video to YouTube") from exc
        if uploaded.is_error:
            raise ProviderHTTPError(uploaded.status_code)
        body = uploaded.json()
        video_id = body.get("id")
        if not video_id:
            raise RuntimeError("YouTube accepted the upload without returning a video id")
        return ProviderPublishResult(post_id=str(video_id), status_code=uploaded.status_code)


    def delete(self, access_token: str, provider_post_id: str) -> None:
        """Delete a YouTube video by id."""
        from urllib.parse import quote

        video_id = (provider_post_id or "").strip()
        if not video_id:
            raise ProviderConfigurationError("YouTube delete needs a video id.")
        provider_delete(
            f"https://www.googleapis.com/youtube/v3/videos?id={quote(video_id, safe='')}",
            access_token=access_token,
        )


def _title_and_description(content: str) -> tuple[str, str]:
    text = (content or "").strip()
    if not text:
        return "Untitled upload", ""
    if "\n" in text:
        first, rest = text.split("\n", 1)
        title = first.strip()[:100] or "Untitled upload"
        return title, rest.strip()
    return text[:100], text


def _load_video_bytes(url: str) -> tuple[bytes, str]:
    local = local_upload_path(url)
    if local is not None:
        data = local.read_bytes()
        if not data:
            raise ProviderConfigurationError("The YouTube video file is empty.")
        guessed, _ = mimetypes.guess_type(str(local))
        return data, guessed or "video/mp4"

    # Prefer public URL download when the file is not on this machine.
    remote = public_media_url(url, platform="YouTube")
    try:
        response = httpx.get(remote, timeout=120.0, follow_redirects=True)
    except httpx.HTTPError as exc:
        raise ProviderConfigurationError(
            "Could not download the YouTube video from the media URL. Use a /static/uploads file or a public https URL."
        ) from exc
    if response.is_error or not response.content:
        raise ProviderConfigurationError("Could not download the YouTube video from the media URL.")
    content_type = response.headers.get("content-type") or mimetypes.guess_type(remote)[0] or "video/mp4"
    if ";" in content_type:
        content_type = content_type.split(";", 1)[0].strip()
    return response.content, content_type
