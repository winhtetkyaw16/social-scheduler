"""Scheduling stays unpublished until dispatch and a mocked provider confirm it."""

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


def test_schedule_does_not_mark_published_and_dispatch_is_mocked(client, auth_headers, monkeypatch):
    headers, _tokens = auth_headers
    queued = []

    def fake_apply_async(args=None, **kwargs):
        queued.append(list(args or []))

    monkeypatch.setattr("app.tasks.publish_post.publish_post_task.apply_async", fake_apply_async)
    account = _connect_x(client, headers)
    scheduled_at = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    created = client.post(
        "/api/v1/posts",
        headers=headers,
        json={
            "connected_account_id": account["id"],
            "content": "Ship the scheduler",
            "media_urls": [],
            "scheduled_at": scheduled_at,
            "idempotency_key": uuid4().hex,
            "post_metadata": {},
        },
    )
    assert created.status_code == 200, created.text
    post = created.json()
    # Due / Post-now rows flip to queued before the worker finishes so the UI
    # never looks "still scheduled" while Graph is already running.
    assert post["status"] == "queued"
    assert post["provider_post_id"] is None
    assert post["post_metadata"].get("analytics", {}).get("source") != "simulated"
    assert queued, "a due post should be handed to the worker without publishing inline"

    listed = client.get("/api/v1/posts", headers=headers)
    assert listed.status_code == 200
    visible = next(item for item in listed.json() if item["id"] == post["id"])
    assert visible["status"] in {"queued", "scheduled", "publishing", "published"}
    assert visible["provider_post_id"] is None
    assert "simulated" not in listed.text

    # Create already enqueued the due post; beat reclaim is for stale queued only.
    assert str(post["id"]) in {call[0] for call in queued}

    from app.db.session import SessionLocal
    from app.models import ScheduledPost
    from sqlalchemy import select
    from uuid import UUID
    from app.tasks.dispatch_due_posts import dispatch_due_posts

    db = SessionLocal()
    try:
        row = db.scalar(select(ScheduledPost).where(ScheduledPost.id == UUID(post["id"])))
        row.status = "scheduled"
        db.commit()
    finally:
        db.close()

    before = len(queued)
    dispatched = dispatch_due_posts()
    assert dispatched >= 1
    assert len(queued) >= before + 1
    assert str(post["id"]) in {call[0] for call in queued[before:]}

    monkeypatch.setattr(
        "app.tasks.publish_post.publish",
        lambda *args, **kwargs: ProviderPublishResult(post_id="provider-123", request_id="req-1", status_code=201),
    )
    from app.tasks.publish_post import publish_post_task

    result = publish_post_task.run(post["id"])
    assert result["status"] == "published"
    assert result["provider_post_id"] == "provider-123"

    confirmed = client.get(f"/api/v1/posts/{post['id']}", headers=headers)
    assert confirmed.status_code == 200
    body = confirmed.json()
    assert body["status"] == "published"
    assert body["provider_post_id"] == "provider-123"
    assert body["latest_execution_outcome"] == "succeeded"
    assert body["post_metadata"].get("analytics", {}).get("source") != "simulated"


def test_approved_draft_creates_scheduled_posts(client, auth_headers, monkeypatch):
    headers, _tokens = auth_headers
    monkeypatch.setattr("app.tasks.publish_post.publish_post_task.apply_async", lambda *args, **kwargs: None)
    account = _connect_x(client, headers, account_name="Approval brand")
    scheduled_at = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    draft = client.post(
        "/api/v1/publish/drafts",
        headers=headers,
        json={
            "content": "Approved caption",
            "media_urls": ["https://cdn.example.com/photo.jpg"],
            "post_format": "Post",
            "scheduled_at": scheduled_at,
            "metadata": {
                "caption": "Approved caption",
                "captionMode": "universal",
                "selectedIds": [account["id"]],
                "scheduleMode": "schedule",
                "sharedMediaUrls": ["https://cdn.example.com/photo.jpg"],
            },
        },
    )
    assert draft.status_code == 201, draft.text
    item_id = draft.json()["id"]
    submitted = client.post(f"/api/v1/publish/drafts/{item_id}/submit", headers=headers)
    assert submitted.status_code == 200, submitted.text
    decision = client.post(
        f"/api/v1/publish/approvals/{item_id}/decision",
        headers=headers,
        json={"decision": "approved"},
    )
    assert decision.status_code == 200, decision.text
    assert decision.json()["status"] == "approved"

    posts = client.get("/api/v1/posts", headers=headers)
    assert posts.status_code == 200
    created = [item for item in posts.json() if item["connected_account_id"] == account["id"]]
    assert len(created) == 1
    assert created[0]["status"] == "scheduled"
    assert created[0]["content"] == "Approved caption"
    assert created[0]["provider_post_id"] is None
    assert created[0]["media_urls"] == ["https://cdn.example.com/photo.jpg"]
