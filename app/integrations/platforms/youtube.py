"""YouTube Data API v3 video upload publisher."""

from __future__ import annotations

import mimetypes

import httpx

from app.core.exceptions import ProviderConfigurationError
from app.integrations.base import ProviderHTTPError, ProviderPublishResult, SocialPlatform, provider_delete
from app.integrations.media_urls import guess_media_kind, local_upload_path, public_media_url


class YouTubePlatform(SocialPlatform):
    """Upload one video to the authenticated channel via resumable upload."""

    platform = "youtube"
    supports_remote_delete = True

    def publish(self, access_token: str, account_id: str, content: str, media_urls: list[str]) -> ProviderPublishResult:
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
        title, description = _title_and_description(content)
        metadata = {
            "snippet": {
                "title": title,
                "description": description,
                "categoryId": "22",
            },
            "status": {
                "privacyStatus": "public",
                "selfDeclaredMadeForKids": False,
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
