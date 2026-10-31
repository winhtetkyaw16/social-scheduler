"""Instagram connect via Facebook Login for Business (config_id)."""

from urllib.parse import parse_qs, urlparse
from uuid import uuid4

import httpx

from app.core import config
from app.services import destinations, oauth

REDIRECT = "https://api.socialcastly.com/api/v1/accounts/instagram/callback"


class _R:
    def __init__(self, payload, status_code=200):
        self._p, self.status_code = payload, status_code

    @property
    def is_error(self):
        return self.status_code >= 400

    def json(self):
        return self._p


def _enable(monkeypatch):
    monkeypatch.setenv("INSTAGRAM_CLIENT_ID", "2155681295039911")
    monkeypatch.setenv("INSTAGRAM_CLIENT_SECRET", "test-secret")
    monkeypatch.setenv("INSTAGRAM_CONFIG_ID", "1446921667396494")
    monkeypatch.setattr(config, "INSTAGRAM_REDIRECT_URI", REDIRECT)
    monkeypatch.setattr(config, "INSTAGRAM_GRAPH_API_VERSION", "v24.0")


def test_instagram_authorize_url_uses_facebook_dialog_with_config_id(client, auth_headers, monkeypatch):
    _enable(monkeypatch)
    headers, _ = auth_headers
    r = client.get("/api/v1/accounts/instagram/connect", headers=headers)
    assert r.status_code == 200, r.text
    url = urlparse(r.json()["authorization_url"])
    assert f"{url.scheme}://{url.netloc}{url.path}" == "https://www.facebook.com/v24.0/dialog/oauth"
    q = parse_qs(url.query)
    assert q["client_id"] == ["2155681295039911"]
    assert q["config_id"] == ["1446921667396494"]
    assert q["response_type"] == ["code"]
    assert q["redirect_uri"] == [REDIRECT]
    assert q["state"][0]
    assert "scope" not in q


def test_instagram_discovery_from_pages(monkeypatch):
    monkeypatch.setattr(config, "INSTAGRAM_GRAPH_API_VERSION", "v24.0")
    seen = []

    def fake_get(url, **kw):
        seen.append(url)
        return _R({"data": [{"id": "p1", "name": "Page", "access_token": "page-tok",
                             "instagram_business_account": {"id": "ig1", "username": "brand", "name": "Brand",
                                                            "profile_picture_url": "https://cdn.x/a.jpg"}}]})

    monkeypatch.setattr(httpx, "get", fake_get)
    items = destinations._instagram_destinations("user-tok")
    assert seen[0] == "https://graph.facebook.com/v24.0/me/accounts"
    assert items == [{"id": "ig1", "name": "Brand (@brand)", "account_type": "business", "platform": "instagram",
                      "access_token": "page-tok", "username": "brand", "linked_facebook_page_id": "p1",
                      "avatar_url": "https://cdn.x/a.jpg"}]


def test_instagram_discovery_business_fallback(monkeypatch):
    def fake_get(url, **kw):
        if url.endswith("/me/accounts"):
            return _R({"data": []})
        return _R({"businesses": {"data": [{"id": "b1", "owned_instagram_accounts": {"data": [{"id": "ig2", "username": "biz"}]}}]}})

    monkeypatch.setattr(httpx, "get", fake_get)
    items = destinations._instagram_destinations("sys-tok")
    assert [i["id"] for i in items] == ["ig2"] and items[0]["access_token"] == "sys-tok"


def test_instagram_callback_without_ig_account_returns_connect_error(monkeypatch):
    _enable(monkeypatch)
    state = oauth._write_state(uuid4(), "instagram", None)
    posted = {}

    def fake_post(url, **kw):
        posted["url"] = url
        return _R({"access_token": "short"})

    def fake_get(url, **kw):
        if "oauth/access_token" in url:
            return _R({"error": {}}, 400)  # system-user token: exchange not needed
        if url.endswith("/me") and "businesses" not in str(kw.get("params")):
            return _R({"id": "u1", "name": "Win"})
        return _R({"data": []})

    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setattr(httpx, "get", fake_get)
    monkeypatch.setattr(oauth, "_authorized_get", lambda url, tok, **kw: {"id": "u1", "name": "Win"})
    resp = oauth.finish_oauth(None, "instagram", code="c", state=state, provider_error=None)
    assert posted["url"] == "https://graph.facebook.com/v24.0/oauth/access_token"
    assert "connect_error=No+Instagram+business+account" in resp.headers["location"]

