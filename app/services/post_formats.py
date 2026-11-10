"""Composer format rules shared by create, draft materialize, retry, and the worker.

Limits follow the 2026-11-07 research in the format audit, checked against the
publisher docs named below. Duration, pixel size, and aspect are enforced when
the file is a local upload we can measure. Remote URLs are not downloaded here
(that would be an SSRF probe). Count and format routing are always enforced.

YouTube Short is the exception: YouTube will not reject a landscape or long
upload, and there is no API flag, so an unmeasured Short is refused.

Documented limits
- Facebook Reel (`/{page-id}/video_reels`): 9:16, at least 540x960, 3–90 s,
  24–60 fps when ffprobe reports it.
  https://developers.facebook.com/docs/video-api/guides/reels-publishing/
- Facebook Story (`/photo_stories`, `/video_stories`): video max 60 s. The
  stories guide points at Reel specs for the picture, so 9:16 and 540x960 are
  applied when measured. Helper research listed only the 60 s cap; the 3 s
  floor is the Reel minimum carried over by that "same specs" note.
  https://developers.facebook.com/docs/video-api/guides/page-stories/
- Instagram Story: one item; video 3–60 s, aspect 0.1:1–10:1 when known.
  Instagram Reel: exactly one video, 3 s–15 min, aspect 0.01:1–10:1 when known.
  https://developers.facebook.com/docs/instagram-platform/content-publishing/
- YouTube Short: square or vertical and at most 3 minutes. No publishAsShort.
  https://support.google.com/youtube/answer/15424877
- YouTube Community posts: no Data API create method. Rejected.
- TikTok Story: not in the Content Posting API. Rejected.
- Pinterest Video Pin: 4 s–5 min when known. One video plus a cover image.
  The API file-size cap was not stated on the pages checked, so it is not invented.
  https://developers.pinterest.com/docs/api/v5/#operation/media/create
"""

from __future__ import annotations

from app.services.error_messages import (
    is_video_url,
    media_requirement_error,
    network_name,
)
from app.services.media_probe import MediaFacts, inspect_media

POST = "Post"
REEL = "Reel / Video"
STORY = "Story"
SHORT = "Short"

VIDEO_FORMATS = {REEL, SHORT}

# Order is the composer order. YouTube has no Community post. TikTok has no Story.
SUPPORTED: dict[str, tuple[str, ...]] = {
    "facebook": (POST, REEL, STORY),
    "instagram": (POST, REEL, STORY),
    "youtube": (REEL, SHORT),
    "tiktok": (POST, REEL),
    "x": (POST, REEL),
    "twitter": (POST, REEL),
    "linkedin": (POST, REEL),
    "pinterest": (POST, REEL),
    "threads": (POST,),
}

_REMOVED = {
    ("youtube", POST): (
        "YouTube Community posts are not available through YouTube's API. "
        "Choose Video or Short. Nothing was uploaded."
    ),
    ("tiktok", STORY): (
        "TikTok Story is not part of TikTok's Content Posting API. "
        "Choose Photo post or Video. Nothing was posted."
    ),
}

_NINE_SIXTEEN = 9 / 16
_ASPECT_TOLERANCE = 0.03

MISSING_FORMAT = "Choose a format before publishing. This post has no saved format, so it was not sent."


def normalize_platform(platform: str | None) -> str:
    key = (platform or "").strip().lower()
    return "x" if key == "twitter" else key


def row_format(metadata) -> str | None:
    """Saved composer format, or None when the row does not have one."""
    if not isinstance(metadata, dict):
        return None
    value = metadata.get("format")
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def video_format_message(post_format: str) -> str:
    """Same sentence as the composer (fixPlan.videoFormatMessage)."""
    if post_format == SHORT:
        return (
            "Please include a video for this Short — tick a video for this account, "
            "or remove YouTube Shorts from the post."
        )
    return (
        "Please include a video for this video post — tick a video for this account, "
        "or switch the post type to Post."
    )


def draft_account_format(
    metadata: dict,
    account_id,
    post_format: str | None,
    *,
    account_count: int,
) -> tuple[str | None, str | None]:
    """Per-account draft format.

    A missing key does not copy another account's post_format. The primary
    account (first selected id) may still use the draft's own post_format,
    and a one-account draft may too. Anything else returns an error string.
    """
    formats = (
        metadata.get("formatsByAccount")
        if isinstance(metadata.get("formatsByAccount"), dict)
        else {}
    )
    key = str(account_id)
    own = formats.get(key)
    if isinstance(own, str) and own.strip():
        return own.strip(), None
    selected = (
        metadata.get("selectedIds")
        if isinstance(metadata.get("selectedIds"), list)
        else []
    )
    primary = str(selected[0]) if selected else ""
    fallback = post_format.strip() if isinstance(post_format, str) else ""
    if fallback and (account_count == 1 or (primary and primary == key)):
        return fallback, None
    if account_count > 1:
        copied = f" ({fallback})" if fallback else ""
        return None, (
            "This draft has no format saved for this channel. "
            f"Another channel's format{copied} was not copied. "
            "Open the draft and choose a format for this channel."
        )
    return None, None


def publish_problem(
    platform: str | None,
    media_urls: list | None,
    content: str | None,
    post_format: str | None = None,
) -> str | None:
    """Blocking reason, or None when this post may be queued."""
    key = normalize_platform(platform)
    media = [str(item) for item in (media_urls or [])]
    fmt = post_format.strip() if isinstance(post_format, str) else ""
    if not fmt:
        return MISSING_FORMAT
    removed = _REMOVED.get((key, fmt))
    if removed:
        return removed
    allowed = SUPPORTED.get(key)
    if allowed is None:
        return media_requirement_error(platform, media, content)
    if fmt not in allowed:
        label = network_name(key) if key else "this channel"
        return f"{fmt} is not available for {label}. Choose a supported format. Nothing was published."
    if fmt == STORY and not media:
        return "Add a photo or video to create this Story."
    # Mix, count, and "this network needs a video" stay in the shared media check so the
    # wording does not change. Format rules add the cases that check does not know about
    # (Story/Reel shape, Short classification, photo-post vs video-post).
    structural = media_requirement_error(platform, media, content)
    if structural:
        return structural
    if fmt in VIDEO_FORMATS and not any(is_video_url(item) for item in media):
        return video_format_message(fmt)
    return _format_limits(key, fmt, media)


def short_problem(facts: MediaFacts | None) -> str | None:
    """YouTube Short gate. None means the file may be uploaded as a normal video.

    The upload itself has no Shorts flag. This only decides whether we refuse
    to upload a file that YouTube would not classify as a Short.
    """
    if facts is None or facts.duration is None or not facts.width or not facts.height:
        return (
            "Couldn't confirm this video is square or vertical and at most 3 minutes. "
            "YouTube has no API flag that forces a Short, so it was not uploaded. "
            "Choose Video, or attach a file this app can measure."
        )
    if facts.width > facts.height:
        return (
            f"YouTube Shorts must be square or vertical and at most 3 minutes. "
            f"This video is {facts.width}×{facts.height}. "
            "YouTube has no API flag that forces a Short, so it was not uploaded. Choose Video to post it as a regular video."
        )
    if facts.duration > 180:
        return (
            f"YouTube Shorts must be at most 3 minutes. This video is {_clock(facts.duration)}. "
            "YouTube has no API flag that forces a Short, so it was not uploaded. Choose Video to post it as a regular video."
        )
    return None


def _format_limits(platform: str, fmt: str, media: list[str]) -> str | None:
    """A user-facing reason this format cannot be published, or None when the media fits."""
    if platform == "facebook" and fmt == REEL:
        return _one_video(
            media,
            "A Facebook Reel needs exactly one video. It was not published as a Page post.",
        ) or _facebook_reel(media[0] if media else "")
    if platform == "facebook" and fmt == STORY:
        return _one_item(
            media,
            "A Facebook Story needs one photo or one video. It was not published to the feed.",
        ) or _facebook_story(media[0])
    if platform == "instagram" and fmt == STORY:
        count = _one_item(
            media,
            "An Instagram Story needs one photo or one video. It was not published to the feed.",
        )
        return count or _instagram_story(media[0])
    if platform == "instagram" and fmt == REEL:
        return _one_video(
            media,
            "An Instagram Reel needs exactly one video. It was not published as a carousel or feed post.",
        ) or _instagram_reel(media[0])
    if platform == "youtube" and fmt == SHORT:
        return _youtube_short(media)
    if platform == "pinterest" and fmt == REEL:
        return _pinterest_video(media)
    if (
        platform == "pinterest"
        and fmt == POST
        and any(is_video_url(item) for item in media)
    ):
        return "A Pinterest photo Pin can't include a video. Choose Video Pin and add a cover image. Nothing was pinned."
    if platform == "tiktok" and fmt == REEL:
        return _one_video(
            media,
            "A TikTok video needs exactly one video. It was not posted as a photo post.",
        )
    if (
        platform == "tiktok"
        and fmt == POST
        and any(is_video_url(item) for item in media)
    ):
        return "A TikTok photo post needs photos, not a video. Switch the format to Video. Nothing was posted."
    if (
        platform in {"x", "linkedin"}
        and fmt == REEL
        and not any(is_video_url(item) for item in media)
    ):
        name = "X" if platform == "x" else "LinkedIn"
        return f"A {name} video post needs a video. It was not published as a text or photo post."
    return None


def _one_item(media: list[str], message: str) -> str | None:
    """Return message unless media contains exactly one file."""
    return None if len(media) == 1 else message


def _one_video(media: list[str], message: str) -> str | None:
    """Return message unless media is exactly one video."""
    videos = [item for item in media if is_video_url(item)]
    if len(media) == 1 and len(videos) == 1:
        return None
    return message


def _facebook_reel(url: str) -> str | None:
    """A Facebook Reel length, shape, or frame-rate problem, or None."""
    facts = inspect_media(url)
    if facts is None:
        return None
    if facts.duration is not None and not (3 <= facts.duration <= 90):
        return f"Facebook Reels must be 3 to 90 seconds long. This one is {_clock(facts.duration)}. It was not published as a Page video."
    shape = _vertical_9_16(facts, minimum=(540, 960))
    if shape:
        return f"Facebook Reels must be vertical 9:16 and at least 540×960. {shape} It was not published as a Page video."
    if facts.fps is not None and not (24 <= facts.fps <= 60):
        return f"Facebook Reels must be 24 to 60 frames per second. This one is {facts.fps:.0f} fps."
    return None


def _facebook_story(url: str) -> str | None:
    """A Facebook Story size or video-shape problem, or None."""
    if not is_video_url(url):
        facts = inspect_media(url)
        if (
            facts
            and facts.size_bytes is not None
            and facts.size_bytes > 10 * 1024 * 1024
        ):
            return "Facebook photo Stories must be 10 MB or smaller."
        return None
    facts = inspect_media(url)
    if facts is None:
        return None
    # Stories guide: video length cap is 60 s; picture specs follow Reels (including the 3 s floor).
    if facts.duration is not None and not (3 <= facts.duration <= 60):
        return f"Facebook video Stories must be 3 to 60 seconds long. This one is {_clock(facts.duration)}. It was not published to the feed."
    shape = _vertical_9_16(facts, minimum=(540, 960))
    if shape:
        return f"Facebook video Stories must be vertical 9:16 and at least 540×960. {shape} It was not published to the feed."
    return None


def _instagram_story(url: str) -> str | None:
    """An Instagram Story size, length, or aspect problem, or None."""
    facts = inspect_media(url)
    if not is_video_url(url):
        if (
            facts
            and facts.size_bytes is not None
            and facts.size_bytes > 8 * 1024 * 1024
        ):
            return "Instagram Story photos must be 8 MB or smaller."
        return None
    if facts is None:
        return None
    if facts.size_bytes is not None and facts.size_bytes > 100 * 1024 * 1024:
        return "Instagram Story videos must be 100 MB or smaller."
    if facts.duration is not None and not (3 <= facts.duration <= 60):
        return f"Instagram Story videos must be 3 to 60 seconds long. This one is {_clock(facts.duration)}. It was not published to the feed."
    ratio = _ratio(facts)
    if ratio is not None and not (0.1 <= ratio <= 10):
        return "Instagram Story videos must have an aspect ratio between 0.1:1 and 10:1. It was not published to the feed."
    return None


def _instagram_reel(url: str) -> str | None:
    """An Instagram Reel size, length, or aspect problem, or None."""
    facts = inspect_media(url)
    if facts is None:
        return None
    if facts.size_bytes is not None and facts.size_bytes > 300 * 1024 * 1024:
        return "Instagram Reels must be 300 MB or smaller. It was not published as a carousel."
    if facts.duration is not None and not (3 <= facts.duration <= 900):
        return f"Instagram Reels must be 3 seconds to 15 minutes long. This one is {_clock(facts.duration)}. It was not published as a carousel."
    ratio = _ratio(facts)
    if ratio is not None and not (0.01 <= ratio <= 10):
        return "Instagram Reels must have an aspect ratio between 0.01:1 and 10:1. It was not published as a carousel."
    return None


def _youtube_short(media: list[str]) -> str | None:
    """A YouTube Shorts measurement problem when the only video is not a Short."""
    videos = [item for item in media if is_video_url(item)]
    if len(videos) != 1:
        return None
    return short_problem(inspect_media(videos[0]))


def _pinterest_video(media: list[str]) -> str | None:
    """A Video Pin problem unless there is one video, one cover, and a valid duration."""
    videos = [item for item in media if is_video_url(item)]
    images = [item for item in media if not is_video_url(item)]
    if len(videos) != 1 or len(images) != 1 or len(media) != 2:
        return (
            "A Pinterest Video Pin needs one video and one cover image. "
            "Nothing was pinned."
        )
    facts = inspect_media(videos[0])
    if facts is None or facts.duration is None:
        return None
    if not (4 <= facts.duration <= 300):
        return f"Pinterest video Pins must be 4 seconds to 5 minutes long. This one is {_clock(facts.duration)}."
    return None


def _vertical_9_16(facts: MediaFacts, *, minimum: tuple[int, int]) -> str | None:
    """A size sentence when the video is below minimum or not within tolerance of 9:16."""
    if not facts.width or not facts.height:
        return None
    if facts.width < minimum[0] or facts.height < minimum[1]:
        return f"This video is {facts.width}×{facts.height}."
    ratio = facts.width / facts.height
    if abs(ratio - _NINE_SIXTEEN) / _NINE_SIXTEEN > _ASPECT_TOLERANCE:
        return f"This video is {facts.width}×{facts.height}."
    return None


def _ratio(facts: MediaFacts) -> float | None:
    """Width divided by height, or None when either side is missing."""
    if not facts.width or not facts.height:
        return None
    return facts.width / facts.height


def _clock(seconds: float) -> str:
    """Format a duration in seconds as m:ss."""
    total = int(round(seconds))
    return f"{total // 60}:{total % 60:02d}"
