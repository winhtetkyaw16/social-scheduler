"""Rewrite local upload paths into URLs social APIs can fetch."""

from __future__ import annotations

import ipaddress
import os
from pathlib import Path
from urllib.parse import urlparse, urlunparse

from app.core.config import PUBLIC_BASE_URL
from app.core.exceptions import ProviderConfigurationError

_LOCAL_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal"}
_PROJECT_ROOT = Path(__file__).resolve().parents[2]


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


def public_media_url(url: str, *, platform: str) -> str:
    """Return an absolute http(s) URL the provider can fetch, or raise."""
    candidate = (url or "").strip()
    if not candidate:
        raise ProviderConfigurationError(f"{platform} requires a media URL.")
    public_base = (os.getenv("PUBLIC_BASE_URL") or PUBLIC_BASE_URL or "").rstrip("/")
    if candidate.startswith("/") and public_base:
        candidate = f"{public_base}{candidate}"
    parsed = urlparse(candidate)
    if parsed.path.startswith("/static/uploads/") and public_base:
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
    """Map /static/uploads/... (or absolute URL to that path) onto the local uploads file."""
    candidate = (url or "").strip()
    if not candidate:
        return None
    parsed = urlparse(candidate if "://" in candidate else f"file://{candidate}")
    path = parsed.path if parsed.scheme else candidate
    if not path.startswith("/static/uploads/"):
        return None
    filename = Path(path).name
    if not filename or filename in {".", ".."} or "/" in filename or "\\" in filename:
        return None
    local = _PROJECT_ROOT / "frontend" / "static" / "uploads" / filename
    return local if local.is_file() else None


def guess_media_kind(url: str) -> str:
    """Return 'image', 'video', or 'unknown' from the URL extension."""
    path = urlparse(url).path.lower() if "://" in url else url.lower()
    if any(path.endswith(ext) for ext in (".mp4", ".mov", ".m4v", ".webm", ".ogv", ".avi", ".mkv")):
        return "video"
    if any(path.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif")):
        return "image"
    return "unknown"
