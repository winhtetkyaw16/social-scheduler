"""Failed posts expose friendly copy and can be edited + rescheduled."""

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from app.db.session import SessionLocal
from app.models.scheduled_post import ScheduledPost


def test_failed_post_friendly_error_and_reschedule(client, auth_headers, monkeypatch):
    headers, _ = auth_headers
    monkeypatch.setattr(
        "app.tasks.publish_post.publish_post_task.apply_async", lambda *a, **k: None
    )
    account = client.post(
        "/api/v1/accounts",
        headers=headers,
        json={
            "platform": "x",
            "platform_account_id": f"acct-{uuid4().hex[:8]}",
            "account_name": "Brand",
            "access_token": "token-value",
            "scopes": ["tweet.write"],
        },
    ).json()
    created = client.post(
        "/api/v1/posts",
        headers=headers,
        json={
            "connected_account_id": account["id"],
            "content": "Hello",
            "media_urls": [],
            "scheduled_at": (
                datetime.now(timezone.utc) + timedelta(days=1)
            ).isoformat(),
            "idempotency_key": uuid4().hex,
            "post_metadata": {"format": "Post"},
        },
    ).json()
    with SessionLocal() as db:
        row = db.get(ScheduledPost, UUID(created["id"]))
        row.status, row.attempt_count = "failed", 1
        row.last_error_code = "provider_http_error"
        row.last_error_message = (
            "Provider returned HTTP 402: Payment Required | credits depleted"
        )
        db.commit()

    got = client.get(f"/api/v1/posts/{created['id']}", headers=headers).json()
    assert got["friendly_error"]["category"] == "x_credits_depleted"
    assert (
        got["friendly_error"]["banner"]
        == "X API has no credits: add credits in the X developer console to post."
    )

    new_time = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    patched = client.patch(
        f"/api/v1/posts/{created['id']}",
        headers=headers,
        json={"scheduled_at": new_time, "content": "Hello again"},
    )
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert body["status"] == "scheduled"
    assert body["content"] == "Hello again"
    assert body["friendly_error"] is None
