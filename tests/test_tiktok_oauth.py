"""TikTok Login Kit must use hex SHA-256 PKCE, not the RFC 7636 base64url challenge."""

import base64
import re
from hashlib import sha256
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.core import config
from app.core.security import decrypt_token
from app.services import oauth

_HEX_CHALLENGE = re.compile(r"^[0-9a-f]{64}$")
_UNRESERVED = re.compile(r"^[A-Za-z0-9\-._~]{43,128}$")


def _enable_tiktok(monkeypatch, *, redirect_uri: str = "https://app.example/api/v1/accounts/tiktok/callback") -> None:
    monkeypatch.setenv("TIKTOK_CLIENT_KEY", "tt-client-key")
    monkeypatch.setenv("TIKTOK_CLIENT_SECRET", "tt-client-secret")
    monkeypatch.setenv("TIKTOK_REDIRECT_URI", redirect_uri)


def _query(url: str) -> dict[str, list[str]]:
    return parse_qs(urlparse(url).query, keep_blank_values=True)


def test_tiktok_pkce_pair_is_hex_sha256_not_base64url():
    verifier, challenge = oauth._tiktok_pkce_pair()
    assert _UNRESERVED.fullmatch(verifier)
    assert len(verifier) == 64
    digest = sha256(verifier.encode("ascii")).digest()
    assert challenge == digest.hex()
    assert challenge != base64.urlsafe_b64encode(digest).decode().rstrip("=")
    other_verifier, other_challenge = oauth._tiktok_pkce_pair()
    assert other_verifier != verifier
    assert other_challenge != challenge


def test_tiktok_connect_url_includes_hex_pkce(client, auth_headers, monkeypatch):
    redirect_uri = "https://app.example/api/v1/accounts/tiktok/callback"
    _enable_tiktok(monkeypatch, redirect_uri=redirect_uri)
    headers, _tokens = auth_headers
    started = client.get("/api/v1/accounts/tiktok/connect", headers=headers)
    assert started.status_code == 200, started.text
    url = started.json()["authorization_url"]
    parsed = urlparse(url)
    assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == "https://www.tiktok.com/v2/auth/authorize/"
    query = _query(url)
    assert query["client_key"] == ["tt-client-key"]
    assert "client_id" not in query
    assert query["response_type"] == ["code"]
    assert query["redirect_uri"] == [redirect_uri]
    assert query["scope"] == ["user.info.basic,user.info.profile,video.publish,video.upload"]
    assert "user.info.profile" in query["scope"][0].split(",")
    assert query["code_challenge_method"] == ["S256"]
    challenge = query["code_challenge"][0]
    assert _HEX_CHALLENGE.fullmatch(challenge)
    _user_id, verifier, _return_to = oauth._read_state(query["state"][0], "tiktok")
    assert verifier is not None
    assert _UNRESERVED.fullmatch(verifier)
    assert sha256(verifier.encode("ascii")).hexdigest() == challenge
    assert decrypt_token(query["state"][0])


def test_tiktok_token_exchange_posts_stored_verifier(monkeypatch):
    redirect_uri = "http://localhost:8000/api/v1/accounts/tiktok/callback"
    _enable_tiktok(monkeypatch, redirect_uri=redirect_uri)
    started = oauth.start_oauth("tiktok", uuid4())
    query = _query(started["authorization_url"])
    _user_id, verifier, _return_to = oauth._read_state(query["state"][0], "tiktok")
    captured: dict = {}

    def fake_post(url, data=None, auth=None, headers=None, timeout=None):
        captured["url"] = url
        captured["data"] = dict(data)
        captured["auth"] = auth
        captured["headers"] = headers

        class _Response:
            is_error = False

            def json(self):
                return {
                    "access_token": "access-token",
                    "refresh_token": "refresh-token",
                    "expires_in": 86400,
                    "open_id": "open-1",
                    "scope": "user.info.basic,video.upload,video.publish",
                    "token_type": "Bearer",
                }

        return _Response()

    monkeypatch.setattr(oauth.httpx, "post", fake_post)
    payload = oauth._exchange_code(oauth._providers()["tiktok"], "auth-code", verifier)
    assert captured["url"] == "https://open.tiktokapis.com/v2/oauth/token/"
    assert captured["data"] == {
        "grant_type": "authorization_code",
        "code": "auth-code",
        "redirect_uri": redirect_uri,
        "client_key": "tt-client-key",
        "client_secret": "tt-client-secret",
        "code_verifier": verifier,
    }
    assert captured["auth"] is None
    assert payload["access_token"] == "access-token"
    assert payload["refresh_token"] == "refresh-token"
    assert payload["scopes"] == ["user.info.basic", "video.upload", "video.publish"]


def test_tiktok_token_exchange_rejects_missing_verifier(monkeypatch):
    _enable_tiktok(monkeypatch)

    def fail_post(*_args, **_kwargs):
        raise AssertionError("token endpoint must not be called without a code_verifier")

    monkeypatch.setattr(oauth.httpx, "post", fail_post)
    with pytest.raises(HTTPException) as exc:
        oauth._exchange_code(oauth._providers()["tiktok"], "auth-code", None)
    assert exc.value.status_code == 400


def test_tiktok_callback_uses_verifier_stored_in_state(client, auth_headers, monkeypatch):
    _enable_tiktok(monkeypatch, redirect_uri=config.TIKTOK_REDIRECT_URI)
    headers, _tokens = auth_headers
    started = client.get("/api/v1/accounts/tiktok/connect", headers=headers)
    assert started.status_code == 200, started.text
    query = _query(started.json()["authorization_url"])
    _user_id, verifier, _return_to = oauth._read_state(query["state"][0], "tiktok")
    captured: dict = {}

    def fake_post(url, data=None, auth=None, headers=None, timeout=None):
        captured["data"] = dict(data)
        captured["url"] = url

        class _Response:
            is_error = False

            def json(self):
                return {
                    "access_token": "access-token",
                    "refresh_token": "refresh-token",
                    "expires_in": 86400,
                    "scope": "user.info.basic,video.publish,video.upload",
                    "token_type": "Bearer",
                }

        return _Response()

    def fake_get(url, params=None, headers=None, timeout=None):
        assert url == "https://open.tiktokapis.com/v2/user/info/"
        assert headers["Authorization"] == "Bearer access-token"

        class _Response:
            is_error = False

            def json(self):
                return {
                    "data": {
                        "user": {
                            "open_id": "open-1",
                            "display_name": "Creator",
                            "username": "creator",
                        }
                    }
                }

        return _Response()

    monkeypatch.setattr(oauth.httpx, "post", fake_post)
    monkeypatch.setattr(oauth.httpx, "get", fake_get)
    callback = client.get(
        "/api/v1/accounts/tiktok/callback",
        params={"code": "auth-code", "state": query["state"][0]},
        follow_redirects=False,
    )
    assert callback.status_code == 302, callback.text
    assert "connected=tiktok" in callback.headers["location"]
    assert captured["url"] == "https://open.tiktokapis.com/v2/oauth/token/"
    assert captured["data"]["code_verifier"] == verifier
    assert captured["data"]["client_key"] == "tt-client-key"
    assert captured["data"]["grant_type"] == "authorization_code"
    assert captured["data"]["redirect_uri"] == config.TIKTOK_REDIRECT_URI


def test_tiktok_connect_requires_client_credentials(client, auth_headers):
    headers, _tokens = auth_headers
    missing = client.get("/api/v1/accounts/tiktok/connect", headers=headers)
    assert missing.status_code == 503
    assert "TIKTOK_CLIENT_KEY" in missing.text
    assert "TIKTOK_CLIENT_SECRET" in missing.text


def test_x_pkce_stays_base64url(monkeypatch):
    monkeypatch.setenv("X_CLIENT_ID", "x-client")
    monkeypatch.setenv("X_CLIENT_SECRET", "x-secret")
    started = oauth.start_oauth("x", uuid4())
    query = _query(started["authorization_url"])
    challenge = query["code_challenge"][0]
    _user_id, verifier, _return_to = oauth._read_state(query["state"][0], "x")
    digest = sha256(verifier.encode()).digest()
    assert challenge == base64.urlsafe_b64encode(digest).decode().rstrip("=")
    assert query["code_challenge_method"] == ["S256"]
    assert not _HEX_CHALLENGE.fullmatch(challenge)
