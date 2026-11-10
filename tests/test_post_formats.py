"""Format routing, limits, and draft hand-off. HTTP is mocked; nothing is posted to a network."""

import struct
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import httpx
import pytest

from app.core.exceptions import ProviderConfigurationError
from app.integrations.base import ProviderPublishResult
from app.integrations.platforms.facebook import FacebookPlatform
from app.integrations.platforms.instagram import InstagramPlatform
from app.integrations.platforms.pinterest import PinterestPlatform
from app.integrations.platforms.tiktok import TikTokPlatform
from app.integrations.platforms.youtube import YouTubePlatform
from app.services.media_probe import MediaFacts, inspect_media
from app.services.post_formats import publish_problem
from app.services.publishing import PublishingError, publish


class _Resp:
    def __init__(self, payload=None, status_code=200, headers=None):
        self._payload = payload if payload is not None else {}
        self.status_code = status_code
        self.headers = headers or {}
        self.is_error = status_code >= 400
        self.text = ""
        self.content = b""

    def json(self):
        return self._payload


def _box(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I4s", 8 + len(payload), kind) + payload


def _mp4(duration: float, width: int, height: int, timescale: int = 1000) -> bytes:
    mvhd = (
        bytes(4)
        + b"\x00" * 8
        + struct.pack(">II", timescale, int(duration * timescale))
    )
    tkhd = bytearray(96)
    struct.pack_into(">II", tkhd, 76, width << 16, height << 16)
    trak = _box(b"trak", _box(b"tkhd", bytes(tkhd)))
    return _box(b"moov", _box(b"mvhd", mvhd) + trak)


def _later():
    return (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()


def _connect(client, headers, platform):
    response = client.post(
        "/api/v1/accounts",
        headers=headers,
        json={
            "platform": platform,
            "platform_account_id": f"acct-{uuid4().hex[:8]}",
            "account_name": f"My {platform}",
            "access_token": "token",
            "scopes": [],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def quiet_queue(monkeypatch):
    monkeypatch.setattr(
        "app.tasks.publish_post.publish_post_task.apply_async", lambda *a, **k: None
    )
    monkeypatch.setattr(
        "app.api.v1.endpoints.posts.enqueue_immediate_publish", lambda *a, **k: None
    )


def test_removed_formats_are_rejected_and_missing_format_does_not_fail_open():
    assert "Community" in publish_problem(
        "youtube", ["https://cdn.example.com/a.mp4"], "hi", "Post"
    )
    assert "Content Posting" in publish_problem(
        "tiktok", ["https://cdn.example.com/a.jpg"], "hi", "Story"
    )
    assert "no saved format" in publish_problem(
        "facebook", ["https://cdn.example.com/a.jpg"], "hi", None
    )
    assert "no saved format" in publish_problem(
        "instagram", ["https://cdn.example.com/a.jpg"], "hi", "  "
    )
    assert "not available" in publish_problem(
        "threads", ["https://cdn.example.com/a.jpg"], "hi", "Story"
    )


def test_format_limits_use_local_facts_and_ignore_remote_duration(monkeypatch):
    facts = {
        "ok.mp4": MediaFacts(
            duration=3, width=1080, height=1920, fps=30, size_bytes=1000
        ),
        "edge.mp4": MediaFacts(
            duration=90, width=540, height=960, fps=60, size_bytes=1000
        ),
        "short.mp4": MediaFacts(
            duration=2.5, width=1080, height=1920, fps=30, size_bytes=1000
        ),
        "long.mp4": MediaFacts(
            duration=90.2, width=1080, height=1920, fps=30, size_bytes=1000
        ),
        "wide.mp4": MediaFacts(
            duration=10, width=1920, height=1080, fps=30, size_bytes=1000
        ),
        "tiny.mp4": MediaFacts(
            duration=10, width=480, height=854, fps=30, size_bytes=1000
        ),
        "fps.mp4": MediaFacts(
            duration=10, width=1080, height=1920, fps=20, size_bytes=1000
        ),
        "story60.mp4": MediaFacts(
            duration=60, width=1080, height=1920, fps=30, size_bytes=1000
        ),
        "story61.mp4": MediaFacts(
            duration=61, width=1080, height=1920, fps=30, size_bytes=1000
        ),
        "ig3.mp4": MediaFacts(
            duration=3, width=1080, height=1920, fps=30, size_bytes=1000
        ),
        "ig60.mp4": MediaFacts(
            duration=60, width=1080, height=1920, fps=30, size_bytes=1000
        ),
        "ig61.mp4": MediaFacts(
            duration=61, width=1080, height=1920, fps=30, size_bytes=1000
        ),
        "reel15.mp4": MediaFacts(
            duration=900, width=1080, height=1920, fps=30, size_bytes=1000
        ),
        "reel15x.mp4": MediaFacts(
            duration=901, width=1080, height=1920, fps=30, size_bytes=1000
        ),
        "pin4.mp4": MediaFacts(
            duration=4, width=1080, height=1920, fps=30, size_bytes=1000
        ),
        "pin5.mp4": MediaFacts(
            duration=300, width=1080, height=1920, fps=30, size_bytes=1000
        ),
        "pin3.mp4": MediaFacts(
            duration=3.5, width=1080, height=1920, fps=30, size_bytes=1000
        ),
        "pin6.mp4": MediaFacts(
            duration=301, width=1080, height=1920, fps=30, size_bytes=1000
        ),
        "yt180.mp4": MediaFacts(
            duration=180, width=1080, height=1080, fps=30, size_bytes=1000
        ),
        "yt181.mp4": MediaFacts(
            duration=181, width=1080, height=1920, fps=30, size_bytes=1000
        ),
        "ytwide.mp4": MediaFacts(
            duration=20, width=1920, height=1080, fps=30, size_bytes=1000
        ),
    }

    def fake(url):
        return facts.get(url.rsplit("/", 1)[-1])

    monkeypatch.setattr("app.services.post_formats.inspect_media", fake)
    video = lambda name: [f"https://cdn.example.com/{name}"]  # noqa: E731
    assert publish_problem("facebook", video("ok.mp4"), "hi", "Reel / Video") is None
    assert publish_problem("facebook", video("edge.mp4"), "hi", "Reel / Video") is None
    assert "3 to 90" in publish_problem(
        "facebook", video("short.mp4"), "hi", "Reel / Video"
    )
    assert "3 to 90" in publish_problem(
        "facebook", video("long.mp4"), "hi", "Reel / Video"
    )
    assert "9:16" in publish_problem(
        "facebook", video("wide.mp4"), "hi", "Reel / Video"
    )
    assert "540" in publish_problem("facebook", video("tiny.mp4"), "hi", "Reel / Video")
    assert "frames per second" in publish_problem(
        "facebook", video("fps.mp4"), "hi", "Reel / Video"
    )
    assert publish_problem("facebook", video("story60.mp4"), "hi", "Story") is None
    assert "60" in publish_problem("facebook", video("story61.mp4"), "hi", "Story")
    assert "not a mix" in publish_problem(
        "facebook",
        ["https://cdn.example.com/a.mp4", "https://cdn.example.com/b.jpg"],
        "hi",
        "Reel / Video",
    )
    assert "include a video" in publish_problem(
        "facebook", ["https://cdn.example.com/only.jpg"], "hi", "Reel / Video"
    )
    assert publish_problem("instagram", video("ig3.mp4"), "hi", "Story") is None
    assert publish_problem("instagram", video("ig60.mp4"), "hi", "Story") is None
    assert "60" in publish_problem("instagram", video("ig61.mp4"), "hi", "Story")
    assert "one photo or one video" in publish_problem(
        "instagram", video("ig3.mp4") + ["https://cdn.example.com/b.jpg"], "hi", "Story"
    )
    assert (
        publish_problem("instagram", video("reel15.mp4"), "hi", "Reel / Video") is None
    )
    assert "15 minutes" in publish_problem(
        "instagram", video("reel15x.mp4"), "hi", "Reel / Video"
    )
    assert "exactly one video" in publish_problem(
        "instagram", video("reel15.mp4") + video("ok.mp4"), "hi", "Reel / Video"
    )
    assert (
        publish_problem(
            "pinterest",
            ["https://cdn.example.com/pin4.mp4", "https://cdn.example.com/cover.jpg"],
            "hi",
            "Reel / Video",
        )
        is None
    )
    assert (
        publish_problem(
            "pinterest",
            ["https://cdn.example.com/pin5.mp4", "https://cdn.example.com/cover.jpg"],
            "hi",
            "Reel / Video",
        )
        is None
    )
    assert "4 seconds" in publish_problem(
        "pinterest",
        ["https://cdn.example.com/pin3.mp4", "https://cdn.example.com/cover.jpg"],
        "hi",
        "Reel / Video",
    )
    assert "5 minutes" in publish_problem(
        "pinterest",
        ["https://cdn.example.com/pin6.mp4", "https://cdn.example.com/cover.jpg"],
        "hi",
        "Reel / Video",
    )
    assert "cover image" in publish_problem(
        "pinterest", video("pin4.mp4"), "hi", "Reel / Video"
    )
    assert publish_problem("youtube", video("yt180.mp4"), "hi", "Short") is None
    assert "3 minutes" in publish_problem("youtube", video("yt181.mp4"), "hi", "Short")
    assert "square or vertical" in publish_problem(
        "youtube", video("ytwide.mp4"), "hi", "Short"
    )
    # Remote files are not downloaded to measure them.
    assert (
        publish_problem(
            "facebook",
            ["https://cdn.example.com/remote-only.mp4"],
            "hi",
            "Reel / Video",
        )
        is None
    )
    assert "no API flag" in publish_problem(
        "youtube", ["https://cdn.example.com/remote-only.mp4"], "hi", "Short"
    )


def test_probe_does_not_fetch_urls_and_survives_missing_ffprobe(monkeypatch, tmp_path):
    def boom(*_args, **_kwargs):
        raise AssertionError("format probing must not make an HTTP request")

    monkeypatch.setattr(httpx, "get", boom)
    monkeypatch.setattr(httpx, "request", boom)
    assert inspect_media("http://169.254.169.254/latest/meta-data") is None
    assert inspect_media("https://cdn.example.com/clip.mp4") is None

    path = tmp_path / "clip.mp4"
    path.write_bytes(_mp4(5, 1080, 1920))
    monkeypatch.setattr("app.services.media_probe.local_upload_path", lambda url: path)

    def missing(*_args, **_kwargs):
        raise FileNotFoundError("ffprobe")

    monkeypatch.setattr("app.services.media_probe.subprocess.run", missing)
    facts = inspect_media("/static/uploads/clip.mp4")
    assert facts.duration == pytest.approx(5)
    assert (facts.width, facts.height) == (1080, 1920)


def test_facebook_reel_and_stories_use_their_edges(monkeypatch):
    calls = []

    def fake(method, url, **kwargs):
        calls.append((method, url, kwargs.get("json"), kwargs.get("headers")))
        if (
            url.endswith("/video_reels")
            and (kwargs.get("json") or {}).get("upload_phase") == "start"
        ):
            return _Resp(
                {
                    "video_id": "vid9",
                    "upload_url": "https://rupload.facebook.com/video-upload/v21.0/vid9",
                }
            )
        if "rupload.facebook.com" in url:
            return _Resp({"success": True})
        if url.endswith("/video_reels"):
            return _Resp({"success": True, "post_id": "page_reel"})
        if url.endswith("/photos"):
            return _Resp({"id": "ph1"})
        if url.endswith("/photo_stories"):
            return _Resp({"success": True, "post_id": "story_photo"})
        if (
            url.endswith("/video_stories")
            and (kwargs.get("json") or {}).get("upload_phase") == "start"
        ):
            return _Resp(
                {
                    "video_id": "sv1",
                    "upload_url": "https://rupload.facebook.com/video-upload/v21.0/sv1",
                }
            )
        if url.endswith("/video_stories"):
            return _Resp({"success": True, "post_id": "story_video"})
        if url.endswith("/videos"):
            return _Resp({"id": "page_video"})
        return _Resp({"id": "feed"})

    monkeypatch.setattr(httpx, "request", fake)
    monkeypatch.setenv("FACEBOOK_GRAPH_API_VERSION", "v21.0")
    reel = FacebookPlatform().publish(
        "page-token",
        "111",
        "Watch",
        ["https://cdn.example.com/v.mp4"],
        format="Reel / Video",
    )
    assert reel.post_id == "page_reel"
    assert calls[0][1].endswith("/111/video_reels") and calls[0][2] == {
        "upload_phase": "start"
    }
    assert calls[1][1] == "https://rupload.facebook.com/video-upload/v21.0/vid9"
    assert calls[1][3]["Authorization"] == "OAuth page-token"
    assert calls[1][3]["file_url"] == "https://cdn.example.com/v.mp4"
    assert (
        calls[2][2]["video_state"] == "PUBLISHED" and calls[2][2]["video_id"] == "vid9"
    )
    assert not any(url.endswith("/videos") for _m, url, _b, _h in calls)

    calls.clear()
    photo = FacebookPlatform().publish(
        "page-token", "111", "Hi", ["https://cdn.example.com/a.jpg"], format="Story"
    )
    assert photo.post_id == "story_photo"
    assert calls[0][2] == {"url": "https://cdn.example.com/a.jpg", "published": False}
    assert calls[1][1].endswith("/photo_stories") and calls[1][2] == {"photo_id": "ph1"}
    assert not any(url.endswith("/feed") for _m, url, _b, _h in calls)

    calls.clear()
    video = FacebookPlatform().publish(
        "page-token", "111", "Hi", ["https://cdn.example.com/v.mp4"], format="Story"
    )
    assert video.post_id == "story_video"
    assert calls[0][1].endswith("/video_stories")
    assert "video_state" not in (calls[2][2] or {})
    assert not any(url.endswith("/videos") for _m, url, _b, _h in calls)

    calls.clear()
    page = FacebookPlatform().publish(
        "page-token", "111", "Watch", ["https://cdn.example.com/v.mp4"], format="Post"
    )
    assert page.post_id == "page_video"
    assert calls[0][1].endswith("/videos")


def test_instagram_story_and_reel_do_not_fall_back(monkeypatch):
    calls = []

    def fake(method, url, **kwargs):
        calls.append((method, url, kwargs.get("json")))
        if method == "GET":
            return _Resp({"status_code": "FINISHED"})
        if url.endswith("/media"):
            return _Resp({"id": f"c{len(calls)}"})
        return _Resp({"id": "ig-post"})

    monkeypatch.setattr(httpx, "request", fake)
    monkeypatch.setattr("app.integrations.platforms.instagram._sleep", lambda _s: None)
    story = InstagramPlatform().publish(
        "tok", "1789", "cap", ["https://cdn.example.com/a.jpg"], format="Story"
    )
    assert story.post_id == "ig-post"
    assert calls[0][2] == {
        "media_type": "STORIES",
        "image_url": "https://cdn.example.com/a.jpg",
    }
    assert "share_to_feed" not in calls[0][2]
    calls.clear()
    InstagramPlatform().publish(
        "tok",
        "1789",
        "cap",
        ["https://cdn.example.com/clip.mp4"],
        format="Reel / Video",
    )
    assert calls[0][2]["media_type"] == "REELS" and calls[0][2]["share_to_feed"] is True
    calls.clear()
    with pytest.raises(ProviderConfigurationError, match="exactly one video"):
        InstagramPlatform().publish(
            "tok",
            "1789",
            "cap",
            ["https://cdn.example.com/a.mp4", "https://cdn.example.com/b.mp4"],
            format="Reel / Video",
        )
    assert calls == []
    InstagramPlatform().publish(
        "tok",
        "1789",
        "cap",
        ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
        format="Post",
    )
    assert calls[2][2]["media_type"] == "CAROUSEL"


def test_pinterest_video_pin_uploads_then_creates_with_cover(monkeypatch):
    calls = []

    def fake(method, url, **kwargs):
        calls.append(
            (method, url, kwargs.get("json"), kwargs.get("data"), kwargs.get("files"))
        )
        if method == "POST" and url.endswith("/v5/media"):
            return _Resp(
                {
                    "media_id": "m1",
                    "upload_url": "https://s3.example/upload",
                    "upload_parameters": {"key": "obj", "policy": "abc"},
                }
            )
        if url == "https://s3.example/upload":
            return _Resp({"ok": True})
        if method == "GET" and url.endswith("/v5/media/m1"):
            return _Resp({"media_id": "m1", "status": "succeeded"})
        if url.endswith("/v5/pins"):
            return _Resp({"id": "pin-vid"}, 201)
        raise AssertionError(url)

    monkeypatch.setattr(httpx, "request", fake)
    monkeypatch.setattr(
        "app.integrations.platforms.pinterest._video_bytes",
        lambda url: (b"mp4-bytes", "video/mp4"),
    )
    result = PinterestPlatform().publish(
        "tok",
        "board-1",
        "A clip",
        ["https://cdn.example.com/clip.mp4", "https://cdn.example.com/cover.jpg"],
        format="Reel / Video",
    )
    assert result.post_id == "pin-vid"
    assert calls[0][2] == {"media_type": "video"}
    assert calls[1][3]["key"] == "obj" and calls[1][4]["file"][1] == b"mp4-bytes"
    source = calls[3][2]["media_source"]
    assert source == {
        "source_type": "video_id",
        "media_id": "m1",
        "cover_image_url": "https://cdn.example.com/cover.jpg",
    }
    calls.clear()
    with pytest.raises(ProviderConfigurationError, match="cover image"):
        PinterestPlatform().publish(
            "tok",
            "board-1",
            "A clip",
            ["https://cdn.example.com/clip.mp4"],
            format="Reel / Video",
        )
    assert calls == []


def test_youtube_short_uploads_without_a_shorts_flag_and_refuses_a_landscape_file(
    monkeypatch,
):
    sent = {}

    def fake_post(url, **kwargs):
        sent["json"] = kwargs.get("json")
        sent["url"] = url
        return _Resp(
            status_code=200, headers={"Location": "https://upload.example/session"}
        )

    def fake_put(url, **kwargs):
        sent["put"] = url
        return _Resp({"id": "yt1"})

    monkeypatch.setattr(
        "app.integrations.platforms.youtube._load_video_bytes",
        lambda url: (_mp4(20, 1080, 1920), "video/mp4"),
    )
    monkeypatch.setattr("app.integrations.platforms.youtube.httpx.post", fake_post)
    monkeypatch.setattr("app.integrations.platforms.youtube.httpx.put", fake_put)
    monkeypatch.setattr(
        "app.services.media_probe.subprocess.run",
        lambda *a, **k: (_ for _ in ()).throw(FileNotFoundError()),
    )
    result = YouTubePlatform().publish(
        "tok", "UC1", "Hello short", ["https://cdn.example.com/v.mp4"], format="Short"
    )
    assert result.post_id == "yt1"
    assert set(sent["json"]) == {"snippet", "status"}
    assert "Shorts" not in sent["json"]["snippet"]["title"]
    assert "publishAt" not in sent["json"]["status"]
    assert sent["url"].startswith("https://www.googleapis.com/upload/youtube/v3/videos")

    monkeypatch.setattr(
        "app.integrations.platforms.youtube._load_video_bytes",
        lambda url: (_mp4(20, 1920, 1080), "video/mp4"),
    )
    sent.clear()
    with pytest.raises(ProviderConfigurationError, match="no API flag"):
        YouTubePlatform().publish(
            "tok", "UC1", "Wide", ["https://cdn.example.com/v.mp4"], format="Short"
        )
    assert "json" not in sent
    with pytest.raises(ProviderConfigurationError, match="Community"):
        YouTubePlatform().publish(
            "tok", "UC1", "Hello", ["https://cdn.example.com/v.mp4"], format="Post"
        )
    assert "json" not in sent


def test_tiktok_story_makes_no_request(monkeypatch):
    def boom(*_args, **_kwargs):
        raise AssertionError("TikTok Story must not call the API")

    monkeypatch.setattr("app.integrations.platforms.tiktok.httpx.post", boom)
    with pytest.raises(ProviderConfigurationError, match="Content Posting"):
        TikTokPlatform().publish(
            "tok", "open", "hi", ["https://cdn.example.com/a.mp4"], format="Story"
        )


def test_publish_service_refuses_a_missing_format_before_the_adapter(monkeypatch):
    def boom(*_args, **_kwargs):
        raise AssertionError("adapter should not run")

    monkeypatch.setattr("app.services.publishing.get_platform", boom)
    with pytest.raises(PublishingError, match="no saved format"):
        publish("facebook", "tok", "1", "hi", ["https://cdn.example.com/a.jpg"])


def test_create_blocks_a_missing_format_and_a_draft_may_stay_incomplete(
    client, auth_headers, quiet_queue
):
    headers, _user = auth_headers
    account = _connect(client, headers, "facebook")
    created = client.post(
        "/api/v1/posts",
        headers=headers,
        json={
            "connected_account_id": account["id"],
            "content": "Hello",
            "media_urls": ["https://cdn.example.com/a.jpg"],
            "scheduled_at": _later(),
            "idempotency_key": uuid4().hex,
            "post_metadata": {},
        },
    )
    assert created.status_code == 422, created.text
    assert "no saved format" in created.text
    draft = client.post(
        "/api/v1/publish/drafts",
        headers=headers,
        json={
            "content": "Hello",
            "media_urls": ["https://cdn.example.com/a.jpg"],
            "post_format": "",
            "metadata": {
                "caption": "Hello",
                "selectedIds": [account["id"]],
                "sharedMediaUrls": ["https://cdn.example.com/a.jpg"],
            },
        },
    )
    assert draft.status_code == 201, draft.text
    scheduled = client.post(
        f"/api/v1/publish/drafts/{draft.json()['id']}/schedule",
        headers=headers,
        json={"scheduled_at": _later()},
    )
    assert scheduled.status_code == 422, scheduled.text
    assert "no saved format" in scheduled.text


def test_draft_does_not_copy_a_format_onto_another_network(
    client, auth_headers, quiet_queue
):
    headers, _user = auth_headers
    facebook = _connect(client, headers, "facebook")
    instagram = _connect(client, headers, "instagram")
    draft = client.post(
        "/api/v1/publish/drafts",
        headers=headers,
        json={
            "content": "Hello",
            "media_urls": ["https://cdn.example.com/a.jpg"],
            "post_format": "Story",
            "metadata": {
                "caption": "Hello",
                "selectedIds": [facebook["id"], instagram["id"]],
                "sharedMediaUrls": ["https://cdn.example.com/a.jpg"],
                "formatsByAccount": {facebook["id"]: "Story"},
            },
        },
    )
    assert draft.status_code == 201, draft.text
    scheduled = client.post(
        f"/api/v1/publish/drafts/{draft.json()['id']}/schedule",
        headers=headers,
        json={"scheduled_at": _later()},
    )
    assert scheduled.status_code == 422, scheduled.text
    assert "not copied" in scheduled.text
    posts = client.get("/api/v1/posts", headers=headers).json()
    assert posts == []
    # The account that does have a saved format can still be scheduled on its own.
    alone = client.post(
        "/api/v1/publish/drafts",
        headers=headers,
        json={
            "content": "Hello",
            "media_urls": ["https://cdn.example.com/a.jpg"],
            "post_format": "Story",
            "metadata": {
                "caption": "Hello",
                "selectedIds": [facebook["id"]],
                "sharedMediaUrls": ["https://cdn.example.com/a.jpg"],
            },
        },
    )
    assert alone.status_code == 201, alone.text
    ok = client.post(
        f"/api/v1/publish/drafts/{alone.json()['id']}/schedule",
        headers=headers,
        json={"scheduled_at": _later()},
    )
    assert ok.status_code == 200, ok.text
    row = client.get("/api/v1/posts", headers=headers).json()[0]
    assert row["post_metadata"]["format"] == "Story"
    assert row["connected_account_id"] == facebook["id"]


def test_dispatcher_and_worker_pass_the_saved_format(client, auth_headers, monkeypatch):
    headers, _user = auth_headers
    queued = []

    def fake_apply(args=None, kwargs=None, **extra):
        queued.append({"args": list(args or []), "kwargs": dict(kwargs or {})})

    monkeypatch.setattr(
        "app.tasks.publish_post.publish_post_task.apply_async", fake_apply
    )
    account = _connect(client, headers, "instagram")
    created = client.post(
        "/api/v1/posts",
        headers=headers,
        json={
            "connected_account_id": account["id"],
            "content": "Hello",
            "media_urls": ["https://cdn.example.com/a.jpg"],
            "scheduled_at": _later(),
            "idempotency_key": uuid4().hex,
            "post_metadata": {"format": "Story"},
        },
    )
    assert created.status_code == 200, created.text
    post_id = created.json()["id"]

    from app.db.session import SessionLocal
    from app.models import ScheduledPost
    from app.tasks.dispatch_due_posts import dispatch_due_posts
    from app.tasks.publish_post import publish_post_task

    db = SessionLocal()
    try:
        row = db.get(ScheduledPost, UUID(post_id))
        row.scheduled_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        row.status = "scheduled"
        db.commit()
    finally:
        db.close()
    assert dispatch_due_posts() >= 1
    match = next(item for item in queued if item["args"] and item["args"][0] == post_id)
    assert match["kwargs"].get("post_format") == "Story"

    seen = {}

    def fake_publish(*_args, **kwargs):
        seen.update(kwargs)
        return ProviderPublishResult(
            post_id="ig-story", request_id="r", status_code=200
        )

    monkeypatch.setattr("app.tasks.publish_post.publish", fake_publish)
    assert publish_post_task.run(post_id, post_format="Story")["status"] == "published"
    assert seen["format"] == "Story"

    # A retry of a failed row still carries the saved format into the queue.
    db = SessionLocal()
    try:
        row = db.get(ScheduledPost, UUID(post_id))
        row.status = "failed"
        row.provider_post_id = None
        db.commit()
    finally:
        db.close()
    queued.clear()
    retried = client.post(f"/api/v1/posts/{post_id}/retry", headers=headers)
    assert retried.status_code == 202, retried.text
    from app.api.v1.endpoints.posts import enqueue_immediate_publish

    enqueue_immediate_publish(post_id)
    assert queued and queued[-1]["kwargs"].get("post_format") == "Story"


def test_worker_blocks_a_row_whose_format_was_removed(
    client, auth_headers, monkeypatch
):
    headers, _user = auth_headers
    monkeypatch.setattr(
        "app.tasks.publish_post.publish_post_task.apply_async", lambda *a, **k: None
    )
    account = _connect(client, headers, "facebook")
    created = client.post(
        "/api/v1/posts",
        headers=headers,
        json={
            "connected_account_id": account["id"],
            "content": "Hello",
            "media_urls": ["https://cdn.example.com/a.jpg"],
            "scheduled_at": _later(),
            "idempotency_key": uuid4().hex,
            "post_metadata": {"format": "Post"},
        },
    )
    post_id = created.json()["id"]
    from app.db.session import SessionLocal
    from app.models import ScheduledPost
    from app.tasks.publish_post import publish_post_task

    db = SessionLocal()
    try:
        row = db.get(ScheduledPost, UUID(post_id))
        row.post_metadata = {}
        row.status = "scheduled"
        db.commit()
    finally:
        db.close()

    def boom(*_args, **_kwargs):
        raise AssertionError("missing format must not reach the adapter")

    monkeypatch.setattr("app.tasks.publish_post.publish", boom)
    result = publish_post_task.run(post_id, post_format="Post")
    assert result["status"] == "failed"
    db = SessionLocal()
    try:
        row = db.get(ScheduledPost, UUID(post_id))
        assert row.status == "failed"
        assert "no saved format" in (row.last_error_message or "")
    finally:
        db.close()
