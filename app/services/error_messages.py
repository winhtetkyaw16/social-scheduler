"""Translate stored publish failures into specific, plain-language copy.

Raw provider errors stay in the database. Copy is computed at response time
from ``last_error_code`` / ``last_error_message`` so existing failed posts pick
up new wording without a migration. Only the generic fallback quotes the raw
platform message, and only after ``sanitize_raw`` strips secrets and URLs.
"""

from __future__ import annotations

import re
from typing import Any, Iterable

NETWORK_NAMES = {
    "x": "X", "twitter": "X", "facebook": "Facebook", "instagram": "Instagram",
    "linkedin": "LinkedIn", "threads": "Threads", "tiktok": "TikTok",
    "youtube": "YouTube", "pinterest": "Pinterest", "bluesky": "Bluesky",
}

# Jargon that must not appear in the non-fallback copy.
BANNED_WORDS = ("developer account", "api", "json", "http", "error code", "portal", "oauth")

IG_NO_MEDIA = "instagram_no_media"
IG_ONE_IMAGE = "instagram_one_image"
IG_RATIO = "instagram_aspect_ratio"
MEDIA_NOT_PUBLIC = "media_not_public"
MEDIA_FETCH = "media_fetch_failed"
TIMEOUT = "timeout"
YOUTUBE_VIDEO = "youtube_video_required"
TIKTOK_VIDEO = "tiktok_one_video"
X_CREDITS = "x_credits_depleted"
CONNECTION = "connection_expired"
PERMISSION = "permission_missing"
APP_BLOCKED = "app_not_authorized"
DUPLICATE = "duplicate_content"
RATE_LIMIT = "rate_limited"
PLATFORM_DOWN = "platform_unavailable"
TOO_LONG = "text_too_long"
MEDIA_UNSUPPORTED = "media_not_supported"
DESTINATION = "destination_missing"
FALLBACK = "unknown"
# Back-compat alias for older imports.
PLATFORM = PLATFORM_DOWN
INSTAGRAM_RATIO = IG_RATIO

_HTTP_STATUS = re.compile(r"\bHTTP\s+(\d{3})\b", re.IGNORECASE)
_SECRETS = (
    re.compile(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]+"),
    re.compile(r"(?i)\b(access_token|refresh_token|client_secret|token|code|key|signature|sig)=[^&\s\"']+"),
    re.compile(r"(?i)https?://\S+"),
    re.compile(r"[A-Za-z0-9_\-]{32,}"),
)


def network_name(platform: str | None) -> str:
    key = (platform or "").strip().lower()
    return NETWORK_NAMES.get(key) or (key.capitalize() if key else "this network")


def sanitize_raw(message: str | None, limit: int = 200) -> str:
    """Strip tokens/URLs and the internal prefix from a provider message, then truncate."""
    text = (message or "").strip()
    text = re.sub(r"(?i)^provider returned http \d{3}:?\s*", "", text)
    for pattern in _SECRETS:
        text = pattern.sub("[hidden]", text)
    text = re.sub(r"\s+", " ", text).strip(" |")
    if len(text) > limit:
        text = text[: limit - 1].rstrip() + "â€¦"
    return text


def _status(text: str) -> int | None:
    match = _HTTP_STATUS.search(text)
    return int(match.group(1)) if match else None


def _has(text: str, needles: Iterable[str]) -> bool:
    return any(n in text for n in needles)


def classify_error(code: str | None, message: str | None, platform: str | None, media_urls: list | None = None) -> str:
    """Return the specific category for a stored raw failure."""
    key = (platform or "").lower()
    code_l = (code or "").lower()
    text = f"{code or ''} {message or ''}".lower()
    status = _status(message or "")
    media = list(media_urls) if media_urls is not None else None

    if key == "youtube" and _has(text, ("requires a video", "not an image", "no video", "video file is empty",
                                        "exactly one video", "text-only posts are not supported")):
        return YOUTUBE_VIDEO
    if key == "tiktok" and _has(text, ("exactly one video", "video file is empty", "no video",
                                       "photo posting is not implemented", "text-only posts are not supported")):
        return TIKTOK_VIDEO
    if key == "instagram":
        if "aspect ratio" in text or "aspect_ratio" in text:
            return IG_RATIO
        if "exactly one public image" in text or "exactly one image" in text:
            return IG_NO_MEDIA if media == [] else IG_ONE_IMAGE
        if "only photo or video can be accepted" in text or "media type" in text:
            return IG_ONE_IMAGE
    if _has(text, ("publicly fetchable", "public_base_url", "public url", "not publicly reachable")):
        return MEDIA_NOT_PUBLIC
    if _has(text, ("could not download", "could not pull", "failed to download", "media url",
                   "could not fetch", "media container failed")):
        return MEDIA_FETCH
    if _has(text, ("timeout", "timed out", "still processing")):
        return TIMEOUT
    if status == 402 or _has(text, ("credits depleted", "credits-depleted", "payment required", "usagecapexceeded",
                                    "usage cap")):
        return X_CREDITS if key in {"x", "twitter"} else RATE_LIMIT
    if status == 429 or _has(text, ("too many requests", "rate limit", "rate_limit", "(#4)", "(#17)", "(#32)",
                                    "(#613)", "request limit")):
        return RATE_LIMIT
    if _has(text, ("cannot call api for app", "app has been deleted", "app removed", "application has been deleted",
                   "app not installed", "not authorized application", "app needs tiktok audit",
                   "google app is unverified", "app is not authorized")):
        return APP_BLOCKED
    if status == 401 or code_l in {"account_inactive", "token_expired", "auth_error", "unauthorized"} or _has(text, (
        "invalid token", "token expired", "expired token", "invalid_token", "token has expired",
        "session has expired", "session has been invalidated", "invalid oauth", "error validating access",
        "unauthorized", "invalid_grant", "connected account is inactive", "revoked", "(#190)",
        "invalid_access_token", "access token has expired",
    )):
        return CONNECTION
    if status == 403 or _has(text, ("permission", "(#200)", "(#10)", "not authorized", "scope", "forbidden",
                                    "access_denied", "insufficient")):
        return PERMISSION
    if _has(text, ("duplicate", "already posted", "content is a duplicate", "status is a duplicate")):
        return DUPLICATE
    if status == 422 and key == "linkedin":
        return DUPLICATE
    if _has(text, ("limited to", "too long", "character limit", "exceeds the maximum length")):
        return TOO_LONG
    if _has(text, ("media upload is not implemented", "video upload is not implemented", "not implemented yet",
                   "supports one image", "supports exactly one image", "carousels are not implemented")):
        return MEDIA_UNSUPPORTED
    if _has(text, ("needs a page or group id", "needs a board id", "profile id from", "channel id from",
                   "open_id from")):
        return DESTINATION
    if (status is not None and 500 <= status <= 599) or _has(text, (
        "service unavailable", "temporarily unavailable", "could not connect", "internal server error",
        "bad gateway", "publish_interrupted", "did not return", "without returning",
    )) or code_l == "publish_interrupted":
        return PLATFORM_DOWN
    return FALLBACK


_RETRY = [{"id": "retry", "label": "Retry now"}, {"id": "reschedule", "label": "Save & reschedule"}]
_EDIT = [{"id": "edit", "label": "Edit post"}]


def _reconnect(net: str) -> list[dict[str, str]]:
    return [{"id": "reconnect", "label": f"Reconnect {net}", "target": "accounts"}]


def friendly_error(code: str | None, message: str | None, platform: str | None,
                   media_urls: list | None = None) -> dict[str, Any] | None:
    """Specific plain-language copy for a failed post, or None when there is no error."""
    if not (code or message):
        return None
    net = network_name(platform)
    category = classify_error(code, message, platform, media_urls)
    raw = sanitize_raw(message)

    copy: dict[str, tuple[str, str, str, list]] = {
        IG_NO_MEDIA: (
            "Instagram needs at least one image or video; caption-only posts aren't allowed.",
            "This post only had a caption. Instagram doesn't publish text-only posts.",
            "Add one photo to the post (or remove Instagram), then try again.", _EDIT),
        IG_ONE_IMAGE: (
            "Instagram needs exactly one image for this post.",
            "This post had more than one media file or a file type SocialCastly can't send to Instagram yet. "
            "Right now SocialCastly publishes one photo per Instagram post.",
            "Keep a single photo (JPG or PNG) and remove the rest, then try again.", _EDIT),
        IG_RATIO: (
            "Instagram rejected this photo's shape (aspect ratio).",
            "Instagram only accepts photos between portrait 4:5 and landscape 1.91:1. This image is taller or wider than that.",
            "Crop the photo to square (1:1), portrait (4:5) or landscape (1.91:1), then try again.",
            [{"id": "crop", "label": "Crop"}, {"id": "edit", "label": "Edit post"}]),
        MEDIA_NOT_PUBLIC: (
            f"{net} couldn't reach your image â€” its link isn't public.",
            f"{net} downloads the image from a web link, but this file is only stored on this computer/private server, so {net} can't open it.",
            "Use an image from the Media library on the live site (or any public image link), then try again.", _EDIT),
        MEDIA_FETCH: (
            f"{net} couldn't download your media file.",
            f"{net} tried to fetch the image or video from its link and the download failed.",
            "Check the file still opens, re-upload it, then try again.", _EDIT + _RETRY[:1]),
        TIMEOUT: (
            f"{net} took too long to fetch your media and gave up.",
            f"{net} timed out while downloading or processing the attached file. This usually happens with large files or a slow/unreachable link.",
            "Try again. If it keeps failing, use a smaller file (or a photo instead of a video) and make sure the link is public.",
            _RETRY),
        YOUTUBE_VIDEO: (
            "YouTube needs a video â€” this post has no video.",
            "YouTube only publishes videos. Text-only and photo posts can't be uploaded.",
            "Add one video file to this post, or remove YouTube from it.", _EDIT),
        TIKTOK_VIDEO: (
            "TikTok needs exactly one video.",
            "TikTok posts from SocialCastly must contain one video. Text-only, photo, or multi-video posts aren't accepted.",
            "Keep exactly one video in this post (remove other files), then try again.", _EDIT),
        X_CREDITS: (
            "X's posting limit for this connected account is used up.",
            "X refused the post because the posting allowance (credits) for this account's connection to X has run out. Your post itself is fine.",
            "Wait until X's allowance resets, or upgrade/top up the X plan used for this connection, then retry. You can also reschedule for later.",
            _RETRY),
        CONNECTION: (
            f"Your {net} connection has expired or was revoked.",
            f"{net} no longer accepts SocialCastly's sign-in for this account (it expired, the password changed, or access was removed).",
            f"Reconnect your {net} account in Accounts, then retry the post.", _reconnect(net) + _RETRY[:1]),
        PERMISSION: (
            f"SocialCastly doesn't have permission to post to this {net} account.",
            f"{net} said the connection is missing a required permission (for Facebook/Instagram, usually Page publishing permission).",
            f"Reconnect {net} and, when asked, allow all requested permissions and select this Page/account, then retry.",
            _reconnect(net) + _RETRY[:1]),
        APP_BLOCKED: (
            f"{net} blocked SocialCastly for this account.",
            f"{net} says SocialCastly isn't authorized for this Page/account (it may have been removed in the account's business settings).",
            f"Reconnect {net} and grant SocialCastly access to this Page/account, then retry. If it persists, contact us.",
            _reconnect(net) + [{"id": "contact", "label": "Contact us"}]),
        DUPLICATE: (
            f"{net} rejected this as a duplicate post.",
            f"{net} blocks posting the same text twice in a row from one account.",
            "Change the caption a little (or wait before reposting), then try again.", _EDIT),
        RATE_LIMIT: (
            f"{net} is limiting how often this account can post right now.",
            f"Too many posts or requests were sent to {net} in a short time, so it asked us to slow down.",
            "Wait a while (usually 15â€“60 minutes) and retry, or reschedule for later.", _RETRY),
        PLATFORM_DOWN: (
            f"{net} had a problem on its side and didn't publish the post.",
            f"{net} returned a server error or didn't confirm the post. This isn't something you did.",
            "Retry in a few minutes. Check your profile first so you don't post twice.", _RETRY),
        TOO_LONG: (
            f"The caption is too long for {net}.",
            f"{net} limits how many characters a post can have, and this caption is over it.",
            "Shorten the caption, then try again.", _EDIT),
        MEDIA_UNSUPPORTED: (
            f"SocialCastly can't send this kind of media to {net} yet.",
            f"Posting this media type or number of files to {net} isn't supported yet.",
            f"Post text only, or use a single image, for {net}.", _EDIT),
        DESTINATION: (
            f"{net} needs a Page/channel picked for this account.",
            f"The connected {net} account has no Page, board, or channel to post to.",
            f"Reconnect {net} and select the Page/channel you want to post to.", _reconnect(net)),
    }
    if category in copy:
        banner, what_happened, what_to_do, actions = copy[category]
    else:
        banner = f"{net} rejected this post: {raw}" if raw else f"We couldn't post this to {net}."
        if len(banner) > 140:
            banner = f"{net} rejected this post. See details for the reason."
        what_happened = f'The platform said: "{raw}"' if raw else f"{net} didn't give a reason."
        what_to_do = "Fix what the message mentions and retry. If it doesn't make sense, contact us and include this message."
        actions = _RETRY[:1] + [{"id": "contact", "label": "Contact us"}]
    return {
        "category": category,
        "network": net,
        "banner": banner,
        "what_happened": what_happened,
        "what_to_do": what_to_do,
        "actions": [dict(a) for a in actions],
    }

_VIDEO_EXT = re.compile(r"\.(mp4|mov|webm|m4v|ogv|avi|mkv)(\?|#|$)", re.IGNORECASE)
CHAR_LIMITS = {"x": 280, "twitter": 280, "threads": 500, "tiktok": 2200, "instagram": 2200, "linkedin": 3000,
               "pinterest": 500, "youtube": 5000}


def is_video_url(url: str) -> bool:
    return bool(_VIDEO_EXT.search(str(url or "")))


def media_requirement_error(platform: str | None, media_urls: list | None, content: str | None = None) -> str | None:
    """Plain-language reason a post can't be published to ``platform``, or None if it looks fine."""
    key = (platform or "").lower()
    media = [str(m) for m in (media_urls or [])]
    videos = [m for m in media if is_video_url(m)]
    text = content or ""
    if key == "instagram":
        if not media:
            return "Instagram needs at least one image or video; caption-only posts aren't allowed. Add one photo."
        if len(media) != 1 or videos:
            return "Instagram posts from SocialCastly need exactly one photo (JPG or PNG). Remove the extra files or the video."
    if key == "youtube" and (len(media) != 1 or len(videos) != 1):
        return "YouTube needs exactly one video. Add a video (photos and text-only posts can't go to YouTube)."
    if key == "tiktok" and (len(media) != 1 or len(videos) != 1):
        return "TikTok needs exactly one video. Keep a single video and remove other files."
    limit = CHAR_LIMITS.get(key)
    if limit and len(text) > limit:
        return f"The caption is {len(text):,} characters; {network_name(key)} allows up to {limit:,}. Shorten it."
    return None
