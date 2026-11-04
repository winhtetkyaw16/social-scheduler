"""LinkedIn video/image/multiImage publishing with mocked HTTP (no live LinkedIn calls)."""

import struct

import httpx
import pytest

from app.core.exceptions import ProviderConfigurationError
from app.integrations.platforms import linkedin as li
from app.integrations.platforms.linkedin import LinkedInPlatform, image_size, mp4_duration_seconds
from app.services.error_messages import friendly_error, media_requirement_error

PART = 4 * 1024 * 1024


class _Resp:
    def __init__(self, payload=None, status_code=200, headers=None):
        self._payload = payload or {}
        self.status_code = status_code
        self.headers = headers or {}
        self.is_error = status_code >= 400
        self.text = ""

    def json(self):
        return self._payload


@pytest.fixture
def env(monkeypatch):
    slept = []
    monkeypatch.setattr(li, "_sleep", lambda s: slept.append(s))
    monkeypatch.setenv("LINKEDIN_VERSION", "202610")
    return slept


def _fake(calls, *, video_statuses=None, video_size=0, images=1, put_status=200):
    statuses = list(video_statuses or ["AVAILABLE"])
    state = {"img": 0}

    def fake(method, url, **kw):
        calls.append((method, url, kw))
        if method == "PUT":
            if put_status >= 400:
                return _Resp({"message": "Upload URL expired"}, put_status)
            return _Resp(headers={"etag": f'"etag-{len([c for c in calls if c[0] == "PUT"])}"'})
        if "videos?action=initializeUpload" in url:
            parts = []
            first = 0
            while first < video_size:
                last = min(first + PART, video_size) - 1
                parts.append({"uploadUrl": f"https://www.linkedin.com/dms-uploads/v/{len(parts)}", "firstByte": first, "lastByte": last})
                first = last + 1
            return _Resp({"value": {"video": "urn:li:video:V1", "uploadToken": "tok-up", "uploadInstructions": parts}})
        if "videos?action=finalizeUpload" in url:
            return _Resp({})
        if method == "GET" and "/rest/videos/" in url:
            status = statuses.pop(0) if len(statuses) > 1 else statuses[0]
            body = {"status": status}
            if status == "PROCESSING_FAILED":
                body["processingFailureReason"] = "Unsupported codec"
            return _Resp(body)
        if "images?action=initializeUpload" in url:
            state["img"] += 1
            n = state["img"]
            return _Resp({"value": {"image": f"urn:li:image:I{n}", "uploadUrl": f"https://www.linkedin.com/dms-uploads/i/{n}"}})
        if url.endswith("/rest/posts"):
            return _Resp({}, 201, {"x-restli-id": "urn:li:share:999", "x-li-uuid": "req-1"})
        raise AssertionError(f"unexpected {method} {url}")

    return fake


def _uploads(monkeypatch, tmp_path, files):
    """Serve /static/uploads/<name> from tmp files."""
    paths = {}
    for name, data in files.items():
        p = tmp_path / name
        p.write_bytes(data)
        paths[name] = p
    monkeypatch.setattr(li, "local_upload_path", lambda url: paths.get(str(url).rsplit("/", 1)[-1]))
    return [f"/static/uploads/{n}" for n in files]


def _png(w, h):
    return b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + struct.pack(">II", w, h) + b"\x08\x02\x00\x00\x00"


def _mp4(seconds, size):
    mvhd = b"\x00" * 4 + b"\x00" * 8 + struct.pack(">II", 1000, int(seconds * 1000)) + b"\x00" * 80
    mvhd_box = struct.pack(">I4s", 8 + len(mvhd), b"mvhd") + mvhd
    moov = struct.pack(">I4s", 8 + len(mvhd_box), b"moov") + mvhd_box
    ftyp = struct.pack(">I4s", 16, b"ftyp") + b"isom\x00\x00\x00\x00"
    head = ftyp + moov
    pad = size - len(head) - 8
    return head + struct.pack(">I4s", pad + 8, b"mdat") + b"\x00" * pad


def test_video_multipart_etags_finalize_poll_and_post(monkeypatch, tmp_path, env):
    size = PART * 2 + 1234
    [url] = _uploads(monkeypatch, tmp_path, {"clip.mp4": _mp4(42, size)})
    calls = []
    monkeypatch.setattr(httpx, "request", _fake(calls, video_statuses=["PROCESSING", "PROCESSING", "AVAILABLE"], video_size=size))
    result = LinkedInPlatform().publish("tok", "urn:li:person:abc", "My video\nmore", [url])
    assert result.post_id == "urn:li:share:999"
    init = calls[0][2]["json"]["initializeUploadRequest"]
    assert init == {"owner": "urn:li:person:abc", "fileSizeBytes": size, "uploadCaptions": False, "uploadThumbnail": False}
    assert calls[0][2]["headers"]["Linkedin-Version"] == "202610"
    assert calls[0][2]["headers"]["X-Restli-Protocol-Version"] == "2.0.0"
    puts = [c for c in calls if c[0] == "PUT"]
    assert [len(c[2]["content"]) for c in puts] == [PART, PART, 1234]
    fin = [c for c in calls if "finalizeUpload" in c[1]][0][2]["json"]["finalizeUploadRequest"]
    assert fin == {"video": "urn:li:video:V1", "uploadToken": "tok-up", "uploadedPartIds": ["etag-1", "etag-2", "etag-3"]}
    polls = [c for c in calls if c[0] == "GET"]
    assert len(polls) == 3 and "urn%3Ali%3Avideo%3AV1" in polls[0][1]
    assert env == [li.VIDEO_POLL_INTERVAL] * 2
    post = calls[-1][2]["json"]
    assert post["content"] == {"media": {"id": "urn:li:video:V1", "title": "My video"}}
    assert post["visibility"] == "PUBLIC" and post["lifecycleState"] == "PUBLISHED"
    assert post["distribution"]["feedDistribution"] == "MAIN_FEED"


def test_video_processing_failed(monkeypatch, tmp_path, env):
    [url] = _uploads(monkeypatch, tmp_path, {"clip.mp4": _mp4(10, 200_000)})
    calls = []
    monkeypatch.setattr(httpx, "request", _fake(calls, video_statuses=["PROCESSING_FAILED"], video_size=200_000))
    with pytest.raises(RuntimeError, match="PROCESSING_FAILED: Unsupported codec"):
        LinkedInPlatform().publish("tok", "urn:li:person:abc", "x", [url])
    assert not any(c[1].endswith("/rest/posts") for c in calls)
    r = friendly_error("provider_error", "LinkedIn could not process the video (PROCESSING_FAILED: Unsupported codec)", "linkedin")
    assert r["category"] == "linkedin_processing_failed" and 'LinkedIn said: "' in r["what_happened"]


def test_video_poll_timeout(monkeypatch, tmp_path, env):
    [url] = _uploads(monkeypatch, tmp_path, {"clip.mp4": _mp4(10, 200_000)})
    clock = {"t": 0.0}
    monkeypatch.setattr(li, "_clock", lambda: clock["t"])
    monkeypatch.setattr(li, "_sleep", lambda s: clock.__setitem__("t", clock["t"] + s))
    monkeypatch.setenv("LINKEDIN_VIDEO_TIMEOUT_SECONDS", "20")
    monkeypatch.setattr(httpx, "request", _fake([], video_statuses=["PROCESSING"], video_size=200_000))
    with pytest.raises(RuntimeError, match="still processing"):
        LinkedInPlatform().publish("tok", "urn:li:person:abc", "x", [url])
    assert friendly_error("provider_error", "LinkedIn video still processing after 20 seconds (timed out)", "linkedin")["category"] == "timeout"


def test_single_image(monkeypatch, tmp_path, env):
    [url] = _uploads(monkeypatch, tmp_path, {"a.png": _png(1200, 627)})
    calls = []
    monkeypatch.setattr(httpx, "request", _fake(calls))
    result = LinkedInPlatform().publish("tok", "abc", "Hello", [url])
    assert result.post_id == "urn:li:share:999"
    assert calls[0][2]["json"] == {"initializeUploadRequest": {"owner": "urn:li:person:abc"}}
    assert calls[1][0] == "PUT" and calls[1][1].endswith("/i/1")
    assert calls[-1][2]["json"]["content"] == {"media": {"id": "urn:li:image:I1"}}
    assert not any(c[0] == "GET" for c in calls)


def test_multi_image(monkeypatch, tmp_path, env):
    urls = _uploads(monkeypatch, tmp_path, {f"p{i}.png": _png(800, 800) for i in range(3)})
    calls = []
    monkeypatch.setattr(httpx, "request", _fake(calls))
    LinkedInPlatform().publish("tok", "urn:li:person:abc", "Album", urls)
    images = calls[-1][2]["json"]["content"]["multiImage"]["images"]
    assert [i["id"] for i in images] == ["urn:li:image:I1", "urn:li:image:I2", "urn:li:image:I3"]
    assert len([c for c in calls if c[0] == "PUT"]) == 3


def test_upload_failure_is_friendly(monkeypatch, tmp_path, env):
    [url] = _uploads(monkeypatch, tmp_path, {"a.png": _png(10, 10)})
    monkeypatch.setattr(httpx, "request", _fake([], put_status=401))
    with pytest.raises(Exception) as exc:
        LinkedInPlatform().publish("tok", "urn:li:person:abc", "x", [url])
    r = friendly_error("provider_http_error", str(exc.value), "linkedin")
    assert r["category"] == "linkedin_upload_failed" and "LinkedIn said:" in r["what_happened"]


def test_permission_and_token_errors():
    r = friendly_error("provider_http_error", "Provider returned HTTP 403: Not enough permissions to access: partnerApiPostsExternal.CREATE", "linkedin")
    assert r["category"] == "linkedin_permission_missing" and "LinkedIn said:" in r["what_happened"]
    assert r["actions"][0]["id"] == "reconnect"
    assert friendly_error("provider_http_error", "Provider returned HTTP 401: Invalid access token", "linkedin")["category"] == "connection_expired"


@pytest.mark.parametrize("media,needle", [
    (["https://a.test/1.mp4", "https://a.test/2.jpg"], "not a mix"),
    (["https://a.test/1.mp4", "https://a.test/2.mp4"], "only one video"),
    ([f"https://a.test/{i}.jpg" for i in range(21)], "up to 20 photos"),
    (["https://a.test/1.mov"], "MP4 only"),
    (["https://a.test/1.webp"], "JPG, PNG or GIF"),
])
def test_validation_rejects(media, needle):
    problem = media_requirement_error("linkedin", media, "hi")
    assert problem and needle in problem
    with pytest.raises(ProviderConfigurationError, match=needle):
        LinkedInPlatform().publish("tok", "urn:li:person:abc", "hi", media)


@pytest.mark.parametrize("media", [
    ["https://a.test/1.mp4"], ["https://a.test/1.jpg"], ["https://a.test/1.png", "https://a.test/2.gif"],
    [f"https://a.test/{i}.jpg" for i in range(20)], [],
])
def test_validation_accepts(media):
    assert media_requirement_error("linkedin", media, "hi") is None


def test_validation_inspects_local_files(monkeypatch, tmp_path):
    files = {"short.mp4": _mp4(2, 100_000), "tiny.mp4": b"\x00" * 1000, "big.png": _png(7000, 6000), "ok.mp4": _mp4(60, 100_000)}
    _uploads(monkeypatch, tmp_path, files)
    assert "3 seconds to 30 minutes" in media_requirement_error("linkedin", ["/static/uploads/short.mp4"])
    assert "75 KB and 500 MB" in media_requirement_error("linkedin", ["/static/uploads/tiny.mp4"])
    assert "36,152,320 pixels" in media_requirement_error("linkedin", ["/static/uploads/big.png"])
    assert media_requirement_error("linkedin", ["/static/uploads/ok.mp4"]) is None
    assert media_requirement_error("x", ["https://a.test/1.jpg"]) is None


def test_parsers():
    assert mp4_duration_seconds(_mp4(42.5, 5000)) == 42.5
    assert image_size(_png(1200, 627)) == (1200, 627)
    assert image_size(b"GIF89a" + struct.pack("<HH", 30, 40)) == (30, 40)
    jpeg = b"\xff\xd8" + b"\xff\xe0" + struct.pack(">H", 4) + b"\x00\x00" + b"\xff\xc0" + struct.pack(">HBHH", 11, 8, 480, 640) + b"\x00" * 6
    assert image_size(jpeg) == (640, 480)


def test_delete_still_uses_rest_posts(monkeypatch, env):
    seen = []
    monkeypatch.setattr(httpx, "request", lambda m, url, **k: seen.append((m, url, k)) or _Resp({}, 204))
    LinkedInPlatform().delete("tok", "urn:li:share:999")
    assert seen[0][0] == "DELETE" and seen[0][1].endswith("/rest/posts/urn%3Ali%3Ashare%3A999")
