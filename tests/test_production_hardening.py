"""Public-host settings: CORS, trusted hosts, auth coverage, docs gate, media URLs."""

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.api.access import GATED_DEV_PATHS, PUBLIC_API, is_public_api
from app.core.config import (
    resolve_allowed_hosts,
    resolve_cors_origins,
)
from app.core.cookies import cookie_secure
from app.core.exceptions import ProviderConfigurationError
from app.integrations.media_urls import hosted_media_url, public_media_url
from app.main import app


def test_cors_origins_prefer_cors_env_and_reject_wildcard():
    assert resolve_cors_origins(
        "https://socialcastly.com, https://api.socialcastly.com",
        "http://localhost:3000",
        "production",
    ) == ["https://socialcastly.com", "https://api.socialcastly.com"]
    assert resolve_cors_origins(None, "http://localhost:8000", "production") == [
        "http://localhost:8000"
    ]
    dev = resolve_cors_origins(None, None, "development")
    assert "http://localhost:5173" in dev
    assert "http://127.0.0.1:8000" in dev
    with pytest.raises(RuntimeError, match="wildcard"):
        resolve_cors_origins("*", None, "development")
    with pytest.raises(RuntimeError, match="wildcard"):
        resolve_cors_origins(None, "https://socialcastly.com, *", "production")


def test_allowed_hosts_require_an_explicit_production_list():
    assert resolve_allowed_hosts(
        "socialcastly.com, api.socialcastly.com", "production"
    ) == ["socialcastly.com", "api.socialcastly.com"]
    dev = resolve_allowed_hosts(None, "development")
    assert "localhost" in dev and "testserver" in dev
    with pytest.raises(RuntimeError, match="ALLOWED_HOSTS"):
        resolve_allowed_hosts(None, "production")
    with pytest.raises(RuntimeError, match="not \\*"):
        resolve_allowed_hosts("*", "production")
    assert resolve_allowed_hosts("localhost", "test") == ["localhost", "testserver"]


def test_configured_origin_is_allowed_and_a_stranger_is_not(client):
    from app.core.config import CORS_ALLOWED_ORIGINS

    origin = CORS_ALLOWED_ORIGINS[0]
    allowed = client.get("/api/v1/health", headers={"Origin": origin})
    assert allowed.headers.get("access-control-allow-origin") == origin
    assert allowed.headers.get("access-control-allow-credentials") == "true"
    stranger = client.get("/api/v1/health", headers={"Origin": "https://evil.example"})
    assert stranger.headers.get("access-control-allow-origin") != "https://evil.example"


def test_trusted_host_rejects_an_unknown_host():
    with TestClient(app, base_url="http://evil.example") as evil:
        response = evil.get("/api/v1/health")
    assert response.status_code == 400


def test_forwarded_proto_https_is_honored_from_the_tunnel():
    import anyio
    from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

    seen = {}

    async def inner(scope, receive, send):
        seen["scheme"] = scope["scheme"]
        await send(
            {
                "type": "http.response.start",
                "status": 200,
                "headers": [(b"content-type", b"text/plain")],
            }
        )
        await send({"type": "http.response.body", "body": b"ok"})

    wrapped = ProxyHeadersMiddleware(inner, trusted_hosts="127.0.0.1")

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(_message):
        return None

    def scope_for(client, proto):
        return {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": "/",
            "raw_path": b"/",
            "query_string": b"",
            "headers": [(b"x-forwarded-proto", proto)],
            "client": client,
            "server": ("127.0.0.1", 8000),
        }

    anyio.run(wrapped, scope_for(("127.0.0.1", 1234), b"https"), receive, send)
    assert seen["scheme"] == "https"
    anyio.run(wrapped, scope_for(("203.0.113.8", 1234), b"https"), receive, send)
    assert seen["scheme"] == "http"


def test_cookie_is_secure_on_https(client):
    email = f"cookie-{uuid4().hex[:8]}@example.com"
    password = "a-long-password"
    assert (
        client.post(
            "/api/v1/auth/register",
            json={
                "full_name": "Cookie User",
                "workspace_name": "Studio",
                "email": email,
                "password": password,
            },
        ).status_code
        == 201
    )
    logged_in = client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    assert logged_in.status_code == 200
    header = logged_in.headers["set-cookie"]
    assert "sc_refresh=" in header
    assert "HttpOnly" in header
    assert "Secure" not in header

    class _Url:
        scheme = "https"

    class _Request:
        url = _Url()

    assert cookie_secure(_Request()) is True


def test_docs_are_hidden_in_production_unless_debug(client, monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DEBUG", "false")
    for path in ("/docs", "/docs/oauth2-redirect", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404, path
    monkeypatch.setenv("DEBUG", "true")
    assert client.get("/docs").status_code == 200
    assert client.get("/openapi.json").status_code == 200
    assert "GET /docs" in GATED_DEV_PATHS


def _fill(path: str) -> str:
    filled = (
        path.replace("{platform}", "x")
        .replace("{account_id}", "00000000-0000-0000-0000-000000000001")
        .replace("{post_id}", "00000000-0000-0000-0000-000000000001")
        .replace("{item_id}", "00000000-0000-0000-0000-000000000001")
        .replace("{session_id}", "00000000-0000-0000-0000-000000000001")
        .replace("{filename}", "photo.jpg")
    )
    assert "{" not in filled, path
    return filled


def _iter_routes(router, prefix=""):
    """Yield method sets and full paths, including FastAPI's nested included routers."""
    for route in getattr(router, "routes", []):
        if hasattr(route, "original_router"):
            child = prefix + (route.include_context.prefix or "")
            yield from _iter_routes(route.original_router, child)
            continue
        path = getattr(route, "path", None)
        methods = getattr(route, "methods", None)
        if methods is None or path is None:
            continue
        yield methods, prefix + path


def test_every_non_public_api_route_requires_auth(client):
    protected = []
    public = []
    for methods, path in _iter_routes(app):
        if not path.startswith("/api/"):
            continue
        for method in sorted(methods - {"HEAD", "OPTIONS"}):
            if is_public_api(method, path):
                public.append((method, path))
                continue
            response = client.request(method, _fill(path))
            assert response.status_code == 401, (method, path, response.status_code)
            protected.append((method, path))
    assert protected, "expected protected API routes"
    assert ("GET", "/api/v1/accounts") in protected
    assert ("GET", "/api/v1/posts") in protected
    assert ("POST", "/api/v1/upload") in protected
    assert ("GET", "/api/v1/health") in public
    assert ("GET", "/api/v1/accounts/{platform}/callback") in public
    assert ("POST", "/api/v1/auth/login") in public
    assert ("POST", "/api/v1/accounts/facebook/data-deletion") in public
    health = client.get("/api/v1/health")
    assert health.status_code == 200
    callback = client.get("/api/v1/accounts/x/callback", follow_redirects=False)
    assert callback.status_code != 401
    deletion = client.get("/api/v1/accounts/facebook/data-deletion")
    assert deletion.status_code == 200
    privacy = client.get("/privacy")
    assert privacy.status_code == 200
    assert "Data Deletion" in privacy.text
    assert len(PUBLIC_API) == len({(method, path) for method, path in PUBLIC_API})


def test_public_media_url_uses_public_base(monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://api.socialcastly.com")
    assert (
        public_media_url("/media/a.jpg", platform="Instagram")
        == "https://api.socialcastly.com/media/a.jpg"
    )
    assert (
        public_media_url("/static/uploads/a.jpg", platform="Threads")
        == "https://api.socialcastly.com/static/uploads/a.jpg"
    )
    assert (
        public_media_url("http://127.0.0.1:8000/media/a.jpg", platform="TikTok")
        == "https://api.socialcastly.com/media/a.jpg"
    )
    assert hosted_media_url("abc.jpg") == "https://api.socialcastly.com/media/abc.jpg"
    monkeypatch.setenv("PUBLIC_BASE_URL", "http://api.socialcastly.com")
    assert (
        public_media_url("/media/a.jpg", platform="Facebook")
        == "https://api.socialcastly.com/media/a.jpg"
    )


def test_local_media_url_is_not_treated_as_public(monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", "http://localhost:8000")
    with pytest.raises(ProviderConfigurationError, match="publicly fetchable"):
        public_media_url("/media/a.jpg", platform="Instagram")


def test_upload_returns_public_media_url(client, auth_headers, monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://api.socialcastly.com")
    headers, _ = auth_headers
    response = client.post(
        "/api/v1/upload",
        headers=headers,
        files={"file": ("photo.jpg", b"\xff\xd8\xff\xd9", "image/jpeg")},
    )
    assert response.status_code == 201, response.text
    url = response.json()["url"]
    assert url.startswith("https://api.socialcastly.com/media/")
    assert url.endswith(".jpg")
    name = url.rsplit("/", 1)[-1]
    fetched = client.get(f"/media/{name}")
    assert fetched.status_code == 200
    assert fetched.content == b"\xff\xd8\xff\xd9"
    from app.main import FRONTEND_UPLOADS

    (FRONTEND_UPLOADS / name).unlink(missing_ok=True)
