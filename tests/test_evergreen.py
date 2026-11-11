"""Evergreen re-shares: settings, the "best post" rule, the scheduler hook, no double posts."""

import asyncio
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models import ConnectedAccount, ScheduledPost
from app.services.evergreen import pick_best, requeue_evergreen_once


def _connect(client, headers, platform="facebook", name=None):
    response = client.post(
        "/api/v1/accounts",
        headers=headers,
        json={
            "platform": platform,
            "platform_account_id": f"acct-{uuid4().hex[:8]}",
            "account_name": name or f"Evergreen {uuid4().hex[:4]}",
            "access_token": "token-value",
            "scopes": [],
        },
    )
    assert response.status_code == 201, response.text
    return UUID(response.json()["id"])


def _published(
    account_id,
    content,
    days_ago,
    *,
    enabled=True,
    interval=30,
    extra=None,
):
    db = SessionLocal()
    try:
        account = db.get(ConnectedAccount, account_id)
        when = datetime.now(timezone.utc) - timedelta(days=days_ago)
        meta = {
            "format": "Post",
            "evergreen": {"enabled": enabled, "interval_days": interval},
        }
        meta.update(extra or {})
        post = ScheduledPost(
            user_id=account.user_id,
            connected_account_id=account.id,
            content=content,
            media_urls=[],
            scheduled_at=when,
            published_at=when,
            status="published",
            provider_post_id=f"remote-{uuid4().hex[:6]}",
            idempotency_key=uuid4().hex,
            post_metadata=meta,
        )
        db.add(post)
        db.commit()
        return post.id
    finally:
        db.close()


def _run():
    db = SessionLocal()
    try:
        return [
            (copy.id, copy.post_metadata["evergreen_source_id"])
            for copy in requeue_evergreen_once(db)
        ]
    finally:
        db.close()


def _copies(account_id):
    db = SessionLocal()
    try:
        return [
            post
            for post in db.scalars(
                select(ScheduledPost).where(
                    ScheduledPost.connected_account_id == account_id
                )
            ).all()
            if (post.post_metadata or {}).get("evergreen_source_id")
        ]
    finally:
        db.close()


def test_oldest_published_post_is_reshared_once_into_next_slot(client, auth_headers):
    headers, _ = auth_headers
    account = _connect(client, headers)
    older = _published(account, "Older evergreen", days_ago=90)
    _published(account, "Newer evergreen", days_ago=45)
    _published(account, "Too recent", days_ago=5)
    _published(account, "Turned off", days_ago=200, enabled=False)

    created = _run()
    mine = [source for _, source in created if source in {str(older)}]
    assert mine == [str(older)]
    copies = _copies(account)
    assert len(copies) == 1
    copy = copies[0]
    assert copy.status == "scheduled"
    assert copy.content == "Older evergreen"
    assert copy.provider_post_id is None
    assert "evergreen" not in copy.post_metadata
    assert copy.post_metadata["format"] == "Post"
    scheduled = copy.scheduled_at.replace(tzinfo=timezone.utc)
    assert (
        datetime.now(timezone.utc)
        < scheduled
        <= datetime.now(timezone.utc) + timedelta(hours=24)
    )
    assert copy.idempotency_key.startswith(f"evergreen:{older}:")

    # A re-share is already waiting for this channel: the next passes add nothing.
    _run()
    _run()
    assert len(_copies(account)) == 1


def test_engagement_data_wins_over_age_when_present(client, auth_headers):
    headers, _ = auth_headers
    account = _connect(client, headers)
    _published(account, "Oldest, quiet", days_ago=120, extra={"metrics": {"likes": 2}})
    popular = _published(
        account, "Popular", days_ago=40, extra={"metrics": {"likes": 50, "shares": 9}}
    )
    _run()
    copies = _copies(account)
    assert [c.post_metadata["evergreen_source_id"] for c in copies] == [str(popular)]


def test_pick_best_rule_without_engagement_prefers_oldest():
    now = datetime.now(timezone.utc)
    a = ScheduledPost(id=uuid4(), post_metadata={})
    b = ScheduledPost(id=uuid4(), post_metadata={})
    assert (
        pick_best([(a, now - timedelta(days=40)), (b, now - timedelta(days=80))]) is b
    )
    c = ScheduledPost(id=uuid4(), post_metadata={"engagement": 3})
    assert (
        pick_best([(b, now - timedelta(days=80)), (c, now - timedelta(days=31))]) is c
    )
    assert pick_best([]) is None


def test_published_reshare_resets_the_interval_and_failed_reshare_waits(
    client, auth_headers
):
    headers, _ = auth_headers
    account = _connect(client, headers)
    source = _published(account, "Recycled", days_ago=60, interval=30)
    _run()
    (copy,) = _copies(account)
    db = SessionLocal()
    try:
        row = db.get(ScheduledPost, copy.id)
        row.status = "published"
        row.published_at = datetime.now(timezone.utc) - timedelta(days=1)
        row.provider_post_id = "remote-copy"
        db.commit()
    finally:
        db.close()
    _run()
    assert len(_copies(account)) == 1, (
        "published 1 day ago, interval 30: not eligible yet"
    )

    other = _connect(client, headers)
    failing = _published(other, "Will fail", days_ago=60)
    _run()
    (failed_copy,) = _copies(other)
    db = SessionLocal()
    try:
        row = db.get(ScheduledPost, failed_copy.id)
        row.status = "failed"
        db.commit()
    finally:
        db.close()
    _run()
    assert len(_copies(other)) == 1, "a failed re-share is not retried automatically"
    assert source and failing


def test_inactive_channel_is_skipped(client, auth_headers):
    headers, _ = auth_headers
    account = _connect(client, headers)
    _published(account, "Paused channel", days_ago=60)
    db = SessionLocal()
    try:
        db.get(ConnectedAccount, account).is_active = False
        db.commit()
    finally:
        db.close()
    _run()
    assert _copies(account) == []


def test_api_turns_evergreen_on_and_lists_state(client, auth_headers):
    headers, _ = auth_headers
    account = _connect(client, headers)
    post_id = _published(account, "Via the API", days_ago=20, enabled=False)
    listed = client.get("/api/v1/publish/evergreen", headers=headers)
    assert listed.status_code == 200
    row = next(item for item in listed.json() if item["post_id"] == str(post_id))
    assert row["enabled"] is False
    assert row["next_eligible_at"] is not None

    updated = client.put(
        f"/api/v1/publish/evergreen/{post_id}",
        headers=headers,
        json={"enabled": True, "interval_days": 14, "timezone": "Asia/Bangkok"},
    )
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert body["enabled"] is True and body["interval_days"] == 14

    bad = client.put(
        f"/api/v1/publish/evergreen/{post_id}",
        headers=headers,
        json={"enabled": True, "interval_days": 0},
    )
    assert bad.status_code == 422

    _run()
    (copy,) = _copies(account)
    refused = client.put(
        f"/api/v1/publish/evergreen/{copy.id}",
        headers=headers,
        json={"enabled": True, "interval_days": 14},
    )
    assert refused.status_code == 409
    assert "original post" in refused.json()["detail"]

    after = client.get("/api/v1/publish/evergreen", headers=headers).json()
    assert all(item["post_id"] != str(copy.id) for item in after)
    row = next(item for item in after if item["post_id"] == str(post_id))
    assert row["reshare_scheduled_at"] is not None


def test_two_schedulers_cannot_create_the_same_reshare(
    client, auth_headers, monkeypatch
):
    """Both passes see an empty queue; the unique key lets only one copy through."""
    headers, _ = auth_headers
    account = _connect(client, headers)
    _published(account, "Race", days_ago=60)
    first, second = SessionLocal(), SessionLocal()
    try:
        from app.services import evergreen

        real = evergreen._copies_by_source
        snapshot = real(first)  # taken before either pass writes anything
        monkeypatch.setattr(
            evergreen, "_copies_by_source", lambda db, user_id=None: snapshot
        )
        requeue_evergreen_once(first)
        requeue_evergreen_once(second)
    finally:
        first.close()
        second.close()
    assert len(_copies(account)) == 1


def test_scheduler_loop_runs_the_evergreen_pass(monkeypatch):
    from app.tasks import evergreen as evergreen_task
    from app.tasks import inprocess_scheduler

    calls = []
    monkeypatch.setattr(
        inprocess_scheduler, "run_due_posts_once", lambda: calls.append("due")
    )
    monkeypatch.setattr(
        evergreen_task, "run_evergreen_once", lambda: calls.append("evergreen")
    )
    monkeypatch.setattr(inprocess_scheduler, "poll_seconds", lambda: 2.0)

    async def run():
        stop = asyncio.Event()
        task = asyncio.create_task(inprocess_scheduler.scheduler_loop(stop))
        await asyncio.sleep(0.2)
        stop.set()
        await task

    asyncio.run(run())
    assert calls[:2] == ["due", "evergreen"]


def test_celery_beat_has_the_evergreen_job():
    from app.tasks.celery_app import celery_app

    entry = celery_app.conf.beat_schedule["requeue-evergreen"]
    assert entry["task"] == "app.tasks.evergreen.requeue_evergreen"
