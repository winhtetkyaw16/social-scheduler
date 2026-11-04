"""X API v2 publisher: text, up to 4 photos, one animated GIF, or one video.

Docs (checked 2026-11-04):
- Upload media (simple):  https://docs.x.com/x-api/media/upload-media
- Chunked upload guide:   https://docs.x.com/x-api/media/quickstart/media-upload-chunked
- Initialize / Append / Finalize / Status:
    https://docs.x.com/x-api/media/initialize-media-upload
    https://docs.x.com/x-api/media/append-media-upload
    https://docs.x.com/x-api/media/finalize-media-upload
    https://docs.x.com/x-api/media/get-media-upload-status
- Limits:                 https://docs.x.com/x-api/media/quickstart/best-practices
- Scopes (media.write):   https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code
- Create Post:            https://docs.x.com/x-api/posts/create-post
"""

from __future__ import annotations

import base64
import os
import struct
import time
from pathlib import Path
from urllib.parse import urlparse

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
from app.integrations.media_urls import guess_media_kind, local_upload_path, public_media_url
from app.integrations.platforms.linkedin import image_size, mp4_duration_seconds

API = "https://api.x.com/2"
UPLOAD = f"{API}/media/upload"

# Limits from https://docs.x.com/x-api/media/quickstart/best-practices
MAX_IMAGES = 4                          # "up to 4 photos, 1 animated GIF or 1 video in a Post"
IMAGE_FORMATS = (".jpg", ".jpeg", ".png", ".webp")   # JPG, PNG, GIF, WEBP (GIF handled as tweet_gif)
IMAGE_MAX_BYTES = 5 * 1024 * 1024       # Image <= 5 MB
GIF_MAX_BYTES = 15 * 1024 * 1024        # Animated GIF <= 15 MB
GIF_MAX_W, GIF_MAX_H = 1280, 1080       # GIF resolution <= 1280x1080
VIDEO_FORMATS = (".mp4",)               # chunked upload media_type video/mp4
VIDEO_MAX_BYTES = 8 * 1024 * 1024 * 1024   # 8 GB default account (16 GB Premium)
VIDEO_MIN_SECONDS = 0.5                 # 0.5 seconds..20 minutes default (125 min Premium)
VIDEO_MIN_DIM = 32                      # dimensions at least 32x32
VIDEO_MAX_DIM = 1920                    # 1080p playback for subscribed users; see PR notes
VIDEO_MIN_RATIO, VIDEO_MAX_RATIO = 1 / 3, 3.0   # aspect ratio between 1:3 and 3:1
CHUNK_BYTES = 4 * 1024 * 1024           # APPEND segments must be <= 5 MB

MIME = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
        ".gif": "image/gif", ".mp4": "video/mp4"}


def _sleep(seconds: float) -> None:
    time.sleep(seconds)


def _clock() -> float:
    return time.monotonic()


def video_max_seconds() -> float:
    """20 minutes for default accounts; set X_VIDEO_MAX_SECONDS=7500 for Premium (125 min)."""
    try:
        return float(os.getenv("X_VIDEO_MAX_SECONDS", "1200"))
    except ValueError:
        return 1200.0


def _ext(url: str) -> str:
    path = urlparse(url).path if "://" in url else url
    return Path(path.lower()).suffix


def _name(url: str) -> str:
    path = urlparse(url).path if "://" in url else url
    return Path(path).name or "this file"


def _mb(n: int) -> str:
    return f"{n / 1048576:.1f} MB" if n >= 1048576 else f"{n / 1024:.0f} KB"


def _mmss(seconds: float) -> str:
    return f"{int(seconds // 60)}:{int(round(seconds % 60)):02d}"


def mp4_video_size(data: bytes) -> tuple[int, int] | None:
    """(width, height) of the first video track from moov/trak/tkhd; None if not found."""
    def boxes(start: int, end: int):
        i = start
        while i + 8 <= end:
            size, kind = struct.unpack(">I4s", data[i:i + 8])
            header = 8
            if size == 1 and i + 16 <= end:
                size = struct.unpack(">Q", data[i + 8:i + 16])[0]
                header = 16
            elif size == 0:
                size = end - i
            if size < header:
                return
            yield kind, i + header, min(i + size, end)
            i += size

    for kind, s, e in boxes(0, len(data)):
        if kind != b"moov":
            continue
        for k2, s2, e2 in boxes(s, e):
            if k2 != b"trak":
                continue
            for k3, s3, e3 in boxes(s2, e2):
                if k3 == b"tkhd" and e3 - s3 >= 84:
                    w, h = struct.unpack(">II", data[e3 - 8:e3])
                    w, h = w >> 16, h >> 16
                    if w and h:
                        return w, h
    return None


def _kind(url: str) -> str:
    if _ext(url) == ".gif":
        return "gif"
    return "video" if guess_media_kind(url) == "video" else "image"


def _video_problem(name: str, size: int | None, data: bytes | None) -> str | None:
    if size is not None and size > VIDEO_MAX_BYTES:
        return f"X videos can be up to 8 GB. {name} is {_mb(size)}."
    if data:
        duration = mp4_duration_seconds(data)
        limit = video_max_seconds()
        if duration is not None and not (VIDEO_MIN_SECONDS <= duration <= limit):
            return (f"X videos must be 0.5 seconds to {int(limit // 60)} minutes long. "
                    f"{name} is {_mmss(duration)}.")
        dims = mp4_video_size(data)
        if dims:
            w, h = dims
            if min(w, h) < VIDEO_MIN_DIM or max(w, h) > VIDEO_MAX_DIM:
                return (f"X videos must be between 32x32 and 1920 pixels on the long side. "
                        f"{name} is {w}x{h}; resize it (1280x720 or 720x1280 works best).")
            if not (VIDEO_MIN_RATIO <= w / h <= VIDEO_MAX_RATIO):
                return f"X videos must have an aspect ratio between 1:3 and 3:1. {name} is {w}x{h}; crop it."
    return None


def _image_problem(name: str, ext: str, data: bytes | None, size: int | None) -> str | None:
    if size is not None and size > IMAGE_MAX_BYTES:
        return f"X photos can be up to 5 MB. {name} is {_mb(size)}; compress or resize it."
    return None


def _gif_problem(name: str, data: bytes | None, size: int | None) -> str | None:
    if size is not None and size > GIF_MAX_BYTES:
        return f"X animated GIFs can be up to 15 MB. {name} is {_mb(size)}."
    if data:
        dims = image_size(data)
        if dims and (dims[0] > GIF_MAX_W or dims[1] > GIF_MAX_H):
            return f"X animated GIFs can be up to 1280x1080. {name} is {dims[0]}x{dims[1]}; resize it."
    return None


def x_media_problem(media_urls: list | None, *, inspect_files: bool = True) -> str | None:
    """Plain-language reason X can't take this media set, or None. Shared by 422 validation and publish."""
    media = [str(m) for m in (media_urls or [])]
    if not media:
        return None
    kinds = [_kind(m) for m in media]
    videos = [m for m, k in zip(media, kinds) if k == "video"]
    gifs = [m for m, k in zip(media, kinds) if k == "gif"]
    images = [m for m, k in zip(media, kinds) if k == "image"]
    if videos and (images or gifs):
        return ("X posts can have up to 4 photos, or 1 video, not a mix of photos and videos. "
                "Remove the video or the photos.")
    if len(videos) > 1:
        return f"X posts can have only one video. This post has {len(videos)}; keep one."
    if gifs and (len(gifs) > 1 or images):
        return "An animated GIF must be the only media on an X post (1 GIF, or up to 4 photos). Remove the other files."
    if len(images) > MAX_IMAGES:
        return f"X posts can have up to 4 photos. This post has {len(images)}; remove some."
    for url in media:
        ext, name, kind = _ext(url), _name(url), _kind(url)
        local = local_upload_path(url) if inspect_files else None
        size = local.stat().st_size if local is not None else None
        if kind == "video":
            if ext and ext not in VIDEO_FORMATS:
                return f"X accepts videos as MP4 only. {name} is {ext.lstrip('.').upper()}; convert it to MP4."
            head = local.read_bytes() if local is not None and size <= 512 * 1024 * 1024 else None
            problem = _video_problem(name, size, head)
        elif kind == "gif":
            problem = _gif_problem(name, local.read_bytes()[:32] if local is not None else None, size)
        else:
            if ext and ext not in IMAGE_FORMATS:
                return f"X accepts JPG, PNG, GIF or WEBP photos. {name} is {ext.lstrip('.').upper()}; re-save it as JPG or PNG."
            problem = _image_problem(name, ext, None, size)
        if problem:
            return problem
    return None


# ---------- HTTP helpers ----------

def _load_bytes(url: str, what: str) -> bytes:
    local = local_upload_path(url)
    if local is not None:
        data = local.read_bytes()
    else:
        remote = public_media_url(url, platform="X")
        try:
            response = httpx.get(remote, timeout=120.0, follow_redirects=True)
        except httpx.HTTPError as exc:
            raise ProviderConfigurationError(f"Could not download the X {what} from the media URL.") from exc
        if response.is_error:
            raise ProviderConfigurationError(f"Could not download the X {what} from the media URL.")
        data = response.content
    if not data:
        raise ProviderConfigurationError(f"The X {what} file is empty.")
    return data


def _upload_call(method: str, url: str, access_token: str, **kwargs) -> dict:
    """Media upload request; errors carry 'X media upload failed' so a 403 maps to the media.write message."""
    try:
        response = httpx.request(method, url, headers={"Authorization": f"Bearer {access_token}"},
                                 timeout=300.0, **kwargs)
    except httpx.TimeoutException as exc:
        raise RuntimeError("X media upload timed out") from exc
    except httpx.RequestError as exc:
        raise RuntimeError("Could not connect to the social platform") from exc
    if response.is_error:
        detail = provider_error_summary(response)
        raise ProviderHTTPError(response.status_code, "X media upload failed" + (f": {detail}" if detail else ""))
    try:
        body = response.json() or {}
    except Exception:
        body = {}
    return body.get("data") or {}


class XPlatform(SocialPlatform):
    """Publish text, photo, GIF and video posts to X."""

    platform = "x"
    supports_remote_delete = True

    def publish(self, access_token: str, account_id: str, content: str, media_urls: list[str]) -> ProviderPublishResult:
        """Upload media (if any), create a post and return its X status identifier."""
        media = [str(m) for m in (media_urls or [])]
        problem = x_media_problem(media)
        if problem:
            raise ProviderConfigurationError(problem)
        body: dict = {"text": content}
        if media:
            ids = []
            for url in media:
                kind = _kind(url)
                if kind == "image":
                    ids.append(self._upload_image(access_token, url))
                else:
                    ids.append(self._upload_chunked(access_token, url, kind))
            body["media"] = {"media_ids": ids}
        response = provider_request("POST", f"{API}/tweets", access_token=access_token, json=body)
        data = response.json().get("data", {})
        post_id = data.get("id")
        if not post_id:
            raise RuntimeError("X accepted the request without returning a post identifier")
        return ProviderPublishResult(
            post_id=post_id, request_id=response.headers.get("x-transaction-id"), status_code=response.status_code
        )

    # --- photo: one POST /2/media/upload (JSON, base64 media, media_category tweet_image) ---
    def _upload_image(self, access_token: str, url: str) -> str:
        data = _load_bytes(url, "photo")
        if len(data) > IMAGE_MAX_BYTES:
            raise ProviderConfigurationError(f"X photos can be up to 5 MB. {_name(url)} is {_mb(len(data))}; compress or resize it.")
        info = _upload_call("POST", UPLOAD, access_token, json={
            "media": base64.b64encode(data).decode("ascii"), "media_category": "tweet_image"})
        media_id = info.get("id")
        if not media_id:
            raise RuntimeError("X media upload failed: X did not return a media id for the photo")
        return str(media_id)

    # --- video / GIF: initialize -> append (<=5 MB segments) -> finalize -> poll STATUS ---
    def _upload_chunked(self, access_token: str, url: str, kind: str) -> str:
        what = "video" if kind == "video" else "GIF"
        data = _load_bytes(url, what)
        problem = (_video_problem(_name(url), len(data), data) if kind == "video"
                   else _gif_problem(_name(url), data[:32], len(data)))
        if problem:
            raise ProviderConfigurationError(problem)
        init = _upload_call("POST", f"{UPLOAD}/initialize", access_token, json={
            "media_type": "video/mp4" if kind == "video" else "image/gif",
            "total_bytes": len(data),
            "media_category": "tweet_video" if kind == "video" else "tweet_gif",
        })
        media_id = init.get("id")
        if not media_id:
            raise RuntimeError(f"X media upload failed: X did not return a media id for the {what}")
        media_id = str(media_id)
        for index, start in enumerate(range(0, len(data), CHUNK_BYTES)):
            _upload_call("POST", f"{UPLOAD}/{media_id}/append", access_token,
                         data={"segment_index": str(index)},
                         files={"media": (f"chunk{index}", data[start:start + CHUNK_BYTES], "application/octet-stream")})
        final = _upload_call("POST", f"{UPLOAD}/{media_id}/finalize", access_token)
        self._wait(access_token, media_id, final.get("processing_info"), what)
        return media_id

    def _wait(self, access_token: str, media_id: str, processing: dict | None, what: str) -> None:
        timeout = float(os.getenv("X_MEDIA_TIMEOUT_SECONDS", "600"))
        deadline = _clock() + timeout
        while processing:
            state = str(processing.get("state") or "").lower()
            if state == "succeeded":
                return
            if state == "failed":
                err = processing.get("error") or {}
                reason = err.get("message") or err.get("name") if isinstance(err, dict) else None
                raise RuntimeError(f"X could not process the {what} (processing failed: {reason or 'no reason given'})")
            if _clock() >= deadline:
                raise RuntimeError(f"X {what} still processing after {int(timeout)} seconds (timed out)")
            _sleep(max(1.0, float(processing.get("check_after_secs") or 1)))
            info = _upload_call("GET", UPLOAD, access_token, params={"command": "STATUS", "media_id": media_id})
            processing = info.get("processing_info")

    def delete(self, access_token: str, provider_post_id: str) -> None:
        """Delete a tweet/post on X."""
        post_id = (provider_post_id or "").strip()
        if not post_id:
            raise ProviderConfigurationError("X delete needs a provider post id.")
        provider_delete(f"https://api.x.com/2/tweets/{post_id}", access_token=access_token)