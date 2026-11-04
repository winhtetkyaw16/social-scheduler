import re

import pytest

from app.services.error_messages import (
    BANNED_WORDS, classify_error, friendly_error, media_requirement_error, sanitize_raw,
)

H = "provider_http_error"
N = "provider_not_configured"
CASES = [
    # (code, message, platform, media_urls, expected)
    (H, "Provider returned HTTP 402: Payment Required | credits depleted | type=credits-depleted", "x", [], "x_credits_depleted"),
    (H, "Provider returned HTTP 400: (#200) Cannot call API for app 12345 on behalf of user", "facebook", None, "app_not_authorized"),
    (H, "Provider returned HTTP 400: (#200) The user hasn't authorized the application to perform this action", "facebook", None, "permission_missing"),
    (H, "Provider returned HTTP 403: Forbidden", "linkedin", None, "permission_missing"),
    (H, "Provider returned HTTP 429: Too Many Requests", "x", None, "rate_limited"),
    (H, "Provider returned HTTP 503: Service Unavailable", "linkedin", None, "platform_unavailable"),
    (H, "Provider returned HTTP 400: Timeout", "instagram", ["https://x.test/a.mp4"], "timeout"),
    ("provider_request_error", "TikTok request timed out", "tiktok", None, "timeout"),
    (H, "Provider returned HTTP 401: Unauthorized", "x", None, "connection_expired"),
    (H, "Provider returned HTTP 400: Error validating access token: Session has expired", "facebook", None, "connection_expired"),
    (H, "Provider returned HTTP 401", "linkedin", None, "connection_expired"),
    ("account_inactive", "Connected account is inactive", "threads", None, "connection_expired"),
    (H, "Provider returned HTTP 422: Content is a duplicate of urn:li:share:1", "linkedin", None, "duplicate_content"),
    (N, "Threads text posts are limited to 500 characters.", "threads", None, "text_too_long"),
    (N, "Threads media container failed (ERROR). Check the media URL.", "threads", None, "media_fetch_failed"),
    (N, "YouTube publishing requires a video, not an image.", "youtube", None, "youtube_video_required"),
    (N, "YouTube publishing requires exactly one video file or public video URL. Text-only posts are not supported.", "youtube", [], "youtube_video_required"),
    (N, "TikTok publishing currently supports exactly one video per post.", "tiktok", None, "tiktok_one_video"),
    (H, "Provider returned HTTP 400: The aspect ratio is not supported.", "instagram", ["https://x.test/a.png"], "instagram_aspect_ratio"),
    (N, "Instagram publishing currently requires exactly one public image URL", "instagram", [], "instagram_no_media"),
    (N, "Instagram publishing currently requires exactly one public image URL", "instagram", ["a", "b"], "instagram_one_image"),
    (N, "Instagram requires a publicly fetchable image URL. Set PUBLIC_BASE_URL to a public https origin.", "instagram", ["x"], "media_not_public"),
    (N, "X media upload is not implemented; schedule text-only posts", "x", None, "media_not_supported"),
    ("publish_error", "Something odd {\"error\": 42}", "pinterest", None, "unknown"),
]


@pytest.mark.parametrize("code,message,platform,media,expected", CASES)
def test_classification(code, message, platform, media, expected):
    assert classify_error(code, message, platform, media) == expected
    result = friendly_error(code, message, platform, media)
    assert result["category"] == expected
    assert set(result) >= {"category", "banner", "what_happened", "what_to_do", "actions"}
    assert result["banner"] and result["what_to_do"]


@pytest.mark.parametrize("code,message,platform,media,expected", [c for c in CASES if c[4] != "unknown"])
def test_specific_copy_has_no_jargon_or_raw_text(code, message, platform, media, expected):
    result = friendly_error(code, message, platform, media)
    for text in [result["banner"], result["what_happened"], result["what_to_do"]] + [a["label"] for a in result["actions"]]:
        low = text.lower()
        for word in BANNED_WORDS:
            assert not re.search(rf"\b{re.escape(word)}\b", low), (word, text)
        assert "{" not in text and "provider" not in low
        assert message.lower() not in low


def test_instagram_caption_only_copy():
    r = friendly_error(N, "Instagram publishing currently requires exactly one public image URL", "instagram", [])
    assert r["banner"] == "Instagram needs at least one image or video; caption-only posts aren't allowed."
    assert [a["id"] for a in r["actions"]] == ["edit"]


def test_instagram_ratio_mentions_range():
    r = friendly_error(H, "Provider returned HTTP 400: The aspect ratio is not supported.", "instagram")
    assert "4:5" in r["what_happened"] and "1.91:1" in r["what_happened"]
    assert r["actions"][0]["label"] == "Crop"


def test_timeout_copy():
    r = friendly_error(H, "Provider returned HTTP 400: Timeout", "instagram")
    assert r["banner"] == "Instagram took too long to fetch your media and gave up."
    assert "smaller file" in r["what_to_do"]


def test_x_credits_copy_is_specific():
    r = friendly_error(H, "Provider returned HTTP 402: credits depleted", "x")
    assert r["banner"] == "X's posting limit for this connected account is used up."
    assert "credits" in r["what_happened"]
    assert [a["id"] for a in r["actions"]] == ["retry", "reschedule"]
    assert all("href" not in a for a in r["actions"])


def test_connection_copy_has_reconnect():
    r = friendly_error(H, "Provider returned HTTP 401", "facebook")
    assert r["banner"] == "Your Facebook connection has expired or was revoked."
    assert r["actions"][0] == {"id": "reconnect", "label": "Reconnect Facebook", "target": "accounts"}


def test_permission_copy_has_reconnect():
    r = friendly_error(H, "Provider returned HTTP 400: (#200) Requires pages_manage_posts permission", "facebook")
    assert r["category"] == "permission_missing"
    assert r["actions"][0]["id"] == "reconnect"


def test_fallback_quotes_sanitized_raw_message():
    long_tail = "z" * 400
    msg = ("Provider returned HTTP 400: Weird thing happened https://graph.facebook.com/v1/me?access_token=SECRETVALUE "
           "Bearer abc.def access_token=SECRET2 " + long_tail)
    r = friendly_error("publish_error", msg, "pinterest")
    assert r["category"] == "unknown"
    assert r["what_happened"].startswith('The platform said: "Weird thing happened')
    for bad in ("SECRET", "access_token=", "https://", "Bearer abc", "Provider returned"):
        assert bad not in r["what_happened"] and bad not in r["banner"]
    assert len(sanitize_raw(msg)) <= 200


def test_fallback_short_banner_and_none():
    r = friendly_error("weird", "boom", "pinterest")
    assert r["banner"] == "Pinterest rejected this post: boom"
    assert r["what_happened"] == 'The platform said: "boom"'
    assert friendly_error(None, None, "x") is None


@pytest.mark.parametrize("platform,media,content,ok", [
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
])
def test_media_requirement_error(platform, media, content, ok):
    assert (media_requirement_error(platform, media, content) is None) is ok