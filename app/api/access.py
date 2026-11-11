"""Routes that stay public, and dev-only docs paths that production hides.

Every other ``/api/`` route requires a bearer access token. The studio shell
also refuses to mount signed-in pages without a token (see frontend sessionGate).
"""

from __future__ import annotations

import re

# OAuth callbacks, login/signup, health, and Meta webhook / data-deletion callbacks.
# ``POST /auth/refresh`` stays public because the caller presents a refresh token,
# not an access token. ``POST /auth/token`` is the OAuth2 password form for login.
_META_PLATFORMS = ("facebook", "instagram", "threads")
_META_POST_SUFFIXES = ("uninstall", "deauthorize", "delete", "data-deletion")

PUBLIC_API: tuple[tuple[str, str], ...] = (
    ("POST", "/api/v1/auth/register"),
    ("POST", "/api/v1/auth/signup"),
    ("POST", "/api/v1/auth/login"),
    ("POST", "/api/v1/auth/token"),
    ("POST", "/api/v1/auth/refresh"),
    ("GET", "/api/v1/health"),
    ("GET", "/api/v1/accounts/{platform}/callback"),
    *(
        ("POST", f"/api/v1/accounts/{platform}/{suffix}")
        for platform in _META_PLATFORMS
        for suffix in _META_POST_SUFFIXES
    ),
    *(
        ("GET", f"/api/v1/accounts/{platform}/data-deletion")
        for platform in _META_PLATFORMS
    ),
)

# Pages and files that must load before sign-in, or that other networks fetch.
PUBLIC_PAGES: tuple[str, ...] = (
    "GET /",
    "GET /privacy",
    "GET /privacy.html",
    "GET /terms",
    "GET /terms.html",
    "GET /media/{filename}",
    "GET /static/uploads/{filename}",
    "GET /static/build/*",
)

# No debug, seed, or test routes exist under app/. These dev-only docs paths
# are the ones gated by APP_ENV=production and DEBUG=false.
GATED_DEV_PATHS: tuple[str, ...] = (
    "GET /docs",
    "GET /docs/oauth2-redirect",
    "GET /redoc",
    "GET /openapi.json",
    "GET /docs-assets/*",
)


def _pattern_regex(pattern: str) -> re.Pattern[str]:
    parts: list[str] = []
    for token in re.split(r"(\{[^}]+\})", pattern):
        if token.startswith("{") and token.endswith("}"):
            parts.append("[^/]+")
        else:
            parts.append(re.escape(token))
    return re.compile("^" + "".join(parts) + "$")


_PUBLIC_MATCHERS = tuple((method, _pattern_regex(path)) for method, path in PUBLIC_API)


def is_public_api(method: str, path: str) -> bool:
    """True for an allowlisted method and either a route template or a concrete path."""
    method = method.upper()
    normalized = path.rstrip("/") or "/"
    for allowed_method, pattern in PUBLIC_API:
        if method == allowed_method and normalized == pattern.rstrip("/"):
            return True
    for allowed_method, matcher in _PUBLIC_MATCHERS:
        if method == allowed_method and matcher.match(normalized):
            return True
    return False


def is_dev_docs_path(path: str) -> bool:
    """Swagger, ReDoc, the OpenAPI schema, and the self-hosted docs assets."""
    normalized = path.rstrip("/") or "/"
    return (
        normalized in {"/docs", "/redoc", "/openapi.json"}
        or normalized.startswith("/docs/")
        or normalized.startswith("/docs-assets")
    )
