"""OAuth token exchanges must not put secrets in URLs, and httpx must not log URLs."""

import logging

import httpx
import pytest

from app.core.logging import configure_logging
from app.services import oauth

SECRET = "super-secret-value"


def test_httpx_loggers_are_warning_after_configure():
    configure_logging()
    assert logging.getLogger("httpx").level == logging.WARNING
    assert logging.getLogger("httpcore").level == logging.WARNING


def _capture(monkeypatch):
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json={"access_token": "long-lived", "expires_in": 100})

    client = httpx.Client(transport=httpx.MockTransport(handler))

    def get(url, **kw):
        kw.pop("timeout", None)
        return client.get(url, **kw)

    def post(url, **kw):
        kw.pop("timeout", None)
        return client.post(url, **kw)

    monkeypatch.setattr(httpx, "get", get)
    monkeypatch.setattr(httpx, "post", post)
    return seen


def _provider(platform):
    return oauth._ProviderOAuth(
        platform=platform,
        authorize_url="https://x/auth",
        token_url="https://graph.facebook.com/v24.0/oauth/access_token",
        client_id="123",
        client_secret=SECRET,
        redirect_uri="https://x/cb",
        scopes=(),
        use_pkce=False,
        missing_env=(),
    )


@pytest.mark.parametrize("fn,platform", [(oauth._instagram_token, "instagram"), (oauth._facebook_long_lived, "facebook")])
def test_meta_long_lived_exchange_uses_post_body(monkeypatch, fn, platform):
    seen = _capture(monkeypatch)
    out = fn(_provider(platform), {"access_token": "short-user-token"})
    assert out["access_token"] == "long-lived"
    assert len(seen) == 1
    req = seen[0]
    assert req.method == "POST"
    assert SECRET not in str(req.url) and "short-user-token" not in str(req.url)
    assert SECRET.encode() in req.content and b"fb_exchange_token" in req.content


@pytest.mark.parametrize("platform", ["facebook", "instagram"])
def test_code_exchange_has_no_secret_in_url(monkeypatch, platform):
    seen = _capture(monkeypatch)
    oauth._exchange_code(_provider(platform), "the-code", None)
    assert seen and all(SECRET not in str(r.url) for r in seen)
