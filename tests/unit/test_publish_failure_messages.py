"""Nov 4 publish failures: offline network, platform reasons, pre-publish media rules."""

import pytest

from app.services.error_messages import BANNED_WORDS, classify_error, friendly_error, media_requirement_error


@pytest.mark.parametrize("platform,message", [
    ("facebook", "Could not connect to the social platform"),
    ("instagram", "Could not connect to the social platform"),
    ("threads", "Could not connect to the social platform"),
    ("youtube", "Could not connect to YouTube"),
    ("tiktok", "Could not connect to TikTok"),
])
def test_connection_failures_say_no_internet_not_platform_down(platform, message):
    fe = friendly_error("provider_request_error", message, platform)
    assert fe["category"] == "network_unreachable"
    assert "internet" in fe["banner"].lower()
    assert "problem on its side" not in fe["banner"]
    assert fe["actions"][0]["id"] == "retry"
    assert not any(w in (fe["banner"] + fe["what_happened"] + fe["what_to_do"]).lower() for w in BANNED_WORDS)


def test_platform_5xx_quotes_sanitised_reason():
    msg = ("Provider returned HTTP 500: An unexpected error has occurred. access_token=EAAsecretvalue123 "
           "see https://graph.facebook.com/x?access_token=abc")
    fe = friendly_error("provider_http_error", msg, "facebook")
    assert fe["category"] == "platform_unavailable"
    assert 'Facebook said: "An unexpected error has occurred.' in fe["what_happened"]
    assert "EAAsecret" not in fe["what_happened"] and "graph.facebook.com" not in fe["what_happened"]


def test_expired_token_and_permission_keep_specific_copy_with_reason():
    fe = friendly_error("provider_http_error", "Provider returned HTTP 401: Error validating access token: Session has expired", "instagram")
    assert fe["category"] == "connection_expired" and "Session has expired" in fe["platform_reason"]
    fe = friendly_error("provider_http_error", "Provider returned HTTP 403: (#200) Requires pages_manage_posts permission", "facebook")
    assert fe["category"] == "permission_missing" and "pages_manage_posts" in fe["platform_reason"]


def test_non_http_errors_do_not_quote_raw():
    fe = friendly_error("provider_request_error", "Could not connect to TikTok", "tiktok")
    assert "said:" not in fe["what_happened"] and fe["platform_reason"] is None


@pytest.mark.parametrize("platform,media,blocked", [
    ("youtube", ["https://a.test/p.jpg"], True),
    ("tiktok", ["https://a.test/p.jpg"], True),
    ("youtube", ["https://a.test/v.mp4"], False),
    ("tiktok", ["https://a.test/v.mp4"], False),
    ("linkedin", ["https://a.test/p.jpg"], True),
    ("x", ["https://a.test/v.mp4"], True),
    ("linkedin", [], False),
    ("x", [], False),
])
def test_prepublish_media_rules(platform, media, blocked):
    assert (media_requirement_error(platform, media, "hello") is not None) is blocked


def test_linkedin_media_message_classifies_as_unsupported():
    msg = media_requirement_error("linkedin", ["https://a.test/p.jpg"], "hi")
    assert classify_error("provider_not_configured", msg, "linkedin") == "media_not_supported"
    fe = friendly_error("provider_not_configured", "LinkedIn media upload is not implemented; schedule text-only posts", "linkedin")
    assert "single image" not in fe["what_to_do"]
