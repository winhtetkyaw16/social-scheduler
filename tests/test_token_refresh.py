"""Proactive OAuth refresh. HTTP is mocked; these tests never call a real network."""

import logging
import threading
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import httpx
import pytest

from app.core.security import decrypt_token, encrypt_token
from app.db.session import SessionLocal
from app.models import ConnectedAccount, ScheduledPost
from app.services import oauth
from app.services.accounts import create_pick_session
from app.services.destinations import save_destinations
from app.services.error_messages import friendly_error
from app.services.token_refresh import (
    connection_warning,
    due_for_refresh,
    refresh_connected_account,
    run_token_refresh_sweep,
)
from app.tasks.celery_app import celery_app

_CREDS = {
    "x": ("X_CLIENT_ID", "X_CLIENT_SECRET"),
    "linkedin": ("LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"),
    "youtube": ("YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"),
    "tiktok": ("TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"),
    "pinterest": ("PINTEREST_CLIENT_ID", "PINTEREST_CLIENT_SECRET"),
    "threads": ("THREADS_CLIENT_ID", "THREADS_CLIENT_SECRET"),
    "facebook": ("FACEBOOK_CLIENT_ID", "FACEBOOK_CLIENT_SECRET"),
    "instagram": ("INSTAGRAM_CLIENT_ID", "INSTAGRAM_CLIENT_SECRET"),
}


class _Resp:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    @property
    def is_error(self):
        return self.status_code >= 400

    def json(self):
        return self._payload


@pytest.fixture(autouse=True)
def _memory_lock(monkeypatch):
    monkeypatch.setenv("TOKEN_REFRESH_LOCK", "memory")


def _enable(monkeypatch, platform):
    client_id, secret = _CREDS[platform]
    monkeypatch.setenv(client_id, f"{platform}-client")
    monkeypatch.setenv(secret, f"{platform}-secret-value")


def _connect(
    client,
    headers,
    platform,
    *,
    hours=1,
    refresh="old-refresh",
    access="old-access",
    account_type=None,
):
    body = {
        "platform": platform,
        "platform_account_id": f"{platform}-{uuid4().hex[:8]}",
        "account_name": platform,
        "access_token": access,
        "token_expires_at": (
            datetime.now(timezone.utc) + timedelta(hours=hours)
        ).isoformat(),
        "scopes": ["test"],
    }
    if refresh is not None:
        body["refresh_token"] = refresh
    if account_type:
        body["account_type"] = account_type
    created = client.post("/api/v1/accounts", headers=headers, json=body)
    assert created.status_code == 201, created.text
    return created.json()["id"]


def _open(account_id):
    db = SessionLocal()
    account = db.get(ConnectedAccount, UUID(account_id))
    assert account is not None
    return db, account


def _patch_post(monkeypatch, payload, status_code=200, capture=None):
    def fake_post(url, data=None, auth=None, **kwargs):
        if capture is not None:
            capture.append({"url": url, "data": dict(data or {}), "auth": auth})
        return _Resp(payload, status_code)

    monkeypatch.setattr("app.services.token_refresh.httpx.post", fake_post)


def _user_id(account_id):
    db, account = _open(account_id)
    try:
        return account.user_id
    finally:
        db.close()


def test_beat_schedule_registers_hourly_refresh():
    job = celery_app.conf.beat_schedule["refresh-expiring-tokens"]
    assert job["task"] == "app.tasks.refresh_tokens.refresh_expiring_tokens"
    assert job["schedule"] == 3600


def test_inprocess_scheduler_runs_the_sweep_on_its_interval(monkeypatch):
    import app.tasks.inprocess_scheduler as scheduler

    calls = []
    monkeypatch.setattr(
        "app.tasks.refresh_tokens.sweep_expiring_tokens",
        lambda: calls.append("sweep") or {"refreshed": 2},
    )
    scheduler._last_token_refresh_at = None
    assert scheduler.maybe_refresh_expiring_tokens() == 2
    assert calls == ["sweep"]
    assert scheduler.maybe_refresh_expiring_tokens() == 0
    assert calls == ["sweep"]
    scheduler._last_token_refresh_at = None


def test_selection_window_matches_each_network(client, auth_headers):
    headers, _ = auth_headers
    soon_x = _connect(client, headers, "x", hours=23)
    later_x = _connect(client, headers, "x", hours=48)
    soon_threads = _connect(client, headers, "threads", hours=24 * 6, refresh=None)
    later_threads = _connect(client, headers, "threads", hours=24 * 8, refresh=None)
    page = _connect(
        client, headers, "facebook", hours=20, refresh=None, account_type="page"
    )
    linkedin_plain = _connect(client, headers, "linkedin", hours=24 * 3, refresh=None)
    linkedin_refresh = _connect(client, headers, "linkedin", hours=10)
    now = datetime.now(timezone.utc)
    db = SessionLocal()
    try:

        def due(account_id):
            return due_for_refresh(db.get(ConnectedAccount, UUID(account_id)), now)

        assert due(soon_x) is True
        assert due(later_x) is False
        assert due(soon_threads) is True
        assert due(later_threads) is False
        assert due(page) is False
        assert due(linkedin_plain) is False
        assert due(linkedin_refresh) is True
        plain = db.get(ConnectedAccount, UUID(linkedin_plain))
        warning = connection_warning(plain, now)
        assert warning
        assert "LinkedIn" in warning
        assert "invalid_grant" not in warning.lower()
        assert "error code" not in warning.lower()
    finally:
        db.close()


@pytest.mark.parametrize(
    "platform,payload,rotated",
    [
        (
            "x",
            {
                "access_token": "x-access-new",
                "refresh_token": "x-refresh-new",
                "expires_in": 7200,
            },
            True,
        ),
        ("youtube", {"access_token": "yt-access-new", "expires_in": 3600}, False),
        (
            "tiktok",
            {
                "access_token": "tt-access-new",
                "refresh_token": "tt-refresh-new",
                "expires_in": 86400,
                "refresh_expires_in": 31536000,
            },
            True,
        ),
        (
            "linkedin",
            {
                "access_token": "li-access-new",
                "refresh_token": "li-refresh-new",
                "expires_in": 5184000,
            },
            True,
        ),
        (
            "pinterest",
            {
                "access_token": "pin-access-new",
                "refresh_token": "pin-refresh-new",
                "expires_in": 2592000,
                "refresh_token_expires_in": 5184000,
            },
            True,
        ),
    ],
)
def test_refresh_grant_stores_new_tokens(
    client, auth_headers, monkeypatch, platform, payload, rotated
):
    _enable(monkeypatch, platform)
    headers, _ = auth_headers
    account_id = _connect(
        client,
        headers,
        platform,
        access=f"{platform}-access-old",
        refresh=f"{platform}-refresh-old",
    )
    captured = []
    _patch_post(monkeypatch, payload, capture=captured)
    db, account = _open(account_id)
    try:
        result = refresh_connected_account(
            db, account, window=timedelta(hours=24), wait_seconds=0
        )
        db.refresh(account)
        assert result.status == "refreshed"
        assert decrypt_token(account.access_token_ciphertext) == payload["access_token"]
        if rotated:
            assert (
                decrypt_token(account.refresh_token_ciphertext)
                == payload["refresh_token"]
            )
        else:
            assert (
                decrypt_token(account.refresh_token_ciphertext)
                == f"{platform}-refresh-old"
            )
        assert account.needs_reconnect is False
        assert account.token_expires_at is not None
        sent = captured[0]
        assert sent["data"]["grant_type"] == "refresh_token"
        assert sent["data"]["refresh_token"] == f"{platform}-refresh-old"
        if platform == "tiktok":
            assert sent["data"]["client_key"] == "tiktok-client"
            assert sent["auth"] is None
        elif platform in {"x", "pinterest"}:
            assert sent["auth"] == (f"{platform}-client", f"{platform}-secret-value")
        else:
            assert sent["data"]["client_secret"] == f"{platform}-secret-value"
    finally:
        db.close()


def test_tiktok_nested_data_and_threads_refresh(client, auth_headers, monkeypatch):
    headers, _ = auth_headers
    _enable(monkeypatch, "tiktok")
    tiktok_id = _connect(client, headers, "tiktok")
    _patch_post(
        monkeypatch,
        {
            "data": {
                "access_token": "tt-nested-access",
                "refresh_token": "tt-nested-refresh",
                "expires_in": 7200,
            }
        },
    )
    db, account = _open(tiktok_id)
    try:
        result = refresh_connected_account(
            db, account, window=timedelta(hours=24), wait_seconds=0
        )
        db.refresh(account)
        assert result.status == "refreshed"
        assert decrypt_token(account.refresh_token_ciphertext) == "tt-nested-refresh"
    finally:
        db.close()

    _enable(monkeypatch, "threads")
    threads_id = _connect(
        client,
        headers,
        "threads",
        hours=24 * 3,
        refresh=None,
        access="threads-access-old",
    )
    captured = []

    def fake_get(url, params=None, **kwargs):
        captured.append({"url": url, "params": dict(params or {})})
        return _Resp({"access_token": "threads-access-new", "expires_in": 5183944})

    monkeypatch.setattr("app.services.token_refresh.httpx.get", fake_get)
    db, account = _open(threads_id)
    try:
        result = refresh_connected_account(
            db, account, window=timedelta(days=7), wait_seconds=0
        )
        db.refresh(account)
        assert result.status == "refreshed"
        assert decrypt_token(account.access_token_ciphertext) == "threads-access-new"
        assert captured[0]["url"] == "https://graph.threads.net/refresh_access_token"
        assert captured[0]["params"]["grant_type"] == "th_refresh_token"
        assert captured[0]["params"]["access_token"] == "threads-access-old"
    finally:
        db.close()


def test_permanent_failure_marks_reconnect_and_fails_scheduled_posts(
    client, auth_headers, monkeypatch
):
    _enable(monkeypatch, "x")
    headers, _ = auth_headers
    account_id = _connect(
        client, headers, "x", access="x-access-secret", refresh="x-refresh-secret"
    )
    created = client.post(
        "/api/v1/posts",
        headers=headers,
        json={
            "connected_account_id": account_id,
            "content": "Keep this queued",
            "media_urls": [],
            "scheduled_at": (
                datetime.now(timezone.utc) + timedelta(days=2)
            ).isoformat(),
            "idempotency_key": uuid4().hex,
            "post_metadata": {"format": "Post"},
        },
    )
    assert created.status_code == 200, created.text
    post_id = created.json()["id"]
    _patch_post(
        monkeypatch,
        {"error": "invalid_grant", "error_description": "Token has been revoked."},
        400,
    )
    db, account = _open(account_id)
    try:
        result = refresh_connected_account(
            db, account, window=timedelta(hours=24), wait_seconds=0
        )
        db.refresh(account)
        post = db.get(ScheduledPost, UUID(post_id))
        assert result.status == "permanent"
        assert account.needs_reconnect is True
        reason = account.reconnect_reason or ""
        assert "invalid_grant" not in reason.lower()
        assert "revoked" not in reason.lower()
        assert "X" in reason
        assert post.status == "failed"
        assert post.last_error_code == "connection_expired"
        assert post.last_error_message == reason
        copy = friendly_error(post.last_error_code, post.last_error_message, "x")
        assert copy["category"] == "connection_expired"
        assert copy["actions"][0]["id"] == "reconnect"
        assert "invalid_grant" not in copy["banner"].lower()
    finally:
        db.close()


def test_transient_failure_retries_later(client, auth_headers, monkeypatch):
    _enable(monkeypatch, "youtube")
    headers, _ = auth_headers
    account_id = _connect(
        client,
        headers,
        "youtube",
        access="yt-access-secret",
        refresh="yt-refresh-secret",
    )

    def explode(*args, **kwargs):
        raise httpx.ConnectError("temporary network failure")

    monkeypatch.setattr("app.services.token_refresh.httpx.post", explode)
    db, account = _open(account_id)
    try:
        result = refresh_connected_account(
            db, account, window=timedelta(hours=24), wait_seconds=0
        )
        db.refresh(account)
        assert result.status == "transient"
        assert account.needs_reconnect is False
        assert decrypt_token(account.refresh_token_ciphertext) == "yt-refresh-secret"
    finally:
        db.close()

    _patch_post(monkeypatch, {"error": "server_error"}, 503)
    db, account = _open(account_id)
    try:
        result = refresh_connected_account(
            db, account, window=timedelta(hours=24), wait_seconds=0
        )
        db.refresh(account)
        assert result.status == "transient"
        assert account.needs_reconnect is False
    finally:
        db.close()


def test_lock_contention_does_not_start_a_second_refresh(
    client, auth_headers, monkeypatch
):
    _enable(monkeypatch, "x")
    headers, _ = auth_headers
    account_id = _connect(
        client, headers, "x", access="x-access-old", refresh="x-refresh-old"
    )
    started = threading.Event()
    release = threading.Event()
    calls = []

    def fake_post(url, data=None, **kwargs):
        calls.append(1)
        started.set()
        assert release.wait(5)
        return _Resp(
            {
                "access_token": "x-access-new",
                "refresh_token": "x-refresh-new",
                "expires_in": 7200,
            }
        )

    monkeypatch.setattr("app.services.token_refresh.httpx.post", fake_post)

    def worker():
        db = SessionLocal()
        try:
            account = db.get(ConnectedAccount, UUID(account_id))
            refresh_connected_account(
                db, account, window=timedelta(days=2), wait_seconds=5
            )
        finally:
            db.close()

    thread = threading.Thread(target=worker)
    thread.start()
    assert started.wait(5)
    db, account = _open(account_id)
    try:
        blocked = refresh_connected_account(
            db, account, window=timedelta(days=2), wait_seconds=0
        )
        assert blocked.status == "locked"
        assert calls == [1]
    finally:
        release.set()
        thread.join(5)
        db.close()
    db, account = _open(account_id)
    try:
        assert decrypt_token(account.refresh_token_ciphertext) == "x-refresh-new"
        assert len(calls) == 1
    finally:
        db.close()


def test_stale_refresh_does_not_overwrite_a_rotated_token(
    client, auth_headers, monkeypatch
):
    _enable(monkeypatch, "x")
    headers, _ = auth_headers
    account_id = _connect(
        client, headers, "x", access="x-access-old", refresh="x-refresh-old"
    )

    def fake_post(url, data=None, **kwargs):
        other = SessionLocal()
        try:
            row = other.get(ConnectedAccount, UUID(account_id))
            row.access_token_ciphertext = encrypt_token("winner-access")
            row.refresh_token_ciphertext = encrypt_token("winner-refresh")
            other.commit()
        finally:
            other.close()
        return _Resp(
            {
                "access_token": "loser-access",
                "refresh_token": "loser-refresh",
                "expires_in": 7200,
            }
        )

    monkeypatch.setattr("app.services.token_refresh.httpx.post", fake_post)
    db, account = _open(account_id)
    try:
        result = refresh_connected_account(
            db, account, window=timedelta(hours=24), wait_seconds=0
        )
        db.refresh(account)
        assert result.status == "stale"
        assert decrypt_token(account.refresh_token_ciphertext) == "winner-refresh"
        assert decrypt_token(account.access_token_ciphertext) == "winner-access"
        assert account.needs_reconnect is False
    finally:
        db.close()


def test_logs_omit_token_values(client, auth_headers, monkeypatch, caplog):
    _enable(monkeypatch, "pinterest")
    headers, _ = auth_headers
    access = "pinterest-access-SECRET"
    refresh = "pinterest-refresh-SECRET"
    account_id = _connect(client, headers, "pinterest", access=access, refresh=refresh)
    _patch_post(
        monkeypatch,
        {
            "access_token": "pinterest-access-NEWSECRET",
            "refresh_token": "pinterest-refresh-NEWSECRET",
            "expires_in": 2592000,
        },
    )
    caplog.set_level(logging.INFO)
    db, account = _open(account_id)
    try:
        result = refresh_connected_account(
            db, account, window=timedelta(hours=24), wait_seconds=0
        )
        assert result.status == "refreshed"
    finally:
        db.close()
    text = caplog.text
    for secret in (
        access,
        refresh,
        "pinterest-access-NEWSECRET",
        "pinterest-refresh-NEWSECRET",
        "pinterest-secret-value",
    ):
        assert secret not in text
    assert "outcome=refreshed" in text


def test_sweep_refreshes_only_the_due_account(client, auth_headers, monkeypatch):
    _enable(monkeypatch, "x")
    _enable(monkeypatch, "threads")
    headers, _ = auth_headers
    due_id = _connect(
        client, headers, "x", hours=2, access="due-access", refresh="due-refresh"
    )
    _connect(
        client, headers, "x", hours=72, access="later-access", refresh="later-refresh"
    )
    calls = []

    def fake_post(url, data=None, **kwargs):
        token = (data or {}).get("refresh_token")
        calls.append(token)
        if token != "due-refresh":
            return _Resp({"error": "server_error"}, 503)
        return _Resp(
            {
                "access_token": "refreshed-access",
                "refresh_token": "refreshed-refresh",
                "expires_in": 7200,
            }
        )

    monkeypatch.setattr("app.services.token_refresh.httpx.post", fake_post)
    db = SessionLocal()
    try:
        counts = run_token_refresh_sweep(db)
        assert "due-refresh" in calls
        assert "later-refresh" not in calls
        assert counts["refreshed"] >= 1
        row = db.get(ConnectedAccount, UUID(due_id))
        assert decrypt_token(row.refresh_token_ciphertext) == "refreshed-refresh"
    finally:
        db.close()


def test_publish_stops_when_refresh_is_permanently_rejected(
    client, auth_headers, monkeypatch
):
    from app.tasks.publish_post import publish_post_task

    _enable(monkeypatch, "x")
    headers, _ = auth_headers
    account_id = _connect(
        client, headers, "x", hours=0.01, access="x-access", refresh="x-refresh"
    )
    created = client.post(
        "/api/v1/posts",
        headers=headers,
        json={
            "connected_account_id": account_id,
            "content": "Due now",
            "media_urls": [],
            "scheduled_at": (
                datetime.now(timezone.utc) + timedelta(minutes=30)
            ).isoformat(),
            "idempotency_key": uuid4().hex,
            "post_metadata": {"format": "Post"},
        },
    )
    assert created.status_code == 200, created.text
    post_id = created.json()["id"]
    calls = []
    monkeypatch.setattr(
        "app.tasks.publish_post.publish",
        lambda *args, **kwargs: calls.append(1),
    )
    _patch_post(
        monkeypatch, {"error": "invalid_grant", "error_description": "revoked"}, 400
    )
    result = publish_post_task.run(post_id)
    assert result["status"] == "failed"
    assert calls == []
    db, account = _open(account_id)
    try:
        post = db.get(ScheduledPost, UUID(post_id))
        assert account.needs_reconnect is True
        assert post.status == "failed"
        assert post.last_error_message == account.reconnect_reason
        assert "invalid_grant" not in (post.last_error_message or "").lower()
    finally:
        db.close()


def test_youtube_and_x_connect_request_refreshable_grants(
    client, auth_headers, monkeypatch
):
    headers, _ = auth_headers
    _enable(monkeypatch, "youtube")
    youtube = client.get("/api/v1/accounts/youtube/connect", headers=headers)
    assert youtube.status_code == 200, youtube.text
    url = youtube.json()["authorization_url"]
    assert "access_type=offline" in url
    assert "prompt=consent" in url
    _enable(monkeypatch, "x")
    x_start = client.get("/api/v1/accounts/x/connect", headers=headers)
    assert x_start.status_code == 200, x_start.text
    assert "offline.access" in x_start.json()["authorization_url"]


def test_pinterest_code_exchange_requests_a_continuous_refresh_token(monkeypatch):
    _enable(monkeypatch, "pinterest")
    captured = {}

    def fake_post(url, data=None, **kwargs):
        captured["data"] = dict(data or {})
        return _Resp(
            {
                "access_token": "pin-access",
                "refresh_token": "pin-refresh",
                "expires_in": 2592000,
            }
        )

    monkeypatch.setattr(httpx, "post", fake_post)
    payload = oauth._exchange_code(oauth._providers()["pinterest"], "code", None)
    assert captured["data"]["grant_type"] == "authorization_code"
    assert captured["data"]["continuous_refresh"] == "true"
    assert payload["refresh_token"] == "pin-refresh"


def test_facebook_long_lived_exchange_happens_before_the_token_is_returned(monkeypatch):
    _enable(monkeypatch, "facebook")
    grants = []

    def fake_post(url, data=None, **kwargs):
        grant = (data or {}).get("grant_type")
        grants.append(grant)
        if grant == "authorization_code":
            return _Resp({"access_token": "short-user", "expires_in": 3600})
        assert (data or {}).get("fb_exchange_token") == "short-user"
        return _Resp({"access_token": "long-user", "expires_in": 5183944})

    monkeypatch.setattr(httpx, "post", fake_post)
    payload = oauth._exchange_code(oauth._providers()["facebook"], "code", None)
    assert grants == ["authorization_code", "fb_exchange_token"]
    assert payload["access_token"] == "long-user"


def test_page_tokens_are_stored_without_an_expiry(client, auth_headers, monkeypatch):
    headers, _ = auth_headers
    anchor = _connect(client, headers, "x")
    user_id = _user_id(anchor)
    db = SessionLocal()
    try:
        session = create_pick_session(
            db,
            user_id,
            platform="facebook",
            access_token="long-user",
            refresh_token="user-refresh",
            token_expires_at=datetime.now(timezone.utc) + timedelta(days=50),
            scopes=["pages_show_list"],
            identity_json={"id": "user-1", "name": "Win"},
        )
        monkeypatch.setattr(
            "app.services.destinations._facebook_destinations",
            lambda token: [
                {
                    "id": "page-1",
                    "name": "Studio Page",
                    "account_type": "page",
                    "platform": "facebook",
                    "access_token": "page-token",
                }
            ],
        )
        saved = save_destinations(db, user_id, session.id, ["page-1"])
        page = saved[0]
        assert decrypt_token(page.access_token_ciphertext) == "page-token"
        assert page.refresh_token_ciphertext is None
        assert page.token_expires_at is None
        assert page.extra_metadata.get("token_lifetime") == "non_expiring"
        listed = client.get("/api/v1/accounts", headers=headers)
        body = next(item for item in listed.json() if item["id"] == str(page.id))
        assert body["connection_warning"] is None
        assert body["needs_reconnect"] is False
    finally:
        db.close()
