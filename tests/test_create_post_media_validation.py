"""POST /api/v1/posts rejects media a channel can't publish, before anything is queued."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest


def _connect(client, headers, platform):
    r = client.post("/api/v1/accounts", headers=headers, json={
        "platform": platform, "platform_account_id": f"acct-{uuid4().hex[:8]}",
        "account_name": f"My {platform}", "access_token": "token-value", "scopes": [],
    })
    assert r.status_code == 201, r.text
    return r.json()


def _create(client, headers, account, media):
    return client.post("/api/v1/posts", headers=headers, json={
        "connected_account_id": account["id"], "content": "Hello", "media_urls": media,
        "scheduled_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
        "idempotency_key": uuid4().hex, "post_metadata": {},
    })


@pytest.mark.parametrize("platform,media,needle", [
    ("youtube", ["https://cdn.example.com/photo.jpg"], "YouTube needs exactly one video"),
    ("tiktok", ["https://cdn.example.com/photo.jpg"], "TikTok needs exactly one video"),
    ("linkedin", ["https://cdn.example.com/clip.mp4", "https://cdn.example.com/photo.jpg"], "not a mix of photos and videos"),
])
def test_create_post_rejects_unpublishable_media(client, auth_headers, monkeypatch, platform, media, needle):
    headers, _ = auth_headers
    monkeypatch.setattr("app.tasks.publish_post.publish_post_task.apply_async", lambda *a, **k: None)
    account = _connect(client, headers, platform)
    r = _create(client, headers, account, media)
    assert r.status_code == 422, r.text
    assert needle in r.text and f"My {platform}" in r.text


def test_create_post_accepts_video_for_youtube(client, auth_headers, monkeypatch):
    headers, _ = auth_headers
    monkeypatch.setattr("app.tasks.publish_post.publish_post_task.apply_async", lambda *a, **k: None)
    account = _connect(client, headers, "youtube")
    r = _create(client, headers, account, ["https://cdn.example.com/clip.mp4"])
    assert r.status_code == 200, r.text
