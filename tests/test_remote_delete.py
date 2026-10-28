"""Remote-first delete for published posts (fail closed)."""

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import httpx

from app.db.session import SessionLocal
from app.models import ScheduledPost


def _connect(client, headers, *, platform="facebook", account_type="page"):
    response = client.post(
        "/api/v1/accounts",
        headers=headers,
        json={
            "platform": platform,
            "platform_account_id": f"acct-{uuid4().hex[:8]}",
            "account_name": f"{platform} page",
            "account_type": account_type,
            "access_token": "token-value",
            "scopes": ["pages_manage_posts"],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _schedule_and_mark_published(client, headers, account, *, provider_post_id="fb_post_1"):
    scheduled_at = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    created = client.post(
        "/api/v1/posts",
        headers=headers,
        json={
            "connected_account_id": account["id"],
            "content": "Hello remote delete",
            "media_urls": [],
            "scheduled_at": scheduled_at,
            "idempotency_key": uuid4().hex,
            "post_metadata": {},
        },
    )
    assert created.status_code == 200, created.text
    post = created.json()
    db = SessionLocal()
    try:
        row = db.get(ScheduledPost, UUID(post["id"]))
        assert row is not None
        row.status = "published"
        row.provider_post_id = provider_post_id
        row.published_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()
    return post["id"]


def test_delete_published_calls_remote_then_local(client, auth_headers, monkeypatch):
    headers, _ = auth_headers
    monkeypatch.setattr("app.tasks.publish_post.publish_post_task.apply_async", lambda *a, **k: None)
    account = _connect(client, headers)
    post_id = _schedule_and_mark_published(client, headers, account)
    seen = {}

    def fake_request(method, url, **kwargs):
        seen["method"] = method
        seen["url"] = url
        class R:
            status_code = 200
            is_error = False
        return R()

    monkeypatch.setattr(httpx, "request", fake_request)
    response = client.delete(f"/api/v1/posts/{post_id}", headers=headers)
    assert response.status_code == 204, response.text
    assert seen.get("method") == "DELETE"
    assert "graph.facebook.com" in seen.get("url", "")
    assert client.get(f"/api/v1/posts/{post_id}", headers=headers).status_code == 404


def test_delete_keeps_local_when_remote_fails(client, auth_headers, monkeypatch):
    headers, _ = auth_headers
    monkeypatch.setattr("app.tasks.publish_post.publish_post_task.apply_async", lambda *a, **k: None)
    account = _connect(client, headers)
    post_id = _schedule_and_mark_published(client, headers, account, provider_post_id="fb_keep_me")

    def fake_request(method, url, **kwargs):
        class R:
            status_code = 500
            is_error = True
        return R()

    monkeypatch.setattr(httpx, "request", fake_request)
    response = client.delete(f"/api/v1/posts/{post_id}", headers=headers)
    assert response.status_code in {409, 502}, response.text
    detail = response.json()["detail"].lower()
    assert "kept" in detail or "failed" in detail
    assert client.get(f"/api/v1/posts/{post_id}", headers=headers).status_code == 200


def test_delete_without_provider_id_is_local_only(client, auth_headers, monkeypatch):
    headers, _ = auth_headers
    monkeypatch.setattr("app.tasks.publish_post.publish_post_task.apply_async", lambda *a, **k: None)
    account = _connect(client, headers)
    scheduled_at = (datetime.now(timezone.utc) + timedelta(days=4)).isoformat()
    created = client.post(
        "/api/v1/posts",
        headers=headers,
        json={
            "connected_account_id": account["id"],
            "content": "Never sent",
            "media_urls": [],
            "scheduled_at": scheduled_at,
            "idempotency_key": uuid4().hex,
            "post_metadata": {},
        },
    )
    assert created.status_code == 200, created.text
    post_id = created.json()["id"]
    called = {"n": 0}

    def fake_request(method, url, **kwargs):
        called["n"] += 1
        class R:
            status_code = 200
            is_error = False
        return R()

    monkeypatch.setattr(httpx, "request", fake_request)
    response = client.delete(f"/api/v1/posts/{post_id}", headers=headers)
    assert response.status_code == 204, response.text
    assert called["n"] == 0


def test_delete_tiktok_published_fails_closed(client, auth_headers, monkeypatch):
    headers, _ = auth_headers
    monkeypatch.setattr("app.tasks.publish_post.publish_post_task.apply_async", lambda *a, **k: None)
    account = _connect(client, headers, platform="tiktok", account_type="user")
    post_id = _schedule_and_mark_published(client, headers, account, provider_post_id="tt_1")
    response = client.delete(f"/api/v1/posts/{post_id}", headers=headers)
    assert response.status_code == 409, response.text
    assert "not supported" in response.json()["detail"].lower()
    assert client.get(f"/api/v1/posts/{post_id}", headers=headers).status_code == 200
