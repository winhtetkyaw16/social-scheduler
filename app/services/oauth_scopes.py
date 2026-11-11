"""OAuth scopes requested at connect. One list per network.

These strings were confirmed from the developer consoles. Keep a scope here
when it is already requested, and add new ones in this file only.
TikTok ``video.list`` stays out of the live request until the console enables
it and ``TIKTOK_ENABLE_VIDEO_LIST`` is true. Requesting it earlier breaks connect.
"""

from __future__ import annotations

import os

FACEBOOK_SCOPES: tuple[str, ...] = (
    "pages_show_list",
    "pages_read_engagement",
    "pages_read_user_content",
    "pages_manage_engagement",
    "read_insights",
    "pages_manage_posts",
    "business_management",
)

# Instagram API with Facebook Login. Not the instagram_business_* Instagram Login names.
INSTAGRAM_SCOPES: tuple[str, ...] = (
    "instagram_basic",
    "instagram_content_publish",
    "instagram_manage_comments",
    "instagram_manage_insights",
    "instagram_manage_messages",
    "pages_show_list",
    "pages_read_engagement",
    "business_management",
)

THREADS_SCOPES: tuple[str, ...] = (
    "threads_basic",
    "threads_content_publish",
    "threads_read_replies",
    "threads_manage_replies",
    "threads_manage_insights",
)

X_SCOPES: tuple[str, ...] = (
    "tweet.read",
    "tweet.write",
    "users.read",
    "media.write",
    "offline.access",
    "tweet.moderate.write",
)

YOUTUBE_FORCE_SSL = "https://www.googleapis.com/auth/youtube.force-ssl"
YOUTUBE_UPLOAD = "https://www.googleapis.com/auth/youtube.upload"
YOUTUBE_READONLY = "https://www.googleapis.com/auth/youtube.readonly"
YOUTUBE_ANALYTICS = "https://www.googleapis.com/auth/yt-analytics.readonly"

YOUTUBE_SCOPES: tuple[str, ...] = (
    YOUTUBE_FORCE_SSL,
    YOUTUBE_ANALYTICS,
    YOUTUBE_UPLOAD,
    YOUTUBE_READONLY,
)

LINKEDIN_SCOPES: tuple[str, ...] = ("openid", "profile", "email", "w_member_social")

TIKTOK_SCOPES: tuple[str, ...] = (
    "user.info.basic",
    "user.info.profile",
    "video.publish",
    "video.upload",
)
TIKTOK_VIDEO_LIST_SCOPE = "video.list"

PINTEREST_SCOPES: tuple[str, ...] = (
    "boards:read",
    "boards:write",
    "pins:read",
    "pins:write",
    "user_accounts:read",
)


def tiktok_video_list_enabled() -> bool:
    """True only when the console has video.list and the operator turns the flag on."""
    raw = os.getenv("TIKTOK_ENABLE_VIDEO_LIST", "false").strip().lower()
    return raw in {"1", "true", "yes"}


def tiktok_scopes() -> tuple[str, ...]:
    """Live TikTok scopes. ``video.list`` is added only behind the env flag."""
    if tiktok_video_list_enabled():
        return TIKTOK_SCOPES + (TIKTOK_VIDEO_LIST_SCOPE,)
    return TIKTOK_SCOPES
