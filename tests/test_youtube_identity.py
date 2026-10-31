"""YouTube identity uses the channels API and surfaces provider errors."""

import logging

import httpx
import pytest
from fastapi import HTTPException

from app.services import oauth


def _resp(status: int, payload=None, text: str | None = None):
    req = httpx.Request("GET", "https://www.googleapis.com/youtube/v3/channels")
    if text is not None:
        return httpx.Response(status, text=text, request=req)
    return httpx.Response(status, json=payload, request=req)


def test_youtube_identity_uses_channel(monkeypatch):
    calls = {}

    def fake_get(url, params=None, headers=None, timeout=None):
        calls["url"], calls["params"] = url, params
        return _resp(200, {"items": [{"id": "UC123", "snippet": {
            "title": "My Channel", "customUrl": "@mychannel",
            "thumbnails": {"default": {"url": "https://img/d.jpg"}, "high": {"url": "https://img/h.jpg"}}}}]})

    monkeypatch.setattr(oauth.httpx, "get", fake_get)
    identity = oauth._youtube_identity("tok")
    assert calls["url"] == "https://www.googleapis.com/youtube/v3/channels"
    assert calls["params"] == {"part": "snippet", "mine": "true"}
    assert identity["id"] == "UC123"
    assert identity["name"] == "My Channel"
    assert identity["username"] == "@mychannel"
    assert identity["avatar_url"] == "https://img/h.jpg"


def test_youtube_identity_no_channel(monkeypatch):
    monkeypatch.setattr(oauth.httpx, "get", lambda *a, **k: _resp(200, {"items": []}))
    with pytest.raises(HTTPException) as exc:
        oauth._youtube_identity("tok")
    assert "has no YouTube channel" in exc.value.detail


def test_authorized_get_logs_provider_error(monkeypatch, caplog):
    monkeypatch.setattr(oauth.httpx, "get", lambda *a, **k: _resp(401, text="unauthorized " + "x" * 1000))
    with caplog.at_level(logging.WARNING, logger=oauth.__name__):
        with pytest.raises(HTTPException) as exc:
            oauth._authorized_get("https://www.googleapis.com/youtube/v3/channels", "secret-token")
    assert exc.value.status_code == 502
    text = caplog.text
    assert "401" in text and "unauthorized" in text
    assert "secret-token" not in text
    assert "x" * 400 not in text
