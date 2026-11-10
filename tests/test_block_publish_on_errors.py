"""Posting is blocked server-side while a blocking error remains; drafts can still be saved."""

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest

PHOTO = "https://cdn.example.com/photo.jpg"
VIDEO = "https://cdn.example.com/clip.mp4"


@pytest.fixture(autouse=True)
def _no_celery(monkeypatch):
    monkeypatch.setattr(
        "app.tasks.publish_post.publish_post_task.apply_async", lambda *a, **k: None
    )
    monkeypatch.setattr(
        "app.api.v1.endpoints.posts.enqueue_immediate_publish", lambda *a, **k: None
    )


def _connect(client, headers, platform="facebook"):
    r = client.post(
        "/api/v1/accounts",
        headers=headers,
        json={
            "platform": platform,
            "platform_account_id": f"acct-{uuid4().hex[:8]}",
            "account_name": f"My {platform}",
            "access_token": "x",
            "scopes": [],
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def _later():
    return (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()


def _create(client, headers, account, media, fmt="Post"):
    return client.post(
        "/api/v1/posts",
        headers=headers,
        json={
            "connected_account_id": account["id"],
            "content": "Hello",
            "media_urls": media,
            "scheduled_at": _later(),
            "idempotency_key": uuid4().hex,
            "post_metadata": {"format": fmt},
        },
    )


def test_schedule_video_format_without_video_is_rejected(client, auth_headers):
    headers, _ = auth_headers
    account = _connect(client, headers)
    r = _create(client, headers, account, [PHOTO], fmt="Reel / Video")
    assert r.status_code == 422, r.text
    assert "include a video" in r.text and "My facebook" in r.text
    assert (
        _create(client, headers, account, [VIDEO], fmt="Reel / Video").status_code
        == 200
    )


def test_reschedule_into_an_error_is_rejected_and_not_saved(client, auth_headers):
    headers, _ = auth_headers
    account = _connect(client, headers)
    post = _create(client, headers, account, [PHOTO]).json()
    r = client.patch(
        f"/api/v1/posts/{post['id']}",
        headers=headers,
        json={"scheduled_at": _later(), "post_metadata": {"format": "Reel / Video"}},
    )
    assert r.status_code == 422, r.text
    again = client.get(f"/api/v1/posts/{post['id']}", headers=headers).json()
    assert again["post_metadata"].get("format") == "Post"


def test_publish_now_rejects_a_post_with_errors(client, auth_headers):
    from app.db.session import SessionLocal
    from app.models import ScheduledPost

    headers, _ = auth_headers
    account = _connect(client, headers)
    post = _create(client, headers, account, [PHOTO]).json()
    with SessionLocal() as db:  # simulate a post that went bad after scheduling
        row = db.get(ScheduledPost, UUID(post["id"]))
        row.post_metadata = {**(row.post_metadata or {}), "format": "Reel / Video"}
        db.commit()
    r = client.post(f"/api/v1/posts/{post['id']}/publish-now", headers=headers)
    assert r.status_code == 422, r.text
    assert "include a video" in r.text
    assert (
        client.get(f"/api/v1/posts/{post['id']}", headers=headers).json()["status"]
        == "scheduled"
    )


def test_drafts_with_errors_are_allowed_but_cannot_be_scheduled(client, auth_headers):
    headers, _ = auth_headers
    account = _connect(client, headers)
    draft = client.post(
        "/api/v1/publish/drafts",
        headers=headers,
        json={
            "content": "Hello",
            "media_urls": [PHOTO],
            "post_format": "Reel / Video",
            "scheduled_at": _later(),
            "metadata": {
                "caption": "Hello",
                "captionMode": "universal",
                "selectedIds": [account["id"]],
                "scheduleMode": "schedule",
                "sharedMediaUrls": [PHOTO],
                "format": "Reel / Video",
            },
        },
    )
    assert draft.status_code == 201, draft.text
    item_id = draft.json()["id"]
    assert (
        client.patch(
            f"/api/v1/publish/drafts/{item_id}",
            headers=headers,
            json={"content": "Edited"},
        ).status_code
        == 200
    )
    r = client.post(
        f"/api/v1/publish/drafts/{item_id}/schedule",
        headers=headers,
        json={"scheduled_at": _later()},
    )
    assert r.status_code == 422, r.text
    assert "include a video" in r.text
