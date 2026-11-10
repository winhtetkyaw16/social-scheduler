"""Due posts publish from the in-process background scheduler, never from GET /posts."""

import time
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from app.db.session import SessionLocal
from app.integrations.base import ProviderPublishResult
from app.models import ScheduledPost


def _connect_x(client, headers):
    response = client.post(
        "/api/v1/accounts",
        headers=headers,
        json={
            "platform": "x",
            "platform_account_id": f"acct-{uuid4().hex[:8]}",
            "account_name": "Brand",
            "access_token": "token-value",
            "scopes": ["tweet.write"],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create(client, headers, account_id, when):
    created = client.post(
        "/api/v1/posts",
        headers=headers,
        json={
            "connected_account_id": account_id,
            "content": "Background publish",
            "media_urls": [],
            "scheduled_at": when.isoformat(),
            "idempotency_key": uuid4().hex,
            "post_metadata": {"format": "Post"},
        },
    )
    assert created.status_code == 200, created.text
    return created.json()["id"]


def _make_due(post_id):
    db = SessionLocal()
    try:
        post = db.get(ScheduledPost, UUID(post_id))
        post.scheduled_at = datetime.now(timezone.utc) - timedelta(seconds=5)
        db.commit()
    finally:
        db.close()


def _status(post_id):
    db = SessionLocal()
    try:
        return db.get(ScheduledPost, UUID(post_id)).status
    finally:
        db.close()


def _stub(monkeypatch):
    calls = []

    def fake_publish(*args, **kwargs):
        calls.append(1)
        return ProviderPublishResult(
            post_id=f"prov-{uuid4().hex[:6]}", request_id="req", status_code=200
        )

    monkeypatch.setattr("app.tasks.publish_post.publish", fake_publish)
    monkeypatch.setattr(
        "app.tasks.publish_post.publish_post_task.apply_async", lambda *a, **k: None
    )
    return calls


def test_list_posts_has_no_publish_side_effect(client, auth_headers, monkeypatch):
    headers, _ = auth_headers
    calls = _stub(monkeypatch)
    account = _connect_x(client, headers)
    post_id = _create(
        client, headers, account["id"], datetime.now(timezone.utc) + timedelta(hours=1)
    )
    _make_due(post_id)
    listed = client.get("/api/v1/posts", headers=headers)
    assert listed.status_code == 200
    assert listed.headers.get("cache-control") == "no-store"
    assert _status(post_id) == "scheduled"
    assert calls == []


def test_run_due_posts_once_publishes_exactly_once(client, auth_headers, monkeypatch):
    from app.tasks.inprocess_scheduler import run_due_posts_once

    headers, _ = auth_headers
    calls = _stub(monkeypatch)
    account = _connect_x(client, headers)
    post_id = _create(
        client, headers, account["id"], datetime.now(timezone.utc) + timedelta(hours=1)
    )
    _make_due(post_id)
    run_due_posts_once(use_celery=False)
    assert _status(post_id) == "published"
    after_first = len(calls)
    assert after_first >= 1
    run_due_posts_once(use_celery=False)
    assert len(calls) == after_first  # already published: never sent twice


def test_background_loop_publishes_without_client_requests(auth_headers, monkeypatch):
    from app.main import app

    monkeypatch.setenv("INPROCESS_SCHEDULER", "inprocess")
    monkeypatch.setenv("INPROCESS_SCHEDULER_SECONDS", "2")
    calls = _stub(monkeypatch)
    with TestClient(app) as client:
        headers, _ = auth_headers
        account = _connect_x(client, headers)
        post_id = _create(
            client,
            headers,
            account["id"],
            datetime.now(timezone.utc) + timedelta(hours=1),
        )
        _make_due(post_id)
        deadline = time.time() + 10
        while time.time() < deadline and _status(post_id) != "published":
            time.sleep(0.3)  # no HTTP requests: only the lifespan loop can publish
    assert _status(post_id) == "published"
    assert len(calls) >= 1


def test_index_html_not_cached(client):
    response = client.get("/")
    if response.status_code == 200:
        assert "no-cache" in response.headers.get("cache-control", "")
