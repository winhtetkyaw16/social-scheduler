"""Automatic, per-network media conversions done at publish time.

The composer shows these as muted notes ("We'll save photos as JPG for Instagram."), never as errors.
Only files we host (``/static/uploads/...``) are converted; remote URLs are passed through untouched.
Converted copies are written next to the original upload and reused on retry; failures fall back to the
original file so the network's own validation still applies.

    instagram  any non-JPG photo -> JPG; feed photos are cropped to one shared frame (4:5 .. 1.91:1, first photo
               decides, user ratio/offsets from post metadata ``ig_crop`` win); photos whose shortest side is under
               320px are upscaled (LANCZOS) after the crop; photos over 8 MB are compressed. Instagram only.
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
IG_MIN_SIDE = 320
IG_MAX_PHOTO_BYTES = 8 * 1024 * 1024
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


IG_FRAMES = (0.8, 1.0, 1.91)


def ig_clamp(ratio: float) -> float:
    return min(IG_MAX_RATIO, max(IG_MIN_RATIO, ratio))


def ig_nearest_frame(ratio: float) -> float:
    """Clamp into 4:5 .. 1.91:1, then snap to the nearest of 4:5, 1:1 and 1.91:1."""
    r = ig_clamp(ratio)
    return min(IG_FRAMES, key=lambda f: abs(f - r))


def ig_frame_ratio(
    photo_ratios: list[float], item_count: int, chosen: float | None = None
) -> float | None:
    """One frame for the whole Instagram feed post (like Instagram's own Create post).

    ``chosen`` (the user's 4:5 / 1:1 / 1.91:1 chip) wins. Otherwise the first photo decides: a carousel snaps to the
    nearest standard frame, a single photo is only clamped into range. ``None`` when there is no photo to measure.
    """
    if chosen:
        try:
            return ig_clamp(float(chosen))
        except (TypeError, ValueError):
            pass
    if not photo_ratios:
        return None
    first = photo_ratios[0]
    return ig_nearest_frame(first) if item_count > 1 else ig_clamp(first)


def _unit(v, default: float = 0.5) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return default if f != f else min(1.0, max(0.0, f))


def frame_crop_box(
    width: int, height: int, frame: float, off_x: float = 0.5, off_y: float = 0.5
) -> tuple[int, int, int, int]:
    """Crop box (left, top, right, bottom) of ``frame`` aspect inside the photo; offsets 0..1 pick the position."""
    ratio = width / height
    if abs(ratio - frame) < 0.005:
        return 0, 0, width, height
    if ratio > frame:
        w = max(1, round(height * frame))
        left = round((width - w) * _unit(off_x))
        return left, 0, left + w, height
    h = max(1, round(width / frame))
    top = round((height - h) * _unit(off_y))
    return 0, top, width, top + h


def _ext(url: str) -> str:
    return Path(str(url).split("?")[0].split("#")[0]).suffix.lower()


def _sibling_url(url: str, name: str) -> str:
    base = str(url).split("?")[0].split("#")[0]
    return base.rsplit("/", 1)[0] + "/" + name


def _out_path(src: Path, tag: str, ext: str) -> Path:
    digest = hashlib.sha1(
        f"{src.name}:{src.stat().st_size}:{tag}".encode()
    ).hexdigest()[:8]
    return src.with_name(f"{src.stem}-{tag}-{digest}{ext}")


def _save_image(
    src: Path,
    tag: str,
    *,
    fmt: str,
    crop_instagram: bool = False,
    max_bytes: int | None = None,
    frame: tuple[float, float, float] | None = None,
    min_side: int | None = None,
) -> Path:
    from PIL import Image, ImageOps

    ext = ".jpg" if fmt == "JPEG" else ".png"
    out = _out_path(src, tag, ext)
    if out.is_file():
        return out
    with Image.open(src) as opened:
        img = ImageOps.exif_transpose(opened)
        img.load()
    if frame and img.width and img.height:
        box = frame_crop_box(img.width, img.height, *frame)
        if box != (0, 0, img.width, img.height):
            img = img.crop(box)
    elif crop_instagram and img.width and img.height:
        box = instagram_crop_box(img.width, img.height)
        if box != (0, 0, img.width, img.height):
            img = img.crop(box)
    if min_side and img.width and img.height and min(img.width, img.height) < min_side:
        # Crop first, then upscale, so the final output always meets the minimum.
        scale = min_side / min(img.width, img.height)
        size = (
            max(min_side, round(img.width * scale)),
            max(min_side, round(img.height * scale)),
        )
        img = img.resize(size, Image.LANCZOS)
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
            elif min_side and min(img.width, img.height) * 0.85 < min_side:
                break
            else:
                img = img.resize(
                    (max(1, int(img.width * 0.85)), max(1, int(img.height * 0.85)))
                )
            img.save(out, "JPEG", quality=quality, optimize=True)
    else:
        img.save(out, "PNG", optimize=True)
    return out


def _has_alpha(src: Path) -> bool:
    from PIL import Image

    with Image.open(src) as img:
        return img.mode in ("RGBA", "LA") or (
            img.mode == "P" and "transparency" in img.info
        )


def _photo_ratio(src: Path) -> float | None:
    from PIL import Image, ImageOps

    with Image.open(src) as img:
        w, h = (
            ImageOps.exif_transpose(img).size
            if img.getexif().get(0x0112, 1) in (5, 6, 7, 8)
            else img.size
        )
    return (w / h) if w and h else None


def _ig_small(src: Path) -> bool:
    from PIL import Image

    with Image.open(src) as img:
        w, h = img.size
    return bool(w and h) and min(w, h) < IG_MIN_SIDE


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
    cmd = [
        exe,
        "-y",
        "-loglevel",
        "error",
        "-i",
        str(src),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        str(out),
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=1800, check=False)
    if result.returncode != 0 or not out.is_file():
        out.unlink(missing_ok=True)
        return None
    return out


def convert_one(
    platform: str, url: str, frame: tuple[float, float, float] | None = None
) -> str:
    """Return the URL to publish for ``platform`` (a converted sibling upload, or ``url`` unchanged).

    ``frame`` = (ratio, off_x, off_y) crops an Instagram photo to the post's shared frame (Instagram only).
    """
    key = (platform or "").lower()
    src = local_upload_path(url)
    if src is None:
        return url
    ext = _ext(url)
    kind = guess_media_kind(url)
    out: Path | None = None
    if kind == "image" and ext != ".gif":
        if key == "instagram" and frame == "story":
            if (
                ext not in _JPEG_EXT
                or _ig_small(src)
                or src.stat().st_size > IG_MAX_PHOTO_BYTES
            ):
                out = _save_image(
                    src,
                    "igs",
                    fmt="JPEG",
                    min_side=IG_MIN_SIDE,
                    max_bytes=IG_MAX_PHOTO_BYTES,
                )
        elif key == "instagram" and frame:
            r = _photo_ratio(src)
            if (
                (r is not None and abs(r - frame[0]) >= 0.005)
                or ext not in _JPEG_EXT
                or _ig_small(src)
                or src.stat().st_size > IG_MAX_PHOTO_BYTES
            ):
                tag = (
                    "ig"
                    + hashlib.sha1(
                        ("%.4f:%.3f:%.3f:%d" % (*frame, IG_MIN_SIDE)).encode()
                    ).hexdigest()[:6]
                )
                out = _save_image(
                    src,
                    tag,
                    fmt="JPEG",
                    frame=frame,
                    min_side=IG_MIN_SIDE,
                    max_bytes=IG_MAX_PHOTO_BYTES,
                )
        elif key == "instagram":
            crop = _needs_ig_crop(src)
            if (
                crop
                or ext not in _JPEG_EXT
                or _ig_small(src)
                or src.stat().st_size > IG_MAX_PHOTO_BYTES
            ):
                out = _save_image(
                    src,
                    "ig",
                    fmt="JPEG",
                    crop_instagram=crop,
                    min_side=IG_MIN_SIDE,
                    max_bytes=IG_MAX_PHOTO_BYTES,
                )
        elif key in {"linkedin", "facebook"} and ext == ".webp":
            out = _save_image(
                src,
                key[:2],
                fmt="PNG" if _has_alpha(src) else "JPEG",
                max_bytes=FB_MAX_PHOTO_BYTES if key == "facebook" else None,
            )
        elif key == "facebook" and src.stat().st_size > FB_MAX_PHOTO_BYTES:
            out = _save_image(src, "fb", fmt="JPEG", max_bytes=FB_MAX_PHOTO_BYTES)
        elif key == "tiktok" and ext not in _JPEG_EXT | {".webp"}:
            out = _save_image(src, "tt", fmt="JPEG")
    elif kind == "video" and key == "linkedin" and ext in {".mov", ".m4v"}:
        out = _video_to_mp4(src)
    return _sibling_url(url, out.name) if out is not None else url


def _ig_frames(
    media: list[str], ig_crop: dict | None
) -> list[tuple[float, float, float] | None]:
    """Per-item crop frames for an Instagram feed post: one shared ratio, per-item offsets (by index)."""
    crop = ig_crop if isinstance(ig_crop, dict) else {}
    if crop.get("format") == "Story":
        return ["story"] * len(
            media
        )  # Stories: no feed frame, Instagram fits 9:16 itself
    ratios: list[float] = []
    for url in media:
        if guess_media_kind(url) != "image" or _ext(url) == ".gif":
            continue
        src = local_upload_path(url)
        if src is None or not src.is_file():
            continue
        try:
            r = _photo_ratio(src)
        except (
            Exception
        ):  # noqa: BLE001 - unreadable photo: let the network validate it
            r = None
        if r:
            ratios.append(r)
            break
    frame = ig_frame_ratio(ratios, len(media), crop.get("ratio"))
    if frame is None:
        return [None] * len(media)
    offsets = crop.get("offsets") if isinstance(crop.get("offsets"), list) else []
    out = []
    for i in range(len(media)):
        o = (
            offsets[i]
            if i < len(offsets)
            and isinstance(offsets[i], (list, tuple))
            and len(offsets[i]) == 2
            else (0.5, 0.5)
        )
        out.append((frame, _unit(o[0]), _unit(o[1])))
    return out


def prepare_media(
    platform: str, media_urls: list[str] | None, ig_crop: dict | None = None
) -> list[str]:
    """Apply the automatic conversions for one network. Never raises; falls back to the original URL.

    For Instagram feed posts every photo is cropped to ONE frame (``ig_crop`` = {"ratio", "offsets", "format"} from
    the composer, or auto from the first photo). Other networks never see these crops.
    """
    media = [str(m) for m in (media_urls or [])]
    key = (platform or "").lower()
    frames: list = [None] * len(media)
    if key == "instagram":
        try:
            frames = _ig_frames(media, ig_crop)
        except Exception:  # noqa: BLE001
            log.warning("instagram frame detection failed", exc_info=True)
    if key == "youtube":
        videos = [m for m in media if guess_media_kind(m) == "video"]
        if videos:
            media = videos[:1]
    prepared = []
    for i, url in enumerate(media):
        try:
            prepared.append(
                convert_one(key, url, frames[i] if i < len(frames) else None)
            )
        except (
            Exception
        ):  # noqa: BLE001 - conversion is best effort, the network validates the original
            log.warning("media conversion failed for %s", key, exc_info=True)
            prepared.append(url)
    return prepared
