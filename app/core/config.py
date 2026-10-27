import os

from dotenv import load_dotenv

load_dotenv()

APP_NAME = os.getenv("APP_NAME", "social-scheduler")
APP_ENV = os.getenv("APP_ENV", "development").lower()
DEBUG = os.getenv("DEBUG", "false").lower() in {"1", "true", "yes"}
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./local.db")
SECRET_KEY = os.getenv("SECRET_KEY", "development-only-change-me")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
TOKEN_ENCRYPTION_KEY = os.getenv("TOKEN_ENCRYPTION_KEY", "")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", REDIS_URL)
# Task results are not read by this application, so disable the Redis result
# backend and its connection attempts entirely.
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
