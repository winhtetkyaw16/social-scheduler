"""Phase C publisher adapters with httpx mocked."""

import httpx
import pytest

from app.core.exceptions import ProviderConfigurationError
from app.integrations.platforms.facebook import FacebookPlatform
from app.integrations.platforms.pinterest import PinterestPlatform
from app.integrations.platforms.threads import ThreadsPlatform
from app.integrations.platforms.tiktok import TikTokPlatform
from app.integrations.platforms.youtube import YouTubePlatform
from app.integrations.registry import _PROVIDERS, get_platform


class _Response:
    def __init__(self, payload, status_code=200, headers=None, is_error=False):
        self._payload = payload
        self.status_code = status_code
        self.headers = headers or {}
        self.is_error = is_error
        self.content = b""

    def json(self):
        return self._payload


def test_phase_c_providers_are_registered():
    for name in ("facebook", "youtube", "tiktok", "pinterest", "threads"):
        assert name in _PROVIDERS
        assert get_platform(name).platform == name


def test_facebook_text_and_photo(monkeypatch):
    seen = {}

    def fake_request(method, url, **kwargs):
        seen["url"] = url
        seen["json"] = kwargs.get("json")
        if url.endswith("/photos"):
            return _Response({"id": "ph-1", "post_id": "page_ph_1"}, status_code=200)
        return _Response({"id": "page_123_456"}, status_code=200)

    monkeypatch.setattr(httpx, "request", fake_request)
    monkeypatch.setenv("FACEBOOK_GRAPH_API_VERSION", "v21.0")
    text = FacebookPlatform().publish("tok", "111", "Hello Page", [])
    assert text.post_id == "page_123_456"
    assert seen["url"].endswith("/111/feed")

    photo = FacebookPlatform().publish("tok", "111", "Caption", ["https://cdn.example.com/a.jpg"])
    assert photo.post_id == "page_ph_1"
    assert seen["url"].endswith("/111/photos")
    assert seen["json"]["url"] == "https://cdn.example.com/a.jpg"

    with pytest.raises(ProviderConfigurationError):
        FacebookPlatform().publish("tok", "111", "x", ["a.jpg", "b.jpg"])


def test_pinterest_requires_one_image(monkeypatch):
    def fake_request(method, url, **kwargs):
        assert url == "https://api.pinterest.com/v5/pins"
        assert kwargs["json"]["board_id"] == "board-9"
        assert kwargs["json"]["media_source"]["url"] == "https://cdn.example.com/pin.jpg"
        return _Response({"id": "pin-99"}, status_code=201)

    monkeypatch.setattr(httpx, "request", fake_request)
    result = PinterestPlatform().publish("tok", "board-9", "Nice pin", ["https://cdn.example.com/pin.jpg"])
    assert result.post_id == "pin-99"
    with pytest.raises(ProviderConfigurationError):
        PinterestPlatform().publish("tok", "board-9", "Nice pin", [])


def test_threads_text_publish(monkeypatch):
    calls = []

    def fake_request(method, url, **kwargs):
        calls.append((method, url, kwargs.get("json")))
        if url.endswith("/threads"):
            return _Response({"id": "container-1"})
        return _Response({"id": "thread-9"})

    monkeypatch.setattr(httpx, "request", fake_request)
    monkeypatch.setenv("THREADS_API_VERSION", "v1.0")
    result = ThreadsPlatform().publish("tok", "th-user", "Hello Threads", [])
    assert result.post_id == "thread-9"
    assert calls[0][2] == {"media_type": "TEXT", "text": "Hello Threads"}
    assert calls[1][2] == {"creation_id": "container-1"}
    with pytest.raises(ProviderConfigurationError):
        ThreadsPlatform().publish("tok", "th-user", "x" * 501, [])


def test_youtube_requires_video(monkeypatch):
    with pytest.raises(ProviderConfigurationError):
        YouTubePlatform().publish("tok", "channel-1", "Title only", [])
    with pytest.raises(ProviderConfigurationError):
        YouTubePlatform().publish("tok", "channel-1", "Title", ["https://cdn.example.com/pic.jpg"])


def test_tiktok_direct_pull(monkeypatch):
    posts = []

    def fake_post(url, **kwargs):
        posts.append(url)
        if url.endswith("creator_info/query/"):
            return _Response({"data": {"privacy_level_options": ["SELF_ONLY", "PUBLIC_TO_EVERYONE"]}, "error": {"code": "ok"}})
        if url.endswith("video/init/"):
            body = kwargs.get("json") or {}
            assert body["source_info"]["source"] == "PULL_FROM_URL"
            return _Response({"data": {"publish_id": "v_pub~1"}, "error": {"code": "ok"}})
        return _Response({"error": {"code": "ok"}}, is_error=True, status_code=500)

    monkeypatch.setattr(httpx, "post", fake_post)
    result = TikTokPlatform().publish("tok", "open-id", "Caption", ["https://cdn.example.com/clip.mp4"])
    assert result.post_id == "v_pub~1"
    assert any(url.endswith("video/init/") for url in posts)


def test_tiktok_requires_video():
    with pytest.raises(ProviderConfigurationError):
        TikTokPlatform().publish("tok", "open-id", "hi", [])
