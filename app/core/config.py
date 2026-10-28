import os
from pathlib import Path

from dotenv import load_dotenv

_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(_ENV_FILE, override=False)  # process env (tests, Docker) wins over .env

APP_NAME = os.getenv("APP_NAME", "social-scheduler")
APP_ENV = os.getenv("APP_ENV", "development").lower()
DEBUG = os.getenv("DEBUG", "false").lower() in {"1", "true", "yes"}
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./local.db")
SECRET_KEY = os.getenv("SECRET_KEY", "development-only-change-me")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "14"))
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")
TOKEN_ENCRYPTION_KEY = os.getenv("TOKEN_ENCRYPTION_KEY", "")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

INSTAGRAM_CLIENT_ID = os.getenv("INSTAGRAM_CLIENT_ID", "")
INSTAGRAM_CLIENT_SECRET = os.getenv("INSTAGRAM_CLIENT_SECRET", "")
INSTAGRAM_REDIRECT_URI = os.getenv(
    "INSTAGRAM_REDIRECT_URI", f"{PUBLIC_BASE_URL}/api/v1/accounts/instagram/callback"
)
INSTAGRAM_GRAPH_API_VERSION = os.getenv("INSTAGRAM_GRAPH_API_VERSION", "v24.0")

LINKEDIN_CLIENT_ID = os.getenv("LINKEDIN_CLIENT_ID", "")
LINKEDIN_CLIENT_SECRET = os.getenv("LINKEDIN_CLIENT_SECRET", "")
LINKEDIN_REDIRECT_URI = os.getenv(
    "LINKEDIN_REDIRECT_URI", f"{PUBLIC_BASE_URL}/api/v1/accounts/linkedin/callback"
)
LINKEDIN_VERSION = os.getenv("LINKEDIN_VERSION", "202610")

X_CLIENT_ID = os.getenv("X_CLIENT_ID", "")
X_CLIENT_SECRET = os.getenv("X_CLIENT_SECRET", "")
X_REDIRECT_URI = os.getenv("X_REDIRECT_URI", f"{PUBLIC_BASE_URL}/api/v1/accounts/x/callback")

FACEBOOK_CLIENT_ID = os.getenv("FACEBOOK_CLIENT_ID", "")
FACEBOOK_CLIENT_SECRET = os.getenv("FACEBOOK_CLIENT_SECRET", "")
FACEBOOK_REDIRECT_URI = os.getenv(
    "FACEBOOK_REDIRECT_URI", f"{PUBLIC_BASE_URL}/api/v1/accounts/facebook/callback"
)
FACEBOOK_GRAPH_API_VERSION = os.getenv("FACEBOOK_GRAPH_API_VERSION", "v21.0")

YOUTUBE_CLIENT_ID = os.getenv("YOUTUBE_CLIENT_ID", "")
YOUTUBE_CLIENT_SECRET = os.getenv("YOUTUBE_CLIENT_SECRET", "")
YOUTUBE_REDIRECT_URI = os.getenv(
    "YOUTUBE_REDIRECT_URI", f"{PUBLIC_BASE_URL}/api/v1/accounts/youtube/callback"
)

TIKTOK_CLIENT_KEY = os.getenv("TIKTOK_CLIENT_KEY", "")
TIKTOK_CLIENT_SECRET = os.getenv("TIKTOK_CLIENT_SECRET", "")
TIKTOK_REDIRECT_URI = os.getenv(
    "TIKTOK_REDIRECT_URI", f"{PUBLIC_BASE_URL}/api/v1/accounts/tiktok/callback"
)

PINTEREST_CLIENT_ID = os.getenv("PINTEREST_CLIENT_ID", "")
PINTEREST_CLIENT_SECRET = os.getenv("PINTEREST_CLIENT_SECRET", "")
PINTEREST_REDIRECT_URI = os.getenv(
    "PINTEREST_REDIRECT_URI", f"{PUBLIC_BASE_URL}/api/v1/accounts/pinterest/callback"
)

THREADS_CLIENT_ID = os.getenv("THREADS_CLIENT_ID", "")
THREADS_CLIENT_SECRET = os.getenv("THREADS_CLIENT_SECRET", "")
THREADS_REDIRECT_URI = os.getenv(
    "THREADS_REDIRECT_URI", f"{PUBLIC_BASE_URL}/api/v1/accounts/threads/callback"
)
THREADS_API_VERSION = os.getenv("THREADS_API_VERSION", "v1.0")

CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", REDIS_URL)
CELERY_RESULT_BACKEND = None
POST_MAX_ATTEMPTS = int(os.getenv("POST_MAX_ATTEMPTS", "5"))
SCHEDULER_POLL_SECONDS = int(os.getenv("SCHEDULER_POLL_SECONDS", "30"))
ALLOWED_ORIGINS = [value.strip() for value in os.getenv("ALLOWED_ORIGINS", "").split(",") if value.strip()]

if APP_ENV == "production":
    if len(SECRET_KEY) < 32 or SECRET_KEY == "development-only-change-me":
        raise RuntimeError("Set a strong SECRET_KEY (at least 32 characters) in production")
    if not TOKEN_ENCRYPTION_KEY or TOKEN_ENCRYPTION_KEY.startswith("REPLACE_"):
        raise RuntimeError("Set TOKEN_ENCRYPTION_KEY in production")
    if not ALLOWED_ORIGINS or "*" in ALLOWED_ORIGINS:
        raise RuntimeError("Set explicit ALLOWED_ORIGINS in production")
