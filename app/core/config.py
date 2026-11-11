"""Process environment for the API, OAuth apps, and the scheduler.

Values are read once at import. load_dotenv does not override variables
already set in the process, so tests and Docker win over .env.
"""

import ipaddress
import os
from pathlib import Path
from urllib.parse import urlparse, urlunparse

from dotenv import load_dotenv

_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(_ENV_FILE, override=False)  # process env (tests, Docker) wins over .env

_LOCAL_HOSTS = {
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "host.docker.internal",
    "testserver",
}
DEV_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]
DEV_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "::1", "testserver"]


def split_csv(value: str | None) -> list[str]:
    """Split a comma-separated env value, dropping blanks."""
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def host_is_local(hostname: str | None) -> bool:
    """True for loopback, private, and other hosts that are not on the public internet."""
    if not hostname:
        return True
    host = hostname.strip().lower().rstrip(".")
    if host in _LOCAL_HOSTS or host.endswith(".local") or host.endswith(".localhost"):
        return True
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    return bool(
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        or address.is_multicast
        or address.is_unspecified
    )


def prefer_https(url: str) -> str:
    """Use https for a public host. Local development URLs stay on http."""
    raw = (url or "").strip()
    if not raw:
        return raw
    parsed = urlparse(raw)
    if parsed.scheme == "http" and not host_is_local(parsed.hostname):
        upgraded = urlunparse(parsed._replace(scheme="https"))
        return upgraded.rstrip("/")
    return raw.rstrip("/")


def resolve_cors_origins(
    cors_raw: str | None, allowed_raw: str | None, app_env: str
) -> list[str]:
    """CORS origins from CORS_ALLOWED_ORIGINS, then ALLOWED_ORIGINS, then localhost in dev.

    A wildcard is rejected so credentials are never combined with ``*``.
    """
    if cors_raw is not None and cors_raw.strip():
        origins = split_csv(cors_raw)
    elif allowed_raw is not None and allowed_raw.strip():
        origins = split_csv(allowed_raw)
    else:
        origins = []
    if not origins and app_env != "production":
        origins = list(DEV_CORS_ORIGINS)
    if "*" in origins:
        raise RuntimeError(
            "CORS_ALLOWED_ORIGINS must list explicit origins. "
            "A wildcard is not allowed with credentialed browser requests."
        )
    return origins


def resolve_allowed_hosts(raw: str | None, app_env: str) -> list[str]:
    """Host header allow-list. Production must set ALLOWED_HOSTS. Tests keep testserver."""
    hosts = split_csv(raw)
    if not hosts:
        if app_env == "production":
            raise RuntimeError(
                "Set ALLOWED_HOSTS in production "
                "(for example socialcastly.com,api.socialcastly.com)"
            )
        hosts = list(DEV_ALLOWED_HOSTS)
    if "*" in hosts:
        raise RuntimeError("ALLOWED_HOSTS must list explicit hosts, not *")
    if app_env == "test" and "testserver" not in hosts:
        hosts.append("testserver")
    return hosts


def oauth_redirect_uri(env_name: str, platform: str) -> str:
    """Provider callback URL. Explicit env wins; otherwise PUBLIC_BASE_URL plus the route.

    Public http hosts are upgraded to https so a tunnel in front of uvicorn still
    registers an https redirect URI. localhost stays http.
    """
    explicit = (os.getenv(env_name) or "").strip()
    if explicit:
        return prefer_https(explicit)
    return f"{PUBLIC_BASE_URL}/api/v1/accounts/{platform}/callback"


def docs_enabled() -> bool:
    """Branded docs and the OpenAPI schema stay off in production unless DEBUG is on."""
    env = os.getenv("APP_ENV", "development").lower()
    debug = os.getenv("DEBUG", "false").lower() in {"1", "true", "yes"}
    return not (env == "production" and not debug)


APP_NAME = os.getenv("APP_NAME", "social-scheduler")
APP_ENV = os.getenv("APP_ENV", "development").lower()
DEBUG = os.getenv("DEBUG", "false").lower() in {"1", "true", "yes"}
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./local.db")
SECRET_KEY = os.getenv("SECRET_KEY", "development-only-change-me")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "14"))
PUBLIC_BASE_URL = prefer_https(
    os.getenv("PUBLIC_BASE_URL", "http://localhost:8000").strip()
)
# Browser-facing frontend origin for post-OAuth redirects; defaults to PUBLIC_BASE_URL.
FRONTEND_URL = prefer_https((os.getenv("FRONTEND_URL") or PUBLIC_BASE_URL).strip())
TOKEN_ENCRYPTION_KEY = os.getenv("TOKEN_ENCRYPTION_KEY", "")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

INSTAGRAM_CLIENT_ID = os.getenv("INSTAGRAM_CLIENT_ID", "")
INSTAGRAM_CLIENT_SECRET = os.getenv("INSTAGRAM_CLIENT_SECRET", "")
INSTAGRAM_REDIRECT_URI = oauth_redirect_uri("INSTAGRAM_REDIRECT_URI", "instagram")
INSTAGRAM_GRAPH_API_VERSION = os.getenv("INSTAGRAM_GRAPH_API_VERSION", "v24.0")
# Facebook Login for Business configuration (permissions are defined by the config, not scope=).
INSTAGRAM_CONFIG_ID = os.getenv("INSTAGRAM_CONFIG_ID", "")

LINKEDIN_CLIENT_ID = os.getenv("LINKEDIN_CLIENT_ID", "")
LINKEDIN_CLIENT_SECRET = os.getenv("LINKEDIN_CLIENT_SECRET", "")
LINKEDIN_REDIRECT_URI = oauth_redirect_uri("LINKEDIN_REDIRECT_URI", "linkedin")
LINKEDIN_VERSION = os.getenv("LINKEDIN_VERSION", "202610")

X_CLIENT_ID = os.getenv("X_CLIENT_ID", "")
X_CLIENT_SECRET = os.getenv("X_CLIENT_SECRET", "")
X_REDIRECT_URI = oauth_redirect_uri("X_REDIRECT_URI", "x")

FACEBOOK_CLIENT_ID = os.getenv("FACEBOOK_CLIENT_ID", "")
FACEBOOK_CLIENT_SECRET = os.getenv("FACEBOOK_CLIENT_SECRET", "")
FACEBOOK_REDIRECT_URI = oauth_redirect_uri("FACEBOOK_REDIRECT_URI", "facebook")
FACEBOOK_GRAPH_API_VERSION = os.getenv("FACEBOOK_GRAPH_API_VERSION", "v21.0")

YOUTUBE_CLIENT_ID = os.getenv("YOUTUBE_CLIENT_ID", "")
YOUTUBE_CLIENT_SECRET = os.getenv("YOUTUBE_CLIENT_SECRET", "")
YOUTUBE_REDIRECT_URI = oauth_redirect_uri("YOUTUBE_REDIRECT_URI", "youtube")

TIKTOK_CLIENT_KEY = os.getenv("TIKTOK_CLIENT_KEY", "")
TIKTOK_CLIENT_SECRET = os.getenv("TIKTOK_CLIENT_SECRET", "")
TIKTOK_REDIRECT_URI = oauth_redirect_uri("TIKTOK_REDIRECT_URI", "tiktok")

PINTEREST_CLIENT_ID = os.getenv("PINTEREST_CLIENT_ID", "")
PINTEREST_CLIENT_SECRET = os.getenv("PINTEREST_CLIENT_SECRET", "")
PINTEREST_REDIRECT_URI = oauth_redirect_uri("PINTEREST_REDIRECT_URI", "pinterest")

THREADS_CLIENT_ID = os.getenv("THREADS_CLIENT_ID", "")
THREADS_CLIENT_SECRET = os.getenv("THREADS_CLIENT_SECRET", "")
THREADS_REDIRECT_URI = oauth_redirect_uri("THREADS_REDIRECT_URI", "threads")
THREADS_API_VERSION = os.getenv("THREADS_API_VERSION", "v1.0")

CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", REDIS_URL)
CELERY_RESULT_BACKEND = None
POST_MAX_ATTEMPTS = int(os.getenv("POST_MAX_ATTEMPTS", "5"))
SCHEDULER_POLL_SECONDS = int(os.getenv("SCHEDULER_POLL_SECONDS", "30"))
# CORS_ALLOWED_ORIGINS wins. ALLOWED_ORIGINS remains the fallback name.
CORS_ALLOWED_ORIGINS = resolve_cors_origins(
    os.getenv("CORS_ALLOWED_ORIGINS"),
    os.getenv("ALLOWED_ORIGINS"),
    APP_ENV,
)
ALLOWED_ORIGINS = CORS_ALLOWED_ORIGINS
ALLOWED_HOSTS = resolve_allowed_hosts(os.getenv("ALLOWED_HOSTS"), APP_ENV)
# Cloudflare Tunnel on this laptop connects from the loopback interface.
FORWARDED_ALLOW_IPS = (
    os.getenv("FORWARDED_ALLOW_IPS", "127.0.0.1").strip() or "127.0.0.1"
)

if APP_ENV == "production":
    if len(SECRET_KEY) < 32 or SECRET_KEY == "development-only-change-me":
        raise RuntimeError(
            "Set a strong SECRET_KEY (at least 32 characters) in production"
        )
    if not TOKEN_ENCRYPTION_KEY or TOKEN_ENCRYPTION_KEY.startswith("REPLACE_"):
        raise RuntimeError("Set TOKEN_ENCRYPTION_KEY in production")
    if not ALLOWED_ORIGINS or "*" in ALLOWED_ORIGINS:
        raise RuntimeError(
            "Set explicit CORS_ALLOWED_ORIGINS (or ALLOWED_ORIGINS) in production"
        )
    if not ALLOWED_HOSTS or "*" in ALLOWED_HOSTS:
        raise RuntimeError("Set explicit ALLOWED_HOSTS in production")
