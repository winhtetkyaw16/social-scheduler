"""LinkedIn versioned REST publisher: text, one video, one image, or 2-20 images (multiImage).

Docs:
- Posts API:      https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
- Videos API:     https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api
- Images API:     https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api
- MultiImage API: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/multiimage-post-api
"""

from __future__ import annotations

import os
import struct
import time
from pathlib import Path
from urllib.parse import quote, urlparse

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
from app.integrations.media_urls import (
    guess_media_kind,
    local_upload_path,
    public_media_url,
)

API = "https://api.linkedin.com/rest"

# Limits from LinkedIn's docs (see module docstring).
VIDEO_FORMATS = (".mp4",)
VIDEO_MIN_BYTES = 75 * 1024  # "File size: Between 75kb and 500MB"
VIDEO_MAX_BYTES = 500 * 1024 * 1024
VIDEO_MIN_SECONDS = 3  # "Length: Three seconds to 30 minutes"
VIDEO_MAX_SECONDS = 30 * 60
VIDEO_PART_BYTES = (
    4 * 1024 * 1024
)  # parts are 4 MB byte ranges (0-4194303, ...); we follow uploadInstructions
IMAGE_FORMATS = (".jpg", ".jpeg", ".png", ".gif")
# Converted automatically at publish time (app/services/media_convert.py): WebP -> PNG/JPG, MOV -> MP4 (needs ffmpeg).
CONVERTIBLE_IMAGE = (".webp",)
CONVERTIBLE_VIDEO = (".mov", ".m4v")


def ffmpeg_available() -> bool:
    import shutil

    return shutil.which("ffmpeg") is not None


IMAGE_MAX_PIXELS = 36_152_320  # "Images with less than 36,152,320 pixels"
GIF_MAX_FRAMES = 250
MULTI_IMAGE_MIN = 2
MULTI_IMAGE_MAX = 20

VIDEO_POLL_INTERVAL = 5.0


def _sleep(seconds: float) -> None:
    time.sleep(seconds)


def _clock() -> float:
    return time.monotonic()


def _version() -> str:
    version = os.getenv("LINKEDIN_VERSION", "202610")
    if len(version) != 6 or not version.isdigit():
        raise ProviderConfigurationError("LINKEDIN_VERSION must use YYYYMM format")
    return version


def _headers() -> dict[str, str]:
    return {
        "Linkedin-Version": _version(),
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json",
    }


def _ext(url: str) -> str:
    path = urlparse(url).path if "://" in url else url
    return Path(path.lower()).suffix


def _name(url: str) -> str:
    path = urlparse(url).path if "://" in url else url
    return Path(path).name or "this file"


# ---------- local file inspection (no third-party deps) ----------


def mp4_duration_seconds(data: bytes) -> float | None:
    """Read the movie duration from an MP4/MOV 'moov/mvhd' box; None if not found."""

    def boxes(mp4: bytes, start: int, end: int):
        offset = start
        while offset + 8 <= end:
            size, kind = struct.unpack(">I4s", mp4[offset : offset + 8])
            header = 8
            if size == 1 and offset + 16 <= end:
                size = struct.unpack(">Q", mp4[offset + 8 : offset + 16])[0]
                header = 16
            elif size == 0:
                size = end - offset
            if size < header:
                return
            yield kind, offset + header, min(offset + size, end)
            offset += size

    for kind, payload_start, payload_end in boxes(data, 0, len(data)):
        if kind != b"moov":
            continue
        for child_kind, child_start, _child_end in boxes(
            data, payload_start, payload_end
        ):
            if child_kind != b"mvhd":
                continue
            version = data[child_start]
            if version == 1:
                timescale, duration = struct.unpack(
                    ">IQ", data[child_start + 20 : child_start + 32]
                )
            else:
                timescale, duration = struct.unpack(
                    ">II", data[child_start + 12 : child_start + 20]
                )
            return duration / timescale if timescale else None
    return None


def image_size(data: bytes) -> tuple[int, int] | None:
    """(width, height) for PNG, GIF or JPEG bytes; None if unknown."""
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        return struct.unpack(">II", data[16:24])
    if data[:6] in (b"GIF87a", b"GIF89a") and len(data) >= 10:
        return struct.unpack("<HH", data[6:10])
    if data[:2] == b"\xff\xd8":
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                i += 2
                continue
            length = struct.unpack(">H", data[i + 2 : i + 4])[0]
            if marker in (
                0xC0,
                0xC1,
                0xC2,
                0xC3,
                0xC5,
                0xC6,
                0xC7,
                0xC9,
                0xCA,
                0xCB,
                0xCD,
                0xCE,
                0xCF,
            ):
                h, w = struct.unpack(">HH", data[i + 5 : i + 9])
                return w, h
            i += 2 + length
    return None


def _mb(n: int) -> str:
    return f"{n / 1048576:.1f} MB" if n >= 1048576 else f"{n / 1024:.0f} KB"


def _mmss(seconds: float) -> str:
    return f"{int(seconds // 60)}:{int(round(seconds % 60)):02d}"


def linkedin_media_problem(
    media_urls: list | None, *, inspect_files: bool = True
) -> str | None:
    """Plain-language reason LinkedIn can't take this media set, or None. Shared by 422 validation and publish."""
    media = [str(m) for m in (media_urls or [])]
    if not media:
        return None
    kinds = [guess_media_kind(m) for m in media]
    videos = [m for m, k in zip(media, kinds) if k == "video"]
    images = [m for m, k in zip(media, kinds) if k != "video"]
    if videos and images:
        return (
            "LinkedIn posts can have one video, one photo, or 2-20 photos, not a mix of photos and videos. "
            "Remove the video or the photos."
        )
    if len(videos) > 1:
        return f"LinkedIn posts can have only one video. This post has {len(videos)}; keep one."
    if len(images) > MULTI_IMAGE_MAX:
        return f"LinkedIn multi-photo posts can have up to {MULTI_IMAGE_MAX} photos. This post has {len(images)}; remove some."
    for url in videos:
        ext = _ext(url)
        if (
            ext
            and ext not in VIDEO_FORMATS
            and not (ext in CONVERTIBLE_VIDEO and ffmpeg_available())
        ):
            return f"LinkedIn accepts videos as MP4 only. {_name(url)} is {ext.lstrip('.').upper()}; convert it to MP4."
        local = local_upload_path(url) if inspect_files else None
        if local is not None:
            size = local.stat().st_size
            if size < VIDEO_MIN_BYTES or size > VIDEO_MAX_BYTES:
                return f"LinkedIn videos must be between 75 KB and 500 MB. This one is {_mb(size)}."
            duration = mp4_duration_seconds(local.read_bytes())
            if duration is not None and not (
                VIDEO_MIN_SECONDS <= duration <= VIDEO_MAX_SECONDS
            ):
                return f"LinkedIn videos must be 3 seconds to 30 minutes long. This one is {_mmss(duration)}."
    for url in images:
        ext = _ext(url)
        if (
            ext
            and ext not in IMAGE_FORMATS
            and ext not in CONVERTIBLE_IMAGE
            and guess_media_kind(url) == "image"
        ):
            return f"LinkedIn accepts JPG, PNG or GIF photos. {_name(url)} is {ext.lstrip('.').upper()}; re-save it as JPG or PNG."
        local = local_upload_path(url) if inspect_files else None
        if local is not None:
            dims = image_size(local.read_bytes())
            if dims and dims[0] * dims[1] >= IMAGE_MAX_PIXELS:
                return (
                    f"LinkedIn photos must be under 36,152,320 pixels (about 6000x6000). "
                    f"{_name(url)} is {dims[0]}x{dims[1]}; resize it."
                )
    return None


# ---------- HTTP helpers ----------


def _load_bytes(url: str, what: str) -> bytes:
    local = local_upload_path(url)
    if local is not None:
        data = local.read_bytes()
    else:
        remote = public_media_url(url, platform="LinkedIn")
        try:
            response = httpx.get(remote, timeout=120.0, follow_redirects=True)
        except httpx.HTTPError as exc:
            raise ProviderConfigurationError(
                f"Could not download the LinkedIn {what} from the media URL."
            ) from exc
        if response.is_error:
            raise ProviderConfigurationError(
                f"Could not download the LinkedIn {what} from the media URL."
            )
        data = response.content
    if not data:
        raise ProviderConfigurationError(f"The LinkedIn {what} file is empty.")
    return data


def _put(upload_url: str, access_token: str, body: bytes, what: str) -> httpx.Response:
    try:
        response = httpx.request(
            "PUT",
            upload_url,
            content=body,
            timeout=300.0,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/octet-stream",
            },
        )
    except httpx.HTTPError as exc:
        raise RuntimeError(
            f"LinkedIn upload failed: could not send the {what} to LinkedIn"
        ) from exc
    if response.is_error:
        detail = provider_error_summary(response)
        raise ProviderHTTPError(
            response.status_code,
            f"LinkedIn upload failed ({what})" + (f": {detail}" if detail else ""),
        )
    return response


def _value(response: httpx.Response) -> dict:
    try:
        body = response.json() or {}
    except Exception:
        body = {}
    return body.get("value") or body


class LinkedInPlatform(SocialPlatform):
    """Publish text, one video, one image, or 2-20 images to a LinkedIn member/organization feed."""

    platform = "linkedin"
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
        from app.services.post_formats import POST, REEL

        fmt = (format or "").strip()
        if fmt not in {"", POST, REEL}:
            raise ProviderConfigurationError(
                f"{fmt} is not available for LinkedIn. Choose Post or Video. Nothing was published."
            )
        author = (
            account_id
            if str(account_id).startswith("urn:li:")
            else f"urn:li:person:{account_id}"
        )
        media = [str(u) for u in (media_urls or [])]
        if fmt == REEL and not any(guess_media_kind(url) == "video" for url in media):
            raise ProviderConfigurationError(
                "A LinkedIn video post needs a video. It was not published as a text or photo post."
            )
        problem = linkedin_media_problem(media)
        if problem:
            raise ProviderConfigurationError(problem)
        content_block: dict | None = None
        if media:
            if guess_media_kind(media[0]) == "video":
                urn = self._upload_video(access_token, author, media[0])
                content_block = {"media": {"id": urn, "title": _video_title(content)}}
            else:
                urns = [self._upload_image(access_token, author, url) for url in media]
                if len(urns) == 1:
                    content_block = {"media": {"id": urns[0]}}
                else:
                    content_block = {
                        "multiImage": {
                            "images": [{"id": u, "altText": ""} for u in urns]
                        }
                    }
        body = {
            "author": author,
            "commentary": content or "",
            "visibility": linkedin_visibility(author, settings),
            "distribution": {
                "feedDistribution": "MAIN_FEED",
                "targetEntities": [],
                "thirdPartyDistributionChannels": [],
            },
            "lifecycleState": "PUBLISHED",
            "isReshareDisabledByAuthor": False,
        }
        if content_block:
            body["content"] = content_block
        response = provider_request(
            "POST",
            f"{API}/posts",
            access_token=access_token,
            headers=_headers(),
            json=body,
        )
        post_id = response.headers.get("x-restli-id")
        if not post_id:
            raise RuntimeError(
                "LinkedIn accepted the request without returning a post identifier"
            )
        return ProviderPublishResult(
            post_id=post_id,
            request_id=response.headers.get("x-li-uuid"),
            status_code=response.status_code,
        )

    # --- video: initializeUpload -> PUT parts (collect ETags) -> finalizeUpload -> poll AVAILABLE ---
    def _upload_video(self, access_token: str, owner: str, url: str) -> str:
        data = _load_bytes(url, "video")
        if len(data) < VIDEO_MIN_BYTES or len(data) > VIDEO_MAX_BYTES:
            raise ProviderConfigurationError(
                f"LinkedIn videos must be between 75 KB and 500 MB. This one is {_mb(len(data))}."
            )
        init = _value(
            provider_request(
                "POST",
                f"{API}/videos?action=initializeUpload",
                access_token=access_token,
                headers=_headers(),
                json={
                    "initializeUploadRequest": {
                        "owner": owner,
                        "fileSizeBytes": len(data),
                        "uploadCaptions": False,
                        "uploadThumbnail": False,
                    }
                },
            )
        )
        urn = init.get("video")
        instructions = init.get("uploadInstructions") or []
        if not urn or not instructions:
            raise RuntimeError(
                "LinkedIn upload failed: LinkedIn did not return video upload instructions"
            )
        etags: list[str] = []
        for part in sorted(instructions, key=lambda p: int(p.get("firstByte", 0))):
            first, last = int(part["firstByte"]), int(part["lastByte"])
            response = _put(
                part["uploadUrl"], access_token, data[first : last + 1], "video"
            )
            etag = response.headers.get("etag") or response.headers.get("ETag")
            if not etag:
                raise RuntimeError(
                    "LinkedIn upload failed: a video part was accepted without an ETag"
                )
            etags.append(etag.strip('"'))
        provider_request(
            "POST",
            f"{API}/videos?action=finalizeUpload",
            access_token=access_token,
            headers=_headers(),
            json={
                "finalizeUploadRequest": {
                    "video": urn,
                    "uploadToken": init.get("uploadToken") or "",
                    "uploadedPartIds": etags,
                }
            },
        )
        self._wait_video(access_token, urn)
        return urn

    def _wait_video(self, access_token: str, urn: str) -> None:
        timeout = float(os.getenv("LINKEDIN_VIDEO_TIMEOUT_SECONDS", "900"))
        deadline = _clock() + timeout
        while True:
            try:
                info = (
                    provider_request(
                        "GET",
                        f"{API}/videos/{quote(urn, safe='')}",
                        access_token=access_token,
                        headers=_headers(),
                    ).json()
                    or {}
                )
            except ProviderHTTPError as exc:
                if exc.status_code == 403:
                    # Some member tokens are write-only for media reads; give LinkedIn time, then post.
                    _sleep(min(30.0, timeout))
                    return
                raise
            status = str(info.get("status") or "").upper()
            if status == "AVAILABLE":
                return
            if status == "PROCESSING_FAILED":
                reason = info.get("processingFailureReason") or "no reason given"
                raise RuntimeError(
                    f"LinkedIn could not process the video (PROCESSING_FAILED: {reason})"
                )
            if _clock() >= deadline:
                raise RuntimeError(
                    f"LinkedIn video still processing after {int(timeout)} seconds (timed out)"
                )
            _sleep(VIDEO_POLL_INTERVAL)

    # --- image: initializeUpload -> PUT bytes. Member tokens (w_member_social) can't GET /rest/images, so no poll. ---
    def _upload_image(self, access_token: str, owner: str, url: str) -> str:
        data = _load_bytes(url, "image")
        dims = image_size(data)
        if dims and dims[0] * dims[1] >= IMAGE_MAX_PIXELS:
            raise ProviderConfigurationError(
                f"LinkedIn photos must be under 36,152,320 pixels (about 6000x6000). {_name(url)} is {dims[0]}x{dims[1]}; resize it."
            )
        init = _value(
            provider_request(
                "POST",
                f"{API}/images?action=initializeUpload",
                access_token=access_token,
                headers=_headers(),
                json={"initializeUploadRequest": {"owner": owner}},
            )
        )
        urn, upload_url = init.get("image"), init.get("uploadUrl")
        if not urn or not upload_url:
            raise RuntimeError(
                "LinkedIn upload failed: LinkedIn did not return an image upload URL"
            )
        _put(upload_url, access_token, data, "image")
        return urn

    def delete(self, access_token: str, provider_post_id: str) -> None:
        """Delete a LinkedIn REST post by id/URN."""
        post_id = (provider_post_id or "").strip()
        if not post_id:
            raise ProviderConfigurationError(
                "LinkedIn delete needs a provider post id."
            )
        provider_delete(
            f"{API}/posts/{quote(post_id, safe='')}",
            access_token=access_token,
            headers={
                "Linkedin-Version": _version(),
                "X-Restli-Protocol-Version": "2.0.0",
            },
        )


def linkedin_visibility(author: str, settings: dict | None) -> str:
    """Posts API visibility: CONNECTIONS is only valid for member (person) authors; organizations stay PUBLIC."""
    wanted = str((settings or {}).get("visibility") or "Anyone")
    if wanted == "Connections only" and str(author).startswith("urn:li:person:"):
        return "CONNECTIONS"
    return "PUBLIC"


def _video_title(content: str) -> str:
    first = (content or "").strip().split("\n", 1)[0].strip()
    return first[:200] or "Video"
