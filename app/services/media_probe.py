"""Local-only media measurement for format limits.

Never fetches a URL. Callers pass a path that already lives on this machine
(an uploaded file). ffprobe is optional: if it is missing or fails, MP4/MOV
headers and image headers are read instead. A failure returns partial facts,
it does not raise.
"""

from __future__ import annotations

import json
import struct
import subprocess
from dataclasses import dataclass
from pathlib import Path

from app.integrations.media_urls import local_upload_path
from app.integrations.platforms.linkedin import image_size, mp4_duration_seconds


@dataclass(frozen=True)
class MediaFacts:
    """What we could read without contacting another host."""

    duration: float | None = None
    width: int | None = None
    height: int | None = None
    fps: float | None = None
    size_bytes: int | None = None


def inspect_media(url: str) -> MediaFacts | None:
    """Facts for a local upload, or None when the URL is not a local file.

    Remote and private URLs are not downloaded. That keeps format checks from
    becoming an SSRF probe.
    """
    path = local_upload_path(url)
    if path is None:
        return None
    return inspect_path(path)


def inspect_path(path: Path) -> MediaFacts:
    """Measure one local file. Missing ffprobe falls back to header parsing."""
    try:
        size = path.stat().st_size
    except OSError:
        return MediaFacts()
    probed = _ffprobe(path)
    if probed is not None:
        facts = _facts_from_ffprobe(probed, size)
        if facts.duration is not None or (facts.width and facts.height):
            return facts
    data = _read_headers(path, size)
    duration = mp4_duration_seconds(data)
    dims = mp4_video_dimensions(data) or image_size(data)
    width, height = dims if dims else (None, None)
    return MediaFacts(
        duration=duration, width=width, height=height, fps=None, size_bytes=size
    )


def measure_bytes(data: bytes) -> MediaFacts:
    """Measure bytes already in memory (no network, no ffprobe required)."""
    duration = mp4_duration_seconds(data)
    dims = mp4_video_dimensions(data) or image_size(data)
    width, height = dims if dims else (None, None)
    facts = MediaFacts(
        duration=duration, width=width, height=height, fps=None, size_bytes=len(data)
    )
    if facts.duration is not None and facts.width and facts.height:
        return facts
    # Short clips only. A huge buffer is not written to disk just to probe it.
    if len(data) > 80 * 1024 * 1024:
        return facts
    probed = _ffprobe_bytes(data)
    if probed is None:
        return facts
    richer = _facts_from_ffprobe(probed, len(data))
    return MediaFacts(
        duration=richer.duration if richer.duration is not None else facts.duration,
        width=richer.width or facts.width,
        height=richer.height or facts.height,
        fps=richer.fps,
        size_bytes=len(data),
    )


def mp4_video_dimensions(data: bytes) -> tuple[int, int] | None:
    """Largest non-zero tkhd width/height under moov (16.16 fixed point)."""
    best: tuple[int, int] | None = None
    best_area = 0
    for payload in _tkhd_payloads(data):
        dims = _tkhd_size(payload)
        if not dims:
            continue
        area = dims[0] * dims[1]
        if area > best_area:
            best, best_area = dims, area
    return best


def _tkhd_size(payload: bytes) -> tuple[int, int] | None:
    if not payload:
        return None
    version = payload[0]
    offset = 88 if version == 1 else 76
    if len(payload) < offset + 8:
        return None
    raw_w, raw_h = struct.unpack(">II", payload[offset : offset + 8])
    width, height = raw_w >> 16, raw_h >> 16
    if width <= 0 or height <= 0:
        return None
    return width, height


def _tkhd_payloads(data: bytes):
    def walk(start: int, end: int, depth: int):
        if depth > 8:
            return
        for kind, payload_start, payload_end in _boxes(data, start, end):
            if kind == b"tkhd":
                yield data[payload_start:payload_end]
            elif kind in {b"moov", b"trak", b"mdia", b"minf", b"stbl"}:
                yield from walk(payload_start, payload_end, depth + 1)

    yield from walk(0, len(data), 0)


def _boxes(buf: bytes, start: int, end: int):
    i = start
    while i + 8 <= end:
        size, kind = struct.unpack(">I4s", buf[i : i + 8])
        header = 8
        if size == 1 and i + 16 <= end:
            size = struct.unpack(">Q", buf[i + 8 : i + 16])[0]
            header = 16
        elif size == 0:
            size = end - i
        if size < header or i + size > end + 8:
            return
        yield kind, i + header, min(i + size, end)
        i += size


def _read_headers(path: Path, size: int) -> bytes:
    """Head and tail only, so a moov-at-end file can be read without loading the mdat."""
    cap = 8 * 1024 * 1024
    try:
        with path.open("rb") as handle:
            head = handle.read(cap)
            if size <= cap:
                return head
            handle.seek(max(0, size - cap))
            tail = handle.read(cap)
    except OSError:
        return b""
    return head + tail


def _ffprobe(path: Path) -> dict | None:
    try:
        proc = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_streams",
                "-show_format",
                str(path),
            ],
            capture_output=True,
            timeout=20,
            check=False,
        )
    except FileNotFoundError:
        return None
    except (OSError, subprocess.TimeoutExpired):
        return None
    return _parse_ffprobe(proc)


def _ffprobe_bytes(data: bytes) -> dict | None:
    try:
        proc = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_streams",
                "-show_format",
                "-i",
                "pipe:0",
            ],
            input=data,
            capture_output=True,
            timeout=20,
            check=False,
        )
    except FileNotFoundError:
        return None
    except (OSError, subprocess.TimeoutExpired):
        return None
    return _parse_ffprobe(proc)


def _parse_ffprobe(proc: subprocess.CompletedProcess) -> dict | None:
    if proc.returncode != 0 or not proc.stdout:
        return None
    try:
        body = json.loads(proc.stdout.decode("utf-8", "replace"))
    except json.JSONDecodeError:
        return None
    return body if isinstance(body, dict) else None


def _facts_from_ffprobe(body: dict, size: int) -> MediaFacts:
    streams = body.get("streams") if isinstance(body.get("streams"), list) else []
    video = next(
        (
            item
            for item in streams
            if isinstance(item, dict) and item.get("codec_type") == "video"
        ),
        None,
    )
    width = height = None
    fps = None
    duration = None
    if isinstance(video, dict):
        width = _positive_int(video.get("width"))
        height = _positive_int(video.get("height"))
        fps = _fps(video.get("avg_frame_rate")) or _fps(video.get("r_frame_rate"))
        duration = _positive_float(video.get("duration"))
    fmt = body.get("format") if isinstance(body.get("format"), dict) else {}
    if duration is None:
        duration = _positive_float(fmt.get("duration"))
    return MediaFacts(
        duration=duration, width=width, height=height, fps=fps, size_bytes=size
    )


def _positive_int(value) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _positive_float(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _fps(value) -> float | None:
    if not isinstance(value, str) or not value or value in {"0/0", "N/A"}:
        return None
    if "/" in value:
        num, den = value.split("/", 1)
        try:
            denominator = float(den)
            return float(num) / denominator if denominator else None
        except ValueError:
            return None
    return _positive_float(value)
