"""Friendly failure copy stays specific and free of provider jargon."""

import re

import pytest

from app.services.error_messages import (
    BANNED_WORDS,
    classify_error,
    friendly_error,
    media_requirement_error,
    sanitize_raw,
)

HTTP_ERROR = "provider_http_error"
NOT_CONFIGURED = "provider_not_configured"
CASES = [
    # (code, message, platform, media_urls, expected)
    (
        HTTP_ERROR,
        "Provider returned HTTP 402: Payment Required | credits depleted | type=credits-depleted",
        "x",
        [],
        "x_credits_depleted",
    ),
    (
        HTTP_ERROR,
        "Provider returned HTTP 400: (#200) Cannot call API for app 12345 on behalf of user",
        "facebook",
        None,
        "app_not_authorized",
    ),
    (
        HTTP_ERROR,
        "Provider returned HTTP 400: (#200) The user hasn't authorized the application to perform this action",
        "facebook",
        None,
        "permission_missing",
    ),
    (
        HTTP_ERROR,
        "Provider returned HTTP 403: Forbidden",
        "linkedin",
        None,
        "linkedin_permission_missing",
    ),
    (
        HTTP_ERROR,
        "Provider returned HTTP 429: Too Many Requests",
        "x",
        None,
        "rate_limited",
    ),
    (
        HTTP_ERROR,
        "Provider returned HTTP 503: Service Unavailable",
        "linkedin",
        None,
        "platform_unavailable",
    ),
    (
        HTTP_ERROR,
        "Provider returned HTTP 400: Timeout",
        "instagram",
        ["https://x.test/a.mp4"],
        "timeout",
    ),
    ("provider_request_error", "TikTok request timed out", "tiktok", None, "timeout"),
    (
        HTTP_ERROR,
        "Provider returned HTTP 401: Unauthorized",
        "x",
        None,
        "connection_expired",
    ),
    (
        HTTP_ERROR,
        "Provider returned HTTP 400: Error validating access token: Session has expired",
        "facebook",
        None,
        "connection_expired",
    ),
    (HTTP_ERROR, "Provider returned HTTP 401", "linkedin", None, "connection_expired"),
    (
        "account_inactive",
        "Connected account is inactive",
        "threads",
        None,
        "connection_expired",
    ),
    (
        HTTP_ERROR,
        "Provider returned HTTP 422: Content is a duplicate of urn:li:share:1",
        "linkedin",
        None,
        "duplicate_content",
    ),
    (
        NOT_CONFIGURED,
        "Threads text posts are limited to 500 characters.",
        "threads",
        None,
        "text_too_long",
    ),
    (
        NOT_CONFIGURED,
        "Threads media container failed (ERROR). Check the media URL.",
        "threads",
        None,
        "media_fetch_failed",
    ),
    (
        NOT_CONFIGURED,
        "YouTube publishing requires a video, not an image.",
        "youtube",
        None,
        "youtube_video_required",
    ),
    (
        NOT_CONFIGURED,
        "YouTube publishing requires exactly one video file or public video URL. Text-only posts are not supported.",
        "youtube",
        [],
        "youtube_video_required",
    ),
    (
        NOT_CONFIGURED,
        "TikTok publishing currently supports exactly one video per post.",
        "tiktok",
        None,
        "tiktok_one_video",
    ),
    (
        HTTP_ERROR,
        "Provider returned HTTP 400: The aspect ratio is not supported.",
        "instagram",
        ["https://x.test/a.png"],
        "instagram_aspect_ratio",
    ),
    (
        NOT_CONFIGURED,
        "Instagram publishing currently requires exactly one public image URL",
        "instagram",
        [],
        "instagram_no_media",
    ),
    (
        NOT_CONFIGURED,
        "Instagram publishing currently requires exactly one public image URL",
        "instagram",
        ["a", "b"],
        "instagram_one_image",
    ),
    (
        NOT_CONFIGURED,
        "Instagram requires a publicly fetchable image URL. Set PUBLIC_BASE_URL to a public https origin.",
        "instagram",
        ["x"],
        "media_not_public",
    ),
    (
        NOT_CONFIGURED,
        "X media upload is not implemented; schedule text-only posts",
        "x",
        None,
        "media_not_supported",
    ),
    ("publish_error", 'Something odd {"error": 42}', "pinterest", None, "unknown"),
]


@pytest.mark.parametrize("code,message,platform,media,expected", CASES)
def test_classification(code, message, platform, media, expected):
    assert classify_error(code, message, platform, media) == expected
    result = friendly_error(code, message, platform, media)
    assert result["category"] == expected
    assert set(result) >= {
        "category",
        "banner",
        "what_happened",
        "what_to_do",
        "actions",
    }
    assert result["banner"] and result["what_to_do"]


@pytest.mark.parametrize(
    "code,message,platform,media,expected", [c for c in CASES if c[4] != "unknown"]
)
def test_specific_copy_has_no_jargon_or_raw_text(
    code, message, platform, media, expected
):
    result = friendly_error(code, message, platform, media)
    for text in [result["banner"], result["what_happened"], result["what_to_do"]] + [
        a["label"] for a in result["actions"]
    ]:
        low = text.lower()
        # The X credits copy names the "X API" on purpose: the fix happens in the X developer console.
        for word in BANNED_WORDS:
            if expected == "x_credits_depleted" and word == "api":
                continue
            assert not re.search(rf"\b{re.escape(word)}\b", low), (word, text)
        assert "{" not in text and "provider" not in low
        assert message.lower() not in low


def test_instagram_caption_only_copy():
    result = friendly_error(
        NOT_CONFIGURED,
        "Instagram publishing currently requires exactly one public image URL",
        "instagram",
        [],
    )
    assert (
        result["banner"]
        == "Instagram needs at least one image or video; caption-only posts aren't allowed."
    )
    assert [a["id"] for a in result["actions"]] == ["edit"]


def test_instagram_ratio_mentions_range():
    result = friendly_error(
        HTTP_ERROR,
        "Provider returned HTTP 400: The aspect ratio is not supported.",
        "instagram",
    )
    assert "4:5" in result["what_happened"] and "1.91:1" in result["what_happened"]
    assert result["actions"][0]["label"] == "Crop"


def test_timeout_copy():
    result = friendly_error(
        HTTP_ERROR, "Provider returned HTTP 400: Timeout", "instagram"
    )
    assert (
        result["banner"] == "Instagram took too long to fetch your media and gave up."
    )
    assert "smaller file" in result["what_to_do"]


def test_x_credits_copy_is_specific():
    result = friendly_error(
        HTTP_ERROR, "Provider returned HTTP 402: credits depleted", "x"
    )
    assert (
        result["banner"]
        == "X API has no credits: add credits in the X developer console to post."
    )
    assert "credits" in result["what_happened"]
    assert [a["id"] for a in result["actions"]] == ["retry", "reschedule"]
    assert all("href" not in a for a in result["actions"])


def test_connection_copy_has_reconnect():
    result = friendly_error(HTTP_ERROR, "Provider returned HTTP 401", "facebook")
    assert result["banner"] == "Your Facebook connection has expired or was revoked."
    assert result["actions"][0] == {
        "id": "reconnect",
        "label": "Reconnect Facebook",
        "target": "accounts",
    }


def test_permission_copy_has_reconnect():
    result = friendly_error(
        HTTP_ERROR,
        "Provider returned HTTP 400: (#200) Requires pages_manage_posts permission",
        "facebook",
    )
    assert result["category"] == "permission_missing"
    assert result["actions"][0]["id"] == "reconnect"


def test_fallback_quotes_sanitized_raw_message():
    long_tail = "z" * 400
    msg = (
        "Provider returned HTTP 400: Weird thing happened https://graph.facebook.com/v1/me?access_token=SECRETVALUE "
        "Bearer abc.def access_token=SECRET2 " + long_tail
    )
    result = friendly_error("publish_error", msg, "pinterest")
    assert result["category"] == "unknown"
    assert result["what_happened"].startswith(
        'The platform said: "Weird thing happened'
    )
    for bad in (
        "SECRET",
        "access_token=",
        "https://",
        "Bearer abc",
        "Provider returned",
    ):
        assert bad not in result["what_happened"] and bad not in result["banner"]
    assert len(sanitize_raw(msg)) <= 200


def test_fallback_short_banner_and_none():
    result = friendly_error("weird", "boom", "pinterest")
    assert result["banner"] == "Pinterest rejected this post: boom"
    assert result["what_happened"] == 'The platform said: "boom"'
    assert friendly_error(None, None, "x") is None


@pytest.mark.parametrize(
    "platform,media,content,ok",
    [
        ("instagram", [], "hi", False),
        ("instagram", ["https://a.test/1.png", "https://a.test/2.png"], "hi", True),
        ("instagram", ["https://a.test/1.mp4"], "hi", True),
        ("instagram", ["https://a.test/1.png"], "hi", True),
        ("youtube", [], "hi", False),
        ("youtube", ["https://a.test/1.png"], "hi", False),
        ("youtube", ["https://a.test/1.mp4"], "hi", True),
        ("tiktok", ["https://a.test/1.mp4", "https://a.test/2.mp4"], "hi", False),
        ("tiktok", ["https://a.test/1.mp4"], "hi", True),
        ("x", [], "a" * 281, False),
        ("x", [], "a" * 280, True),
        ("facebook", [], "hi", True),
    ],
)
def test_media_requirement_error(platform, media, content, ok):
    assert (media_requirement_error(platform, media, content) is None) is ok
