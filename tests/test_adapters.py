"""Provider adapters with httpx mocked."""

import httpx
import pytest

from app.core.exceptions import ProviderConfigurationError
from app.integrations.platforms.instagram import InstagramPlatform
from app.integrations.platforms.linkedin import LinkedInPlatform
from app.integrations.platforms.x import XPlatform


class _Response:
    def __init__(self, payload, status_code=201, headers=None):
        self._payload = payload
        self.status_code = status_code
        self.headers = headers or {}
        self.is_error = False

    def json(self):
        return self._payload


def test_x_adapter_publishes_text(monkeypatch):
    seen = {}

    def fake_request(method, url, **kwargs):
        seen["method"] = method
        seen["url"] = url
        seen["json"] = kwargs.get("json")
        seen["headers"] = kwargs.get("headers")
        return _Response({"data": {"id": "999"}}, headers={"x-transaction-id": "tx-9"})

    monkeypatch.setattr(httpx, "request", fake_request)
    result = XPlatform().publish("token", "acct", "Hello", [])
    assert result.post_id == "999"
    assert result.request_id == "tx-9"
    assert seen["url"] == "https://api.x.com/2/tweets"
    assert seen["json"] == {"text": "Hello"}
    assert seen["headers"]["Authorization"] == "Bearer token"
    with pytest.raises(ProviderConfigurationError):
        XPlatform().publish("token", "acct", "Hello", ["https://cdn.example.com/a.jpg"])


def test_linkedin_adapter_publishes_text(monkeypatch):
    seen = {}

    def fake_request(method, url, **kwargs):
        seen["url"] = url
        seen["headers"] = kwargs.get("headers")
        seen["json"] = kwargs.get("json")
        return _Response({}, status_code=201, headers={"x-restli-id": "urn:li:share:1", "x-li-uuid": "uuid-1"})

    monkeypatch.setattr(httpx, "request", fake_request)
    monkeypatch.setenv("LINKEDIN_VERSION", "202610")
    result = LinkedInPlatform().publish("token", "urn:li:person:1", "Update", [])
    assert result.post_id == "urn:li:share:1"
    assert result.request_id == "uuid-1"
    assert seen["url"] == "https://api.linkedin.com/rest/posts"
    assert seen["headers"]["Linkedin-Version"] == "202610"
    assert seen["json"]["author"] == "urn:li:person:1"
    assert seen["json"]["commentary"] == "Update"


def test_instagram_adapter_publishes_one_public_image(monkeypatch):
    calls = []

    def fake_request(method, url, **kwargs):
        calls.append((url, kwargs.get("json")))
        if url.endswith("/media"):
            return _Response({"id": "container-1"})
        return _Response({"id": "ig-post-1"})

    monkeypatch.setattr(httpx, "request", fake_request)
    monkeypatch.setenv("INSTAGRAM_GRAPH_API_VERSION", "v24.0")
    monkeypatch.setenv("PUBLIC_BASE_URL", "http://localhost:8000")
    result = InstagramPlatform().publish("token", "1789", "Caption", ["https://cdn.example.com/photo.jpg"])
    assert result.post_id == "ig-post-1"
    assert calls[0][0] == "https://graph.instagram.com/v24.0/1789/media"
    assert calls[0][1]["image_url"] == "https://cdn.example.com/photo.jpg"
    assert calls[1][0].endswith("/media_publish")
    assert calls[1][1] == {"creation_id": "container-1"}

    calls.clear()
    with pytest.raises(ProviderConfigurationError):
        InstagramPlatform().publish("token", "1789", "Caption", ["http://localhost:8000/static/uploads/a.jpg"])
    assert calls == []

    monkeypatch.setenv("PUBLIC_BASE_URL", "https://studio.example.com")
    InstagramPlatform().publish("token", "1789", "Caption", ["/static/uploads/a.jpg"])
    assert calls[0][1]["image_url"] == "https://studio.example.com/static/uploads/a.jpg"
