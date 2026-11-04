"""Automatic, per-network media conversions done at publish time.

The composer shows these as muted notes ("We'll save photos as JPG for Instagram."), never as errors.
Only files we host (``/static/uploads/...``) are converted; remote URLs are passed through untouched.
Converted copies are written next to the original upload and reused on retry; failures fall back to the
original file so the network's own validation still applies.

    instagram  any non-JPG photo -> JPG; photos outside 4:5 .. 1.91:1 are center-cropped
    linkedin   WebP -> PNG/JPG; MOV/M4V -> MP4 when ffmpeg is installed
    facebook   WebP -> PNG/JPG; photos over 4 MB are compressed
    tiktok     PNG (and other non JPG/WebP photos) -> JPG
    youtube    only the first video is sent (extra photos are ignored)
"""

from __future__ import annotations

import hashlib
import logging
import shutil
import subprocess
from pathlib import Path

from app.integrations.media_urls import guess_media_kind, local_upload_path

log = logging.getLogger(__name__)

IG_MIN_RATIO = 0.8
IG_MAX_RATIO = 1.91
FB_MAX_PHOTO_BYTES = 4 * 1024 * 1024
_JPEG_EXT = {".jpg", ".jpeg"}


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def instagram_crop_box(width: int, height: int) -> tuple[int, int, int, int]:
    """Center-crop box (left, top, right, bottom) that brings a photo into Instagram's 4:5 .. 1.91:1 range."""
    ratio = width / height
    if ratio > IG_MAX_RATIO:
        w = round(height * IG_MAX_RATIO)
        left = (width - w) // 2
        return left, 0, left + w, height
    if ratio < IG_MIN_RATIO:
        h = round(width / IG_MIN_RATIO)
        top = (height - h) // 2
        return 0, top, width, top + h
    return 0, 0, width, height


def _ext(url: str) -> str:
    return Path(str(url).split("?")[0].split("#")[0]).suffix.lower()


def _sibling_url(url: str, name: str) -> str:
    base = str(url).split("?")[0].split("#")[0]
    return base.rsplit("/", 1)[0] + "/" + name


def _out_path(src: Path, tag: str, ext: str) -> Path:
    digest = hashlib.sha1(f"{src.name}:{src.stat().st_size}:{tag}".encode()).hexdigest()[:8]
    return src.with_name(f"{src.stem}-{tag}-{digest}{ext}")


def _save_image(src: Path, tag: str, *, fmt: str, crop_instagram: bool = False, max_bytes: int | None = None) -> Path:
    from PIL import Image, ImageOps

    ext = ".jpg" if fmt == "JPEG" else ".png"
    out = _out_path(src, tag, ext)
    if out.is_file():
        return out
    with Image.open(src) as opened:
        img = ImageOps.exif_transpose(opened)
        img.load()
    if crop_instagram and img.width and img.height:
        box = instagram_crop_box(img.width, img.height)
        if box != (0, 0, img.width, img.height):
            img = img.crop(box)
    if fmt == "JPEG":
        if img.mode in ("RGBA", "LA", "P"):
            rgba = img.convert("RGBA")
            bg = Image.new("RGB", rgba.size, (255, 255, 255))
            bg.paste(rgba, mask=rgba.split()[-1])
            img = bg
        elif img.mode != "RGB":
            img = img.convert("RGB")
        quality = 90
        img.save(out, "JPEG", quality=quality, optimize=True)
        while max_bytes and out.stat().st_size > max_bytes:
            if quality > 60:
                quality -= 10
            else:
                img = img.resize((max(1, int(img.width * 0.85)), max(1, int(img.height * 0.85))))
            img.save(out, "JPEG", quality=quality, optimize=True)
    else:
        img.save(out, "PNG", optimize=True)
    return out


def _has_alpha(src: Path) -> bool:
    from PIL import Image

    with Image.open(src) as img:
        return img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)


def _needs_ig_crop(src: Path) -> bool:
    from PIL import Image

    with Image.open(src) as img:
        w, h = img.size
    return bool(w and h) and not (IG_MIN_RATIO <= w / h <= IG_MAX_RATIO)


def _video_to_mp4(src: Path) -> Path | None:
    exe = shutil.which("ffmpeg")
    if not exe:
        return None
    out = _out_path(src, "mp4", ".mp4")
    if out.is_file():
        return out
    cmd = [exe, "-y", "-loglevel", "error", "-i", str(src), "-c:v", "libx264", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-movflags", "+faststart", str(out)]
    result = subprocess.run(cmd, capture_output=True, timeout=1800, check=False)
    if result.returncode != 0 or not out.is_file():
        out.unlink(missing_ok=True)
        return None
    return out


def convert_one(platform: str, url: str) -> str:
    """Return the URL to publish for ``platform`` (a converted sibling upload, or ``url`` unchanged)."""
    key = (platform or "").lower()
    src = local_upload_path(url)
    if src is None:
        return url
    ext = _ext(url)
    kind = guess_media_kind(url)
    out: Path | None = None
    if kind == "image" and ext != ".gif":
        if key == "instagram":
            crop = _needs_ig_crop(src)
            if crop or ext not in _JPEG_EXT:
                out = _save_image(src, "ig", fmt="JPEG", crop_instagram=crop)
        elif key in {"linkedin", "facebook"} and ext == ".webp":
            out = _save_image(src, key[:2], fmt="PNG" if _has_alpha(src) else "JPEG",
                              max_bytes=FB_MAX_PHOTO_BYTES if key == "facebook" else None)
        elif key == "facebook" and src.stat().st_size > FB_MAX_PHOTO_BYTES:
            out = _save_image(src, "fb", fmt="JPEG", max_bytes=FB_MAX_PHOTO_BYTES)
        elif key == "tiktok" and ext not in _JPEG_EXT | {".webp"}:
            out = _save_image(src, "tt", fmt="JPEG")
    elif kind == "video" and key == "linkedin" and ext in {".mov", ".m4v"}:
        out = _video_to_mp4(src)
    return _sibling_url(url, out.name) if out is not None else url


def prepare_media(platform: str, media_urls: list[str] | None) -> list[str]:
    """Apply the automatic conversions for one network. Never raises; falls back to the original URL."""
    media = [str(m) for m in (media_urls or [])]
    key = (platform or "").lower()
    if key == "youtube":
        videos = [m for m in media if guess_media_kind(m) == "video"]
        if videos:
            media = videos[:1]
    prepared = []
    for url in media:
        try:
            prepared.append(convert_one(key, url))
        except Exception:  # noqa: BLE001 - conversion is best effort, the network validates the original
            log.warning("media conversion failed for %s", key, exc_info=True)
            prepared.append(url)
    return prepared
