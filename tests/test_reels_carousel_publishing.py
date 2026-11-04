"""Instagram Reels/carousels, Threads carousels, Facebook video/multi-photo; HTTP mocked, no real sleeps."""

import httpx
import pytest

from app.core.exceptions import ProviderConfigurationError
from app.integrations.platforms import instagram as ig_mod
from app.integrations.platforms import threads as th_mod
from app.integrations.platforms.facebook import FacebookPlatform
from app.integrations.platforms.instagram import InstagramPlatform
from app.integrations.platforms.threads import ThreadsPlatform
from app.services.error_messages import classify_error, friendly_error, media_requirement_error


class _Resp:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.headers = {}
        self.is_error = status_code >= 400
        self.text = ""

    def json(self):
        return self._payload


@pytest.fixture
def no_sleep(monkeypatch):
    slept = []
    monkeypatch.setattr(ig_mod, "_sleep", lambda s: slept.append(s))
    monkeypatch.setattr(th_mod, "_sleep", lambda s: slept.append(s))
    monkeypatch.setenv("INSTAGRAM_GRAPH_API_VERSION", "v24.0")
    return slept


def _ig_fake(calls, statuses):
    """statuses: dict container_id -> list of status_code values returned in order."""
    counter = {"n": 0}

    def fake(method, url, **kwargs):
        body = kwargs.get("json")
        calls.append((method, url, body))
        if method == "GET":
            cid = url.split("/")[-1].split("?")[0]
            seq = statuses.get(cid, ["FINISHED"])
            return _Resp({"status_code": seq.pop(0) if len(seq) > 1 else seq[0]})
        if url.endswith("/media"):
            counter["n"] += 1
            return _Resp({"id": f"c{counter['n']}"})
        return _Resp({"id": "ig-post-9"})

    return fake


def test_instagram_reel_polls_until_finished_then_publishes(monkeypatch, no_sleep):
    calls = []
    monkeypatch.setattr(httpx, "request", _ig_fake(calls, {"c1": ["IN_PROGRESS", "IN_PROGRESS", "FINISHED"]}))
    result = InstagramPlatform().publish("tok", "1789", "My reel", ["https://cdn.example.com/clip.mp4"])
    assert result.post_id == "ig-post-9"
    create = calls[0]
    assert create[1] == "https://graph.facebook.com/v24.0/1789/media"
    assert create[2]["media_type"] == "REELS"
    assert create[2]["video_url"] == "https://cdn.example.com/clip.mp4"
    assert create[2]["caption"] == "My reel"
    gets = [c for c in calls if c[0] == "GET"]
    assert len(gets) == 3 and "fields=status_code" in gets[0][1]
    assert len(no_sleep) == 2
    assert calls[-1][1].endswith("/1789/media_publish") and calls[-1][2] == {"creation_id": "c1"}


@pytest.mark.parametrize("state,needle", [("ERROR", "could not process"), ("EXPIRED", "processing expired")])
def test_instagram_reel_error_states(monkeypatch, no_sleep, state, needle):
    calls = []
    monkeypatch.setattr(httpx, "request", _ig_fake(calls, {"c1": [state]}))
    with pytest.raises(ProviderConfigurationError) as exc:
        InstagramPlatform().publish("tok", "1789", "x", ["https://cdn.example.com/clip.mov"])
    assert needle in str(exc.value).lower()
    assert not any(c[1].endswith("media_publish") for c in calls)
    assert classify_error("provider_config", str(exc.value), "instagram") == "instagram_processing_failed"


def test_instagram_reel_timeout(monkeypatch, no_sleep):
    calls = []
    clock = {"t": 0.0}
    monkeypatch.setattr(ig_mod, "_clock", lambda: clock["t"])
    monkeypatch.setattr(ig_mod, "_sleep", lambda s: clock.__setitem__("t", clock["t"] + s))
    monkeypatch.setattr(httpx, "request", _ig_fake(calls, {"c1": ["IN_PROGRESS"]}))
    with pytest.raises(ProviderConfigurationError, match="still processing"):
        InstagramPlatform().publish("tok", "1789", "x", ["https://cdn.example.com/clip.mp4"])
    assert not any(c[1].endswith("media_publish") for c in calls)


def test_instagram_carousel_mixed(monkeypatch, no_sleep):
    calls = []
    monkeypatch.setattr(httpx, "request", _ig_fake(calls, {"c2": ["IN_PROGRESS", "FINISHED"]}))
    urls = ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.mp4", "https://cdn.example.com/c.jpg"]
    result = InstagramPlatform().publish("tok", "1789", "Swipe", urls)
    assert result.post_id == "ig-post-9"
    posts = [c for c in calls if c[0] == "POST" and c[1].endswith("/media")]
    assert posts[0][2] == {"image_url": urls[0], "is_carousel_item": True}
    assert posts[1][2] == {"media_type": "VIDEO", "video_url": urls[1], "is_carousel_item": True}
    assert posts[2][2] == {"image_url": urls[2], "is_carousel_item": True}
    assert posts[3][2] == {"media_type": "CAROUSEL", "children": "c1,c2,c3", "caption": "Swipe"}
    polled = [c[1].split("/")[-1].split("?")[0] for c in calls if c[0] == "GET"]
    assert "c1" not in polled and polled.count("c2") == 2 and "c4" in polled
    assert calls[-1][2] == {"creation_id": "c4"}


def test_instagram_carousel_limits_and_local_media(monkeypatch, no_sleep):
    calls = []
    monkeypatch.setattr(httpx, "request", _ig_fake(calls, {}))
    with pytest.raises(ProviderConfigurationError, match="at most 20"):
        InstagramPlatform().publish("tok", "1", "x", [f"https://cdn.example.com/{i}.jpg" for i in range(21)])
    with pytest.raises(ProviderConfigurationError, match="at least one image or video"):
        InstagramPlatform().publish("tok", "1", "x", [])
    monkeypatch.setenv("PUBLIC_BASE_URL", "http://127.0.0.1:8000")
    with pytest.raises(ProviderConfigurationError, match="publicly fetchable"):
        InstagramPlatform().publish("tok", "1", "x", ["https://cdn.example.com/a.jpg", "http://127.0.0.1:8000/static/uploads/b.mp4"])
    assert calls == []


def test_threads_carousel(monkeypatch, no_sleep):
    calls = []
    n = {"i": 0}

    def fake_request(method, url, **kwargs):
        calls.append((url, kwargs.get("json")))
        if url.endswith("/threads"):
            n["i"] += 1
            return _Resp({"id": f"t{n['i']}"})
        return _Resp({"id": "th-post"})

    polled = []
    monkeypatch.setattr(httpx, "request", fake_request)
    monkeypatch.setattr(httpx, "get", lambda url, **k: polled.append(url) or _Resp({"status": "FINISHED"}))
    urls = ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.mp4"]
    result = ThreadsPlatform().publish("tok", "u1", "Hi", urls)
    assert result.post_id == "th-post"
    assert calls[0][1] == {"media_type": "IMAGE", "image_url": urls[0], "is_carousel_item": True}
    assert calls[1][1] == {"media_type": "VIDEO", "video_url": urls[1], "is_carousel_item": True}
    assert calls[2][1] == {"media_type": "CAROUSEL", "children": "t1,t2", "text": "Hi"}
    assert calls[3][1] == {"creation_id": "t3"}
    assert len(polled) == 3
    with pytest.raises(ProviderConfigurationError, match="at most 20"):
        ThreadsPlatform().publish("tok", "u1", "Hi", [f"https://cdn.example.com/{i}.jpg" for i in range(21)])


def test_threads_delete_is_a_method(monkeypatch):
    seen = []
    monkeypatch.setattr(httpx, "request", lambda m, url, **k: seen.append((m, url)) or _Resp({}, 200))
    ThreadsPlatform().delete("tok", "m1")
    assert seen == [("DELETE", "https://graph.threads.net/v1.0/m1")]


def test_facebook_video_and_multi_photo(monkeypatch):
    calls = []
    n = {"i": 0}

    def fake_request(method, url, **kwargs):
        calls.append((url, kwargs.get("json")))
        if url.endswith("/videos"):
            return _Resp({"id": "vid-1"})
        if url.endswith("/photos"):
            n["i"] += 1
            return _Resp({"id": f"p{n['i']}"})
        return _Resp({"id": "111_post"})

    monkeypatch.setattr(httpx, "request", fake_request)
    monkeypatch.setenv("FACEBOOK_GRAPH_API_VERSION", "v21.0")
    r = FacebookPlatform().publish("tok", "111", "Watch", ["https://cdn.example.com/v.mp4"])
    assert r.post_id == "vid-1"
    assert calls[0] == ("https://graph.facebook.com/v21.0/111/videos",
                        {"file_url": "https://cdn.example.com/v.mp4", "published": True, "description": "Watch"})
    calls.clear()
    r = FacebookPlatform().publish("tok", "111", "Album", ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"])
    assert r.post_id == "111_post"
    assert calls[0][1] == {"url": "https://cdn.example.com/a.jpg", "published": False}
    assert calls[2] == ("https://graph.facebook.com/v21.0/111/feed",
                        {"attached_media": [{"media_fbid": "p1"}, {"media_fbid": "p2"}], "message": "Album"})
    with pytest.raises(ProviderConfigurationError, match="not a mix"):
        FacebookPlatform().publish("tok", "111", "x", ["https://cdn.example.com/a.jpg", "https://cdn.example.com/v.mp4"])


@pytest.mark.parametrize("platform,media,ok", [
    ("instagram", ["https://a.test/1.mp4"], True),
    ("instagram", ["https://a.test/1.jpg", "https://a.test/2.mp4"], True),
    ("instagram", [f"https://a.test/{i}.jpg" for i in range(20)], True),
    ("instagram", [f"https://a.test/{i}.jpg" for i in range(21)], False),
    ("instagram", [], False),
    ("threads", [f"https://a.test/{i}.jpg" for i in range(20)], True),
    ("threads", [f"https://a.test/{i}.jpg" for i in range(21)], False),
    ("facebook", ["https://a.test/1.mp4"], True),
    ("facebook", ["https://a.test/1.jpg", "https://a.test/2.jpg"], True),
    ("facebook", ["https://a.test/1.jpg", "https://a.test/2.mp4"], False),
])
def test_validation_matches_publishers(platform, media, ok):
    assert (media_requirement_error(platform, media, "hi") is None) is ok


def test_new_friendly_messages():
    r = friendly_error("provider_config", "Instagram carousels can have at most 10 items (this post has 12).", "instagram")
    assert r["category"] == "instagram_too_many_items" and "10" in r["what_happened"]
    r = friendly_error("provider_config", "Threads carousels can have at most 20 items (this post has 21).", "threads")
    assert r["category"] == "too_many_media_items"
    r = friendly_error("provider_config", "Instagram could not process the Reel (processing error).", "instagram")
    assert r["banner"] == "Instagram couldn't process your video."
