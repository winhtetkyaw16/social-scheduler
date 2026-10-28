"""Double-enqueue must not call the provider twice for one scheduled post."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.integrations.base import ProviderPublishResult


def _connect_x(client, headers, account_name="Brand"):
    response = client.post(
        "/api/v1/accounts",
        headers=headers,
        json={
            "platform": "x",
            "platform_account_id": f"acct-{uuid4().hex[:8]}",
            "account_name": account_name,
            "access_token": "token-value",
            "scopes": ["tweet.write"],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_duplicate_publish_task_calls_provider_once(client, auth_headers, monkeypatch):
    headers, _tokens = auth_headers
    monkeypatch.setattr("app.tasks.publish_post.publish_post_task.apply_async", lambda *args, **kwargs: None)
    publish_calls = []

    def fake_publish(*args, **kwargs):
        publish_calls.append(1)
        return ProviderPublishResult(post_id=f"prov-{len(publish_calls)}", request_id="req", status_code=200)

    monkeypatch.setattr("app.tasks.publish_post.publish", fake_publish)
    account = _connect_x(client, headers)
    scheduled_at = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
    created = client.post(
        "/api/v1/posts",
        headers=headers,
        json={
            "connected_account_id": account["id"],
            "content": "Only once",
            "media_urls": [],
            "scheduled_at": scheduled_at,
            "idempotency_key": uuid4().hex,
            "post_metadata": {"scheduleMode": "now"},
        },
    )
    assert created.status_code == 200, created.text
    post_id = created.json()["id"]

    from app.tasks.publish_post import publish_post_task

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: publish_post_task.run(post_id), range(2)))

    assert len(publish_calls) == 1, f"provider called {len(publish_calls)} times; results={results}"
    statuses = {result["status"] for result in results}
    assert "published" in statuses
    assert statuses <= {"published", "skipped"}

    confirmed = client.get(f"/api/v1/posts/{post_id}", headers=headers)
    assert confirmed.status_code == 200
    body = confirmed.json()
    assert body["status"] == "published"
    assert body["provider_post_id"] == "prov-1"


def test_list_posts_reconciles_provider_id_with_scheduled_status(client, auth_headers, monkeypatch):
    headers, _tokens = auth_headers
    monkeypatch.setattr("app.tasks.publish_post.publish_post_task.apply_async", lambda *args, **kwargs: None)
    account = _connect_x(client, headers, account_name="Reconcile")
    scheduled_at = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    created = client.post(
        "/api/v1/posts",
        headers=headers,
        json={
            "connected_account_id": account["id"],
            "content": "Needs reconcile",
            "media_urls": [],
            "scheduled_at": scheduled_at,
            "idempotency_key": uuid4().hex,
            "post_metadata": {},
        },
    )
    assert created.status_code == 200, created.text
    post_id = created.json()["id"]
    assert created.json()["status"] == "scheduled"

    from app.db.session import SessionLocal
    from app.models import ScheduledPost
    from sqlalchemy import select
    from uuid import UUID

    db = SessionLocal()
    try:
        post = db.scalar(select(ScheduledPost).where(ScheduledPost.id == UUID(post_id)))
        post.provider_post_id = "graph-already-there"
        post.status = "scheduled"
        db.commit()
    finally:
        db.close()

    listed = client.get("/api/v1/posts", headers=headers)
    assert listed.status_code == 200
    row = next(item for item in listed.json() if item["id"] == post_id)
    assert row["status"] == "published"
    assert row["provider_post_id"] == "graph-already-there"
