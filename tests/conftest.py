"""Isolated SQLite database for API tests."""

import os
import tempfile
from pathlib import Path
from uuid import uuid4

from cryptography.fernet import Fernet

_db_path = Path(tempfile.mkdtemp(prefix="social-scheduler-tests-")) / "test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_db_path}"
os.environ["SECRET_KEY"] = "test-secret-key-please-change-32b"
os.environ["TOKEN_ENCRYPTION_KEY"] = Fernet.generate_key().decode()
os.environ["APP_ENV"] = "test"
os.environ["ACCESS_TOKEN_EXPIRE_MINUTES"] = "30"
os.environ["REFRESH_TOKEN_EXPIRE_DAYS"] = "14"
os.environ.setdefault("PUBLIC_BASE_URL", "http://localhost:8000")
for name in (
    "X_CLIENT_ID",
    "X_CLIENT_SECRET",
    "LINKEDIN_CLIENT_ID",
    "LINKEDIN_CLIENT_SECRET",
    "INSTAGRAM_CLIENT_ID",
    "INSTAGRAM_CLIENT_SECRET",
):
    os.environ[name] = ""

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture()
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def auth_headers(client):
    email = f"owner-{uuid4().hex[:8]}@example.com"
    password = "super-secret-password"
    registered = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Owner Example",
            "workspace_name": "Studio",
            "email": email,
            "password": password,
        },
    )
    assert registered.status_code == 201, registered.text
    logged_in = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert logged_in.status_code == 200, logged_in.text
    body = logged_in.json()
    return {"Authorization": f"Bearer {body['access_token']}"}, body
