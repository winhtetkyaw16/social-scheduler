"""Rewrite local upload paths into URLs social APIs can fetch."""

from __future__ import annotations

import ipaddress
import os
from pathlib import Path
from urllib.parse import urlparse, urlunparse

from app.core.config import PUBLIC_BASE_URL, prefer_https
from app.core.exceptions import ProviderConfigurationError

_LOCAL_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal"}
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_HOSTED_PREFIXES = ("/media/", "/static/uploads/")
_UPLOADS_DIR = _PROJECT_ROOT / "frontend" / "static" / "uploads"


def host_is_public(hostname: str | None) -> bool:
    if not hostname:
        return False
    host = hostname.strip().lower().rstrip(".")
    if host in _LOCAL_HOSTS or host.endswith(".local") or host.endswith(".localhost"):
        return False
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return True
    return not (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        or address.is_multicast
        or address.is_unspecified
    )


def canonical_public_base() -> str:
    """PUBLIC_BASE_URL for this process, with https on a public host."""
    raw = (os.getenv("PUBLIC_BASE_URL") or PUBLIC_BASE_URL or "").strip().rstrip("/")
    return prefer_https(raw) if raw else ""


def _is_hosted_media_path(path: str) -> bool:
    return any(path.startswith(prefix) for prefix in _HOSTED_PREFIXES)


def hosted_media_filename(url: str) -> str | None:
    """Filename for a URL we host at /media/ or the legacy /static/uploads/ path."""
    candidate = (url or "").strip()
    if not candidate:
        return None
    parsed = urlparse(candidate if "://" in candidate else f"file://{candidate}")
    path = parsed.path if parsed.scheme else candidate
    if not _is_hosted_media_path(path):
        return None
    filename = Path(path).name
    if (
        not filename
        or filename in {".", ".."}
        or "/" in filename
        or "\\" in filename
        or ".." in filename
    ):
        return None
    return filename


def hosted_media_url(filename: str) -> str:
    """Absolute public URL for a file stored in the uploads directory.

    Publishers and the browser both use this shape, for example
    ``https://api.socialcastly.com/media/<file>``.
    """
    name = hosted_media_filename(f"/media/{Path(str(filename)).name}")
    if not name:
        raise ValueError("invalid media filename")
    base = canonical_public_base()
    return f"{base}/media/{name}" if base else f"/media/{name}"


def public_media_url(url: str, *, platform: str) -> str:
    """Return an absolute http(s) URL the provider can fetch, or raise.

    This is the only URL builder publishers should call. Relative ``/media/...``
    and legacy ``/static/uploads/...`` paths are rewritten onto PUBLIC_BASE_URL
    when that origin is publicly reachable.
    """
    candidate = (url or "").strip()
    if not candidate:
        raise ProviderConfigurationError(f"{platform} requires a media URL.")
    public_base = canonical_public_base()
    if candidate.startswith("/") and public_base:
        candidate = f"{public_base}{candidate}"
    parsed = urlparse(candidate)
    if _is_hosted_media_path(parsed.path) and public_base:
        base = urlparse(public_base)
        if host_is_public(base.hostname):
            parsed = parsed._replace(scheme=base.scheme, netloc=base.netloc)
            candidate = urlunparse(parsed)
            parsed = urlparse(candidate)
    if parsed.scheme not in {"http", "https"} or not host_is_public(parsed.hostname):
        raise ProviderConfigurationError(
            f"{platform} requires a publicly fetchable media URL. Set PUBLIC_BASE_URL to a public "
            "https origin, or attach media that is already on a public URL."
        )
    return candidate


def local_upload_path(url: str) -> Path | None:
    """Map /media/... or /static/uploads/... onto the local uploads file."""
    filename = hosted_media_filename(url)
    if not filename:
        return None
    local = _UPLOADS_DIR / filename
    return local if local.is_file() else None


def guess_media_kind(url: str) -> str:
    """Return 'image', 'video', or 'unknown' from the URL extension."""
    path = urlparse(url).path.lower() if "://" in url else url.lower()
    if any(
        path.endswith(ext)
        for ext in (".mp4", ".mov", ".m4v", ".webm", ".ogv", ".avi", ".mkv")
    ):
        return "video"
    if any(
        path.endswith(ext)
        for ext in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif")
    ):
        return "image"
    return "unknown"
