"""X photo/GIF/video publishing with mocked HTTP (no live X calls)."""

import base64
import struct

import httpx
import pytest

from app.core.exceptions import ProviderConfigurationError
from app.integrations.base import ProviderHTTPError
from app.integrations.platforms import x as xmod
from app.integrations.platforms.x import (
    CHUNK_BYTES,
    XPlatform,
    mp4_video_size,
    x_media_problem,
)
from app.services.error_messages import (
    classify_error,
    friendly_error,
    media_requirement_error,
)
from app.services.oauth import _providers


class _Resp:
    def __init__(self, payload=None, status_code=200, headers=None):
        self._payload = payload or {}
        self.status_code = status_code
        self.headers = headers or {}
        self.is_error = status_code >= 400
        self.text = ""

    def json(self):
        return self._payload


def _png(w=100, h=80, pad=0):
    return (
        b"\x89PNG\r\n\x1a\n"
        + struct.pack(">I4sII", 13, b"IHDR", w, h)
        + b"\x00" * (5 + pad)
    )


def _gif(w=320, h=240, pad=0):
    return b"GIF89a" + struct.pack("<HH", w, h) + b"\x00" * (10 + pad)


def _mp4(seconds=10.0, size=100_000, w=1280, h=720):
    mvhd = (
        bytes([0, 0, 0, 0])
        + b"\x00" * 8
        + struct.pack(">II", 1000, int(seconds * 1000))
        + b"\x00" * 80
    )
    mvhd_box = struct.pack(">I4s", 8 + len(mvhd), b"mvhd") + mvhd
    tkhd = b"\x00" * 76 + struct.pack(">II", w << 16, h << 16)
    tkhd_box = struct.pack(">I4s", 8 + len(tkhd), b"tkhd") + tkhd
    trak = struct.pack(">I4s", 8 + len(tkhd_box), b"trak") + tkhd_box
    moov = struct.pack(">I4s", 8 + len(mvhd_box) + len(trak), b"moov") + mvhd_box + trak
    ftyp = struct.pack(">I4s", 16, b"ftyp") + b"isom\x00\x00\x00\x00"
    body = ftyp + moov
    return (
        body
        + struct.pack(">I4s", 8 + max(0, size - len(body) - 8), b"mdat")
        + b"\x00" * max(0, size - len(body) - 8)
    )


@pytest.fixture
def env(monkeypatch, tmp_path):
    slept = []
    monkeypatch.setattr(xmod, "_sleep", lambda s: slept.append(s))
    paths = {}

    def add(name, data):
        p = tmp_path / name
        p.write_bytes(data)
        paths[name] = p
        return f"/static/uploads/{name}"

    monkeypatch.setattr(
        xmod, "local_upload_path", lambda url: paths.get(str(url).rsplit("/", 1)[-1])
    )
    return {"slept": slept, "add": add}


def _fake(
    calls,
    *,
    statuses=("succeeded",),
    tweet_status=201,
    upload_status=200,
    upload_body=None,
):
    statuses = list(statuses)
    state = {"n": 0}

    def fake(method, url, **kw):
        calls.append((method, url, kw))
        if url == "https://api.x.com/2/tweets":
            if tweet_status >= 400:
                return _Resp(
                    {
                        "title": "Payment Required",
                        "detail": "Your enrolled account does not have any credits.",
                        "type": "https://api.x.com/2/problems/credits-depleted",
                    },
                    tweet_status,
                )
            return _Resp(
                {"data": {"id": "1999", "text": kw["json"]["text"]}},
                201,
                {"x-transaction-id": "tx-1"},
            )
        if upload_status >= 400:
            return _Resp(
                upload_body
                or {"title": "Forbidden", "detail": "Forbidden", "type": "about:blank"},
                upload_status,
            )
        if url == "https://api.x.com/2/media/upload" and method == "POST":
            state["n"] += 1
            return _Resp(
                {"data": {"id": f"IMG{state['n']}", "media_key": f"3_IMG{state['n']}"}}
            )
        if url.endswith("/media/upload/initialize"):
            return _Resp(
                {
                    "data": {
                        "id": "VID1",
                        "media_key": "7_VID1",
                        "expires_after_secs": 86400,
                    }
                }
            )
        if url.endswith("/append"):
            return _Resp({}, 204)
        if url.endswith("/finalize"):
            return _Resp(
                {
                    "data": {
                        "id": "VID1",
                        "processing_info": {"state": "pending", "check_after_secs": 2},
                    }
                }
            )
        if method == "GET" and url == "https://api.x.com/2/media/upload":
            st = statuses.pop(0) if len(statuses) > 1 else statuses[0]
            info = {"state": st, "check_after_secs": 3}
            if st == "failed":
                info["error"] = {
                    "code": 1,
                    "name": "InvalidMedia",
                    "message": "Unsupported video codec",
                }
            return _Resp({"data": {"id": "VID1", "processing_info": info}})
        raise AssertionError(f"unexpected {method} {url}")

    return fake


def test_scope_includes_media_write():
    assert "media.write" in _providers()["x"].scopes


def test_text_only_unchanged(monkeypatch, env):
    calls = []
    monkeypatch.setattr(httpx, "request", _fake(calls))
    result = XPlatform().publish("tok", "u1", "hello", [])
    assert result.post_id == "1999"
    assert calls[0][2]["json"] == {"text": "hello"}


def test_image_upload_then_post(monkeypatch, env):
    calls = []
    monkeypatch.setattr(httpx, "request", _fake(calls))
    img = _png()
    url = env["add"]("a.png", img)
    result = XPlatform().publish("tok", "u1", "pic", [url])
    assert result.post_id == "1999" and result.request_id == "tx-1"
    method, upload_url, kw = calls[0]
    assert (method, upload_url) == ("POST", "https://api.x.com/2/media/upload")
    assert kw["json"]["media_category"] == "tweet_image"
    assert base64.b64decode(kw["json"]["media"]) == img
    assert kw["headers"]["Authorization"] == "Bearer tok"
    assert calls[-1][2]["json"] == {"text": "pic", "media": {"media_ids": ["IMG1"]}}


def test_four_images(monkeypatch, env):
    calls = []
    monkeypatch.setattr(httpx, "request", _fake(calls))
    urls = [env["add"](f"{i}.jpg", b"\xff\xd8" + b"\x00" * 50) for i in range(4)]
    XPlatform().publish("tok", "u1", "four", urls)
    assert calls[-1][2]["json"]["media"]["media_ids"] == [
        "IMG1",
        "IMG2",
        "IMG3",
        "IMG4",
    ]
    assert len([c for c in calls if c[1].endswith("/media/upload")]) == 4


def test_five_images_rejected_before_any_call(monkeypatch, env):
    calls = []
    monkeypatch.setattr(httpx, "request", _fake(calls))
    urls = [f"https://a.test/{i}.jpg" for i in range(5)]
    assert "up to 4 photos. This post has 5" in media_requirement_error("x", urls, "hi")
    with pytest.raises(ProviderConfigurationError, match="up to 4 photos"):
        XPlatform().publish("tok", "u1", "five", urls)
    assert calls == []


def test_video_chunked_flow_with_status_polling(monkeypatch, env):
    calls = []
    monkeypatch.setattr(
        httpx,
        "request",
        _fake(calls, statuses=["in_progress", "in_progress", "succeeded"]),
    )
    size = CHUNK_BYTES * 2 + 1234
    url = env["add"]("clip.mp4", _mp4(30, size))
    result = XPlatform().publish("tok", "u1", "vid", [url])
    assert result.post_id == "1999"
    init = calls[0]
    assert init[1] == "https://api.x.com/2/media/upload/initialize"
    assert init[2]["json"] == {
        "media_type": "video/mp4",
        "total_bytes": size,
        "media_category": "tweet_video",
    }
    appends = [c for c in calls if c[1].endswith("/append")]
    assert [c[1] for c in appends] == [
        "https://api.x.com/2/media/upload/VID1/append"
    ] * 3
    assert [c[2]["data"]["segment_index"] for c in appends] == ["0", "1", "2"]
    assert all(len(c[2]["files"]["media"][1]) <= 5 * 1024 * 1024 for c in appends)
    assert sum(len(c[2]["files"]["media"][1]) for c in appends) == size
    assert any(c[1].endswith("/VID1/finalize") for c in calls)
    polls = [c for c in calls if c[0] == "GET"]
    assert len(polls) == 3
    assert polls[0][2]["params"] == {"command": "STATUS", "media_id": "VID1"}
    assert env["slept"] == [2.0, 3.0, 3.0]  # follows check_after_secs
    assert calls[-1][2]["json"] == {"text": "vid", "media": {"media_ids": ["VID1"]}}


def test_video_processing_failed(monkeypatch, env):
    monkeypatch.setattr(httpx, "request", _fake([], statuses=["failed"]))
    url = env["add"]("bad.mp4", _mp4(10, 50_000))
    with pytest.raises(
        RuntimeError, match="processing failed: Unsupported video codec"
    ) as exc:
        XPlatform().publish("tok", "u1", "x", [url])
    assert (
        classify_error("provider_error", str(exc.value), "x") == "x_processing_failed"
    )


def test_video_status_timeout(monkeypatch, env):
    clock = iter([0.0] + [10_000.0] * 50)
    monkeypatch.setattr(xmod, "_clock", lambda: next(clock))
    monkeypatch.setattr(httpx, "request", _fake([], statuses=["in_progress"]))
    url = env["add"]("slow.mp4", _mp4(10, 50_000))
    with pytest.raises(RuntimeError, match="still processing"):
        XPlatform().publish("tok", "u1", "x", [url])


def test_gif_uses_chunked_tweet_gif(monkeypatch, env):
    calls = []
    monkeypatch.setattr(httpx, "request", _fake(calls))
    url = env["add"]("fun.gif", _gif())
    XPlatform().publish("tok", "u1", "gif", [url])
    assert calls[0][2]["json"]["media_type"] == "image/gif"
    assert calls[0][2]["json"]["media_category"] == "tweet_gif"


@pytest.mark.parametrize(
    "media,needle",
    [
        (
            ["https://a.test/1.mp4", "https://a.test/2.jpg"],
            "not a mix of photos and videos",
        ),
        (["https://a.test/1.mp4", "https://a.test/2.mp4"], "only one video"),
        (["https://a.test/1.gif", "https://a.test/2.jpg"], "only media on an X post"),
        (["https://a.test/1.mov"], "MP4 only"),
        (["https://a.test/1.bmp"], "JPG, PNG, GIF or WEBP"),
    ],
)
def test_validation_rejects(media, needle):
    assert needle in media_requirement_error("x", media, "hi")


def test_mix_rejected_by_api_with_422(monkeypatch):
    from app.services import posts as posts_service

    msg = media_requirement_error(
        "x", ["https://a.test/1.mp4", "https://a.test/2.jpg"], "hi"
    )
    assert msg.startswith("X posts can have up to 4 photos, or 1 video, not a mix")
    assert (
        friendly_error("provider_configuration_error", msg, "x")["category"]
        == "x_media_rules"
    )
    assert posts_service.media_requirement_error is media_requirement_error


@pytest.mark.parametrize(
    "media",
    [
        ["https://a.test/1.jpg"],
        [
            "https://a.test/1.png",
            "https://a.test/2.webp",
            "https://a.test/3.jpg",
            "https://a.test/4.jpeg",
        ],
        ["https://a.test/v.mp4"],
        ["https://a.test/a.gif"],
    ],
)
def test_validation_accepts(media):
    assert media_requirement_error("x", media, "hi") is None


def test_local_file_limits(env):
    add = env["add"]
    assert "up to 5 MB" in x_media_problem([add("big.png", _png(pad=5 * 1024 * 1024))])
    assert "up to 15 MB" in x_media_problem(
        [add("big.gif", _gif(pad=15 * 1024 * 1024))]
    )
    assert "1280x1080" in x_media_problem([add("wide.gif", _gif(2000, 500))])
    assert "0.5 seconds to 20 minutes" in x_media_problem([add("long.mp4", _mp4(1300))])
    assert "0.5 seconds to 20 minutes" in x_media_problem([add("blip.mp4", _mp4(0.2))])
    assert "1920 pixels" in x_media_problem([add("4k.mp4", _mp4(10, w=3840, h=2160))])
    assert "1:3 and 3:1" in x_media_problem([add("strip.mp4", _mp4(10, w=1800, h=400))])
    assert x_media_problem([add("ok.mp4", _mp4(10, w=720, h=1280))]) is None
    assert mp4_video_size(_mp4(5, w=640, h=360)) == (640, 360)


def test_402_credits_maps_to_clear_message(monkeypatch, env):
    monkeypatch.setattr(httpx, "request", _fake([], tweet_status=402))
    with pytest.raises(ProviderHTTPError) as exc:
        XPlatform().publish("tok", "u1", "hello", [])
    r = friendly_error("provider_http_error", str(exc.value), "x")
    assert r["category"] == "x_credits_depleted"
    assert (
        r["banner"]
        == "X API has no credits: add credits in the X developer console to post."
    )
    # Same mapping for the CreditsDepleted wording without a status code.
    assert (
        classify_error("provider_error", "CreditsDepleted", "x") == "x_credits_depleted"
    )


def test_402_on_upload_also_maps_to_credits(monkeypatch, env):
    monkeypatch.setattr(
        httpx,
        "request",
        _fake([], upload_status=402, upload_body={"title": "CreditsDepleted"}),
    )
    url = env["add"]("a.png", _png())
    with pytest.raises(ProviderHTTPError) as exc:
        XPlatform().publish("tok", "u1", "pic", [url])
    assert (
        classify_error("provider_http_error", str(exc.value), "x")
        == "x_credits_depleted"
    )


def test_missing_media_scope_403_maps_to_reconnect(monkeypatch, env):
    monkeypatch.setattr(httpx, "request", _fake([], upload_status=403))
    url = env["add"]("a.png", _png())
    with pytest.raises(ProviderHTTPError) as exc:
        XPlatform().publish("tok", "u1", "pic", [url])
    r = friendly_error("provider_http_error", str(exc.value), "x")
    assert r["category"] == "x_media_permission_missing"
    assert r["banner"] == "Reconnect X to allow media."
    assert r["actions"][0]["id"] == "reconnect"


def test_other_errors_pass_through(monkeypatch, env):
    r = friendly_error(
        "provider_http_error",
        "Provider returned HTTP 400: Invalid Request | Something odd",
        "x",
    )
    assert r["category"] == "unknown"
    assert "Something odd" in r["banner"]
