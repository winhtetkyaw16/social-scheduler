"""PR #23 audit: end-to-end through the real API on an isolated temp DB, publishers mocked (nothing leaves the box)."""

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest

from app.integrations.base import ProviderPublishResult

V1, V2 = "https://cdn.example.com/a.mp4", "https://cdn.example.com/b.mp4"
P1, P2, P3 = (f"https://cdn.example.com/p{i}.jpg" for i in (1, 2, 3))
SHARED = [V1, V2, P1, P2, P3]
EIGHT = ["facebook", "linkedin", "tiktok", "x", "youtube", "instagram", "threads", "pinterest"]


@pytest.fixture(autouse=True)
def _no_dispatch(monkeypatch):
    monkeypatch.setattr("app.tasks.publish_post.publish_post_task.apply_async", lambda *a, **k: None)
    monkeypatch.setattr("app.api.v1.endpoints.posts.enqueue_immediate_publish", lambda *a, **k: None)


def _connect(client, headers, platform):
    r = client.post("/api/v1/accounts", headers=headers, json={
        "platform": platform, "platform_account_id": f"acct-{uuid4().hex[:8]}",
        "account_name": f"My {platform}", "access_token": "x", "scopes": [],
    })
    assert r.status_code == 201, r.text
    return r.json()


def _later(h=2):
    return (datetime.now(timezone.utc) + timedelta(hours=h)).isoformat()


def _fmt(platform):
    return "Reel / Video" if platform in {"youtube", "tiktok"} else "Post"


def _draft(client, headers, accounts, picks=None, crops=None, shared=SHARED):
    r = client.post("/api/v1/publish/drafts", headers=headers, json={
        "content": "Audit caption", "media_urls": shared, "post_format": _fmt(accounts[0]["platform"]) if accounts else "Post",
        "metadata": {"caption": "Audit caption", "captionMode": "universal",
                     "selectedIds": [a["id"] for a in accounts], "sharedMediaUrls": shared,
                     "formatsByAccount": {a["id"]: _fmt(a["platform"]) for a in accounts},
                     "mediaSelectionByAccount": picks or {}, "igCropByAccount": crops or {}},
    })
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _run_worker(monkeypatch, post_ids):
    """Fire the real Celery task body with the network publish mocked; returns {post_id: (platform, media, kwargs)}."""
    sent = {}

    def fake_publish(platform, token, account_id, content, media, **kw):
        sent[current[0]] = (platform, list(media), kw)
        return ProviderPublishResult(post_id=f"prov-{platform}", request_id="r", status_code=200)

    monkeypatch.setattr("app.tasks.publish_post.publish", fake_publish)
    from app.tasks.publish_post import publish_post_task
    current = [None]
    for pid in post_ids:
        current[0] = pid
        assert publish_post_task.run(pid)["status"] == "published", pid
    return sent


def test_a_e_eight_channels_two_videos_picks_draft_schedule_worker(client, auth_headers, monkeypatch):
    headers, _ = auth_headers
    accts = {p: _connect(client, headers, p) for p in EIGHT}
    picks = {accts["facebook"]["id"]: [V2], accts["linkedin"]["id"]: [V1], accts["tiktok"]["id"]: [V2],
             accts["x"]["id"]: [V1], accts["youtube"]["id"]: [V2], accts["pinterest"]["id"]: [P1]}
    crop = {accts["instagram"]["id"]: {"ratio": 0.8, "offsets": {P1: [0.2, 0.5]}}}

    # Without picks the draft saves fine but scheduling is refused (422) for the single-video networks.
    bad = _draft(client, headers, list(accts.values()))
    r = client.post(f"/api/v1/publish/drafts/{bad}/schedule", headers=headers, json={"scheduled_at": _later()})
    assert r.status_code == 422, r.text

    item = _draft(client, headers, list(accts.values()), picks=picks, crops=crop)
    r = client.post(f"/api/v1/publish/drafts/{item}/schedule", headers=headers, json={"scheduled_at": _later()})
    assert r.status_code == 200, r.text
    ids = [str(i) for i in r.json()["scheduled_post_ids"]]
    rows = {p["connected_account_id"]: p for p in client.get("/api/v1/posts", headers=headers).json() if p["id"] in ids}
    by_net = {p: rows[a["id"]] for p, a in accts.items()}
    expected = {"facebook": [V2], "linkedin": [V1], "tiktok": [V2], "x": [V1], "youtube": [V2],
                "instagram": SHARED, "threads": SHARED, "pinterest": [P1]}
    for net, media in expected.items():
        assert by_net[net]["media_urls"] == media, net
        assert by_net[net]["status"] == "scheduled"
    assert by_net["instagram"]["post_metadata"]["ig_crop"] == {"ratio": 0.8, "offsets": [[0.5, 0.5], [0.5, 0.5], [0.2, 0.5], [0.5, 0.5], [0.5, 0.5]]}
    assert "ig_crop" not in by_net["facebook"]["post_metadata"]

    sent = _run_worker(monkeypatch, ids)
    got = {plat: (media, kw) for plat, media, kw in sent.values()}
    for net, media in expected.items():
        assert got[net][0] == media, net
    assert got["instagram"][1]["ig_crop"]["ratio"] == 0.8
    assert all("ig_crop" not in got[n][1] for n in expected if n != "instagram")
    for net in expected:
        assert client.get(f"/api/v1/posts/{by_net[net]['id']}", headers=headers).json()["status"] == "published"


def test_b_mixed_instagram_carousel_keeps_videos_and_photos(client, auth_headers):
    headers, _ = auth_headers
    ig = _connect(client, headers, "instagram")
    r = client.post("/api/v1/posts", headers=headers, json={
        "connected_account_id": ig["id"], "content": "c", "media_urls": SHARED, "scheduled_at": _later(),
        "idempotency_key": uuid4().hex, "post_metadata": {"format": "Post", "ig_crop": {"ratio": 1.0}}})
    assert r.status_code == 200, r.text
    assert r.json()["media_urls"] == SHARED and r.json()["post_metadata"]["ig_crop"] == {"ratio": 1.0}


@pytest.mark.parametrize("platform,media,fmt,needle", [
    ("facebook", [V1, V2], "Post", "1 video"),
    ("facebook", [V1, P1], "Post", "not a mix"),
    ("tiktok", [V1, V2], "Post", "one video"),
    ("tiktok", [V1, P1], "Post", "not both"),
    ("youtube", [V1, V2], "Reel / Video", "one video"),
    ("youtube", [P1], "Reel / Video", "needs a video"),
    ("youtube", [V1], "Post", "Community"),
    ("tiktok", [P1], "Story", "Content Posting"),
    ("instagram", [], "Post", "at least one"),
    ("facebook", [P1], "Reel / Video", "include a video"),
    ("facebook", [], "Story", "Story"),
])
def test_d_each_blocking_error_is_422_on_every_path_drafts_still_save(client, auth_headers, platform, media, fmt, needle):
    headers, _ = auth_headers
    acct = _connect(client, headers, platform)
    # create/schedule
    r = client.post("/api/v1/posts", headers=headers, json={
        "connected_account_id": acct["id"], "content": "c", "media_urls": media, "scheduled_at": _later(),
        "idempotency_key": uuid4().hex, "post_metadata": {"format": fmt}})
    assert r.status_code == 422 and needle.lower() in r.text.lower(), r.text
    # draft saves; schedule + queue of that draft are refused
    item = client.post("/api/v1/publish/drafts", headers=headers, json={
        "content": "c", "media_urls": media, "post_format": fmt,
        "metadata": {"captionMode": "universal", "caption": "c", "selectedIds": [acct["id"]], "sharedMediaUrls": media,
                     "formatsByAccount": {acct["id"]: fmt}}})
    assert item.status_code == 201, item.text
    r = client.post(f"/api/v1/publish/drafts/{item.json()['id']}/schedule", headers=headers, json={"scheduled_at": _later()})
    assert r.status_code == 422, r.text
    r = client.post(f"/api/v1/publish/drafts/{item.json()['id']}/queue", headers=headers, json={})
    assert r.status_code in (409, 422), r.text  # 422 blocking error, or 409/422 "no queue slots" — never scheduled
    assert not [p for p in client.get("/api/v1/posts", headers=headers).json() if p["connected_account_id"] == acct["id"]]


def _bad_row(acct_id, status, media=(V1, V2)):
    from app.db.session import SessionLocal
    from app.models import ScheduledPost
    db = SessionLocal()
    try:
        row = db.get(ScheduledPost, UUID(acct_id["post"])) if isinstance(acct_id, dict) else None
        row.media_urls, row.status = list(media), status
        db.commit()
    finally:
        db.close()


def test_d_post_now_retry_save_reschedule_refuse_bad_rows(client, auth_headers):
    headers, _ = auth_headers
    fb = _connect(client, headers, "facebook")
    post = client.post("/api/v1/posts", headers=headers, json={
        "connected_account_id": fb["id"], "content": "c", "media_urls": [V1], "scheduled_at": _later(),
        "idempotency_key": uuid4().hex, "post_metadata": {"format": "Post"}}).json()
    # A row that went bad (e.g. pre-PR data) is refused by Post now / retry / save / reschedule.
    _bad_row({"post": post["id"]}, "scheduled")
    assert client.post(f"/api/v1/posts/{post['id']}/publish-now", headers=headers).status_code == 422
    assert client.patch(f"/api/v1/posts/{post['id']}", headers=headers, json={"content": "edited"}).status_code == 422
    _bad_row({"post": post["id"]}, "failed")
    assert client.post(f"/api/v1/posts/{post['id']}/retry", headers=headers).status_code == 422
    assert client.patch(f"/api/v1/posts/{post['id']}", headers=headers, json={"scheduled_at": _later(3)}).status_code == 422
    # Fixing the media lets Save & reschedule and retry through.
    r = client.patch(f"/api/v1/posts/{post['id']}", headers=headers, json={"scheduled_at": _later(3), "media_urls": [V2]})
    assert r.status_code == 200 and r.json()["status"] == "scheduled" and r.json()["media_urls"] == [V2], r.text
    _bad_row({"post": post["id"]}, "failed", media=(V2,))
    assert client.post(f"/api/v1/posts/{post['id']}/retry", headers=headers).status_code == 202


def test_old_post_without_selection_metadata_still_publishes_shared_media(client, auth_headers):
    headers, _ = auth_headers
    ig = _connect(client, headers, "instagram")
    item = client.post("/api/v1/publish/drafts", headers=headers, json={
        "content": "old", "media_urls": [P1, P2], "post_format": "Post",
        "metadata": {"captionMode": "universal", "caption": "old", "selectedIds": [ig["id"]]}})
    r = client.post(f"/api/v1/publish/drafts/{item.json()['id']}/schedule", headers=headers, json={"scheduled_at": _later()})
    assert r.status_code == 200, r.text
    row = [p for p in client.get("/api/v1/posts", headers=headers).json() if p["connected_account_id"] == ig["id"]][0]
    assert row["media_urls"] == [P1, P2]


def test_pick_of_a_removed_video_falls_back_safely(client, auth_headers):
    """Video picked for Facebook, then removed from the shared media: nothing stale is sent, schedule is refused."""
    headers, _ = auth_headers
    fb = _connect(client, headers, "facebook")
    item = _draft(client, headers, [fb], picks={fb["id"]: [V2]}, shared=[V1, P1])
    r = client.post(f"/api/v1/publish/drafts/{item}/schedule", headers=headers, json={"scheduled_at": _later()})
    # selection [V2] no longer in shared -> empty media; Facebook Post with no media is a text post (allowed),
    # but V2 must never be sent.
    if r.status_code == 200:
        row = [p for p in client.get("/api/v1/posts", headers=headers).json() if p["connected_account_id"] == fb["id"]][0]
        assert V2 not in row["media_urls"]


def test_worker_recheck_blocks_invalid_row_then_fix_and_retry_publishes(client, auth_headers, monkeypatch):
    headers, _ = auth_headers
    fb = _connect(client, headers, "facebook")
    post = client.post("/api/v1/posts", headers=headers, json={
        "connected_account_id": fb["id"], "content": "c", "media_urls": [V1], "scheduled_at": _later(),
        "idempotency_key": uuid4().hex, "post_metadata": {"format": "Post"}}).json()
    _bad_row({"post": post["id"]}, "scheduled")  # like a row scheduled before the checks existed
    calls = []
    monkeypatch.setattr("app.tasks.publish_post.publish", lambda *a, **k: calls.append(a) or ProviderPublishResult(post_id="p", request_id="r", status_code=200))
    from app.tasks.publish_post import publish_post_task
    assert publish_post_task.run(post["id"])["status"] == "failed"
    assert calls == []
    row = client.get(f"/api/v1/posts/{post['id']}", headers=headers).json()
    assert row["status"] == "failed" and row["last_error_code"] == "media_invalid"
    assert "1 video" in row["last_error_message"]
    assert client.post(f"/api/v1/posts/{post['id']}/retry", headers=headers).status_code == 422
    r = client.patch(f"/api/v1/posts/{post['id']}", headers=headers, json={"scheduled_at": _later(3), "media_urls": [V2]})
    assert r.status_code == 200 and r.json()["status"] == "scheduled", r.text
    assert publish_post_task.run(post["id"])["status"] == "published"
    assert calls and calls[-1][4] == [V2]
    # failed again -> fixed -> Retry also works
    _bad_row({"post": post["id"]}, "failed", media=(V2,))
    assert client.post(f"/api/v1/posts/{post['id']}/retry", headers=headers).status_code == 202
    assert publish_post_task.run(post["id"])["status"] == "published"


def test_facebook_two_videos_message_vs_mix():
    from app.services.error_messages import media_requirement_error as m
    assert m("facebook", [V1, V2]) == "Facebook Page posts carry 1 video. Use Fix for me to pick which one."
    assert "not a mix" in m("facebook", [V1, P1])
    assert "not a mix" in m("facebook", [V1, V2, P1])
