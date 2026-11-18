"""Composer per-network "Platform settings" reach the real API request bodies (mocked HTTP, no live calls)."""

import pytest

from app.integrations.base import ProviderHTTPError, ProviderPublishResult
from app.integrations.platforms import facebook as fbmod
from app.integrations.platforms import instagram as igmod
from app.integrations.platforms import linkedin as limod
from app.integrations.platforms import tiktok as ttmod
from app.integrations.platforms import x as xmod
from app.integrations.platforms import youtube as ytmod
from app.services import publishing
from app.tasks.publish_post import _settings_kwargs


class _Resp:
    def __init__(self, payload=None, status_code=200, headers=None):
        self._payload = payload or {}
        self.status_code = status_code
        self.headers = headers or {}
        self.is_error = status_code >= 400
        self.text = ""

    def json(self):
        return self._payload


# --- YouTube: privacy_status, made_for_kids, category -> videos.insert metadata ---


def _yt_metadata(monkeypatch, settings):
    sent = {}
    monkeypatch.setattr(
        ytmod, "_load_video_bytes", lambda url: (b"\x00" * 10, "video/mp4")
    )

    def fake_post(url, **kw):
        sent.update(kw.get("json") or {})
        return _Resp(status_code=500)

    monkeypatch.setattr(ytmod.httpx, "post", fake_post)
    with pytest.raises(ProviderHTTPError):
        ytmod.YouTubePlatform().publish(
            "tok", "UC1", "Title\nBody", ["/static/uploads/v.mp4"], settings=settings
        )
    return sent


def test_youtube_settings_in_upload_metadata(monkeypatch):
    meta = _yt_metadata(
        monkeypatch,
        {"privacy_status": "Unlisted", "made_for_kids": True, "category": "Education"},
    )
    assert meta["status"] == {
        "privacyStatus": "unlisted",
        "selfDeclaredMadeForKids": True,
    }
    assert meta["snippet"]["categoryId"] == "27"


def test_youtube_defaults_without_settings(monkeypatch):
    meta = _yt_metadata(monkeypatch, None)
    assert meta["status"] == {
        "privacyStatus": "public",
        "selfDeclaredMadeForKids": False,
    }
    assert meta["snippet"]["categoryId"] == "22"
    assert ytmod.youtube_privacy({"privacy_status": "bogus"}) == "public"


# --- TikTok: audience -> privacy_level (only if creator allows), allow_* -> disable_* ---


def _creator(monkeypatch, options):
    monkeypatch.setattr(
        ttmod.httpx,
        "post",
        lambda *a, **k: _Resp({"data": {"privacy_level_options": options}}),
    )


def test_tiktok_privacy_honours_choice_when_allowed(monkeypatch):
    _creator(monkeypatch, ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"])
    assert ttmod._privacy_level("t", {"audience": "Only me"}) == "SELF_ONLY"
    assert ttmod._privacy_level("t", {"audience": "Friends"}) == "MUTUAL_FOLLOW_FRIENDS"
    assert ttmod._privacy_level("t", None) == "PUBLIC_TO_EVERYONE"


def test_tiktok_privacy_falls_back_when_not_allowed(monkeypatch):
    _creator(monkeypatch, ["SELF_ONLY"])
    assert ttmod._privacy_level("t", {"audience": "Public"}) == "SELF_ONLY"


def test_tiktok_photo_interactions(monkeypatch):
    _creator(monkeypatch, ["PUBLIC_TO_EVERYONE"])
    bodies = []
    monkeypatch.setattr(
        ttmod,
        "public_media_url",
        lambda url, platform=None: "https://cdn.example.com/a.jpg",
    )
    monkeypatch.setattr(
        ttmod,
        "_tiktok_json_post",
        lambda tok, url, body, raise_on_error=False: bodies.append(body)
        or {"publish_id": "p"},
    )
    monkeypatch.setattr(
        ttmod,
        "_finish_tiktok_publish",
        lambda *a, **k: ProviderPublishResult(post_id="p"),
    )
    ttmod.TikTokPlatform().publish(
        "t",
        "open1",
        "hi",
        ["/static/uploads/a.jpg"],
        settings={"allow_comments": False},
    )
    assert bodies[0]["post_info"]["disable_comment"] is True


def test_tiktok_video_interactions(monkeypatch, tmp_path):
    _creator(monkeypatch, ["PUBLIC_TO_EVERYONE", "SELF_ONLY"])
    video = tmp_path / "v.mp4"
    video.write_bytes(b"\x00" * 100)
    bodies = []
    monkeypatch.setattr(ttmod, "local_upload_path", lambda url: video)
    monkeypatch.setattr(
        ttmod,
        "_tiktok_json_post",
        lambda tok, url, body, raise_on_error=False: bodies.append(body)
        or {"publish_id": "p"},
    )
    monkeypatch.setattr(
        ttmod,
        "_finish_tiktok_publish",
        lambda *a, **k: ProviderPublishResult(post_id="p"),
    )
    ttmod.TikTokPlatform().publish(
        "t",
        "open1",
        "hi",
        ["/static/uploads/v.mp4"],
        settings={
            "audience": "Only me",
            "allow_duet": False,
            "allow_stitch": False,
            "allow_comments": True,
        },
    )
    info = bodies[0]["post_info"]
    assert (
        info["privacy_level"],
        info["disable_duet"],
        info["disable_stitch"],
        info["disable_comment"],
    ) == ("SELF_ONLY", True, True, False)


# --- LinkedIn: visibility -> Posts API visibility (CONNECTIONS only for members) ---


def _li_body(monkeypatch, account_id, settings):
    sent = {}
    monkeypatch.setattr(
        limod,
        "provider_request",
        lambda m, url, **kw: sent.update(kw.get("json") or {})
        or _Resp(status_code=201, headers={"x-restli-id": "urn:li:share:1"}),
    )
    limod.LinkedInPlatform().publish("t", account_id, "hello", [], settings=settings)
    return sent


def test_linkedin_visibility(monkeypatch):
    assert (
        _li_body(monkeypatch, "abc", {"visibility": "Connections only"})["visibility"]
        == "CONNECTIONS"
    )
    assert (
        _li_body(monkeypatch, "abc", {"visibility": "Anyone"})["visibility"] == "PUBLIC"
    )
    assert (
        _li_body(
            monkeypatch, "urn:li:organization:9", {"visibility": "Connections only"}
        )["visibility"]
        == "PUBLIC"
    )


# --- X: reply_permission -> reply_settings ---


def _x_body(monkeypatch, settings):
    sent = {}
    monkeypatch.setattr(
        xmod,
        "provider_request",
        lambda m, url, **kw: sent.update(kw.get("json") or {})
        or _Resp({"data": {"id": "1"}}),
    )
    xmod.XPlatform().publish("t", "u", "hello", [], settings=settings)
    return sent


def test_x_reply_settings(monkeypatch):
    assert (
        _x_body(monkeypatch, {"reply_permission": "Accounts you follow"})[
            "reply_settings"
        ]
        == "following"
    )
    assert (
        _x_body(monkeypatch, {"reply_permission": "Only accounts you mention"})[
            "reply_settings"
        ]
        == "mentionedUsers"
    )
    assert "reply_settings" not in _x_body(
        monkeypatch, {"reply_permission": "Everyone"}
    )


# --- Facebook: first_comment -> POST /{post-id}/comments, best effort ---


def test_facebook_first_comment(monkeypatch):
    calls = []
    monkeypatch.setattr(
        fbmod,
        "provider_request",
        lambda m, url, **kw: calls.append((url, kw.get("json")))
        or _Resp({"id": "1_2"}),
    )
    result = fbmod.FacebookPlatform().publish(
        "t", "1", "hello", [], settings={"first_comment": "Link in bio"}
    )
    assert result.post_id == "1_2"
    assert calls[-1][0].endswith("/1_2/comments") and calls[-1][1] == {
        "message": "Link in bio"
    }


def test_facebook_first_comment_failure_keeps_publish(monkeypatch):
    def fake(m, url, **kw):
        if url.endswith("/comments"):
            raise ProviderHTTPError(400)
        return _Resp({"id": "1_2"})

    monkeypatch.setattr(fbmod, "provider_request", fake)
    assert (
        fbmod.FacebookPlatform()
        .publish("t", "1", "hello", [], settings={"first_comment": "x"})
        .post_id
        == "1_2"
    )


def test_facebook_no_comment_without_setting(monkeypatch):
    calls = []
    monkeypatch.setattr(
        fbmod,
        "provider_request",
        lambda m, url, **kw: calls.append(url) or _Resp({"id": "1_2"}),
    )
    fbmod.FacebookPlatform().publish(
        "t", "1", "hello", [], settings={"first_comment": "  "}
    )
    assert len(calls) == 1


# --- Instagram: alt_text on image containers, disable_comments -> comment_enabled=false ---


def _ig(monkeypatch, media, settings):
    calls = []

    def fake(m, url, **kw):
        calls.append((m, url, kw.get("json")))
        if url.endswith("/media_publish"):
            return _Resp({"id": "ig9"})
        if m == "GET":
            return _Resp({"status_code": "FINISHED"})
        return _Resp({"id": f"c{len(calls)}"})

    monkeypatch.setattr(igmod, "provider_request", fake)
    monkeypatch.setattr(
        igmod,
        "instagram_image_url",
        lambda u: "https://cdn.example.com/" + u.rsplit("/", 1)[-1],
    )
    igmod.InstagramPlatform().publish("t", "17", "cap", media, settings=settings)
    return calls


def test_instagram_alt_text_single_and_carousel(monkeypatch):
    single = _ig(monkeypatch, ["/a.jpg"], {"alt_text": "A red bike"})
    assert single[0][2]["alt_text"] == "A red bike"
    car = _ig(monkeypatch, ["/a.jpg", "/b.mp4"], {"alt_text": "A red bike"})
    bodies = [c[2] for c in car if c[0] == "POST" and c[1].endswith("/media")]
    assert bodies[0]["alt_text"] == "A red bike"  # image child
    assert "alt_text" not in bodies[1]  # video child
    assert "alt_text" not in bodies[2]  # carousel parent


def test_instagram_disable_comments(monkeypatch):
    calls = _ig(monkeypatch, ["/a.jpg"], {"disable_comments": True})
    assert calls[-1][1].endswith("/ig9") and calls[-1][2] == {"comment_enabled": False}
    assert not any(c[1].endswith("/ig9") for c in _ig(monkeypatch, ["/a.jpg"], {}))


# --- plumbing: saved post_metadata.settings -> adapter settings kwarg ---


def test_settings_kwargs_from_post_metadata():
    assert _settings_kwargs({"settings": {"a": 1}}) == {"settings": {"a": 1}}
    assert _settings_kwargs({"settings": {}}) == {}
    assert _settings_kwargs(None) == {}


def test_publish_passes_settings_only_to_adapters_that_take_them(monkeypatch):
    seen = {}

    class New:
        def publish(self, token, acct, content, media, settings=None):
            seen["new"] = settings
            return ProviderPublishResult(post_id="1")

    class Old:
        def publish(self, token, acct, content, media):
            seen["old"] = True
            return ProviderPublishResult(post_id="2")

    import app.services.media_convert as mc

    monkeypatch.setattr(
        mc, "prepare_media", lambda platform, media, ig_crop=None: media
    )
    monkeypatch.setattr(
        publishing, "get_platform", lambda p: New() if p == "x" else Old()
    )
    publishing.publish(
        "x",
        "t",
        "a",
        "hi",
        [],
        settings={"reply_permission": "Everyone"},
        format="Post",
    )
    publishing.publish("threads", "t", "a", "hi", [], settings={"k": 1}, format="Post")
    assert seen == {"new": {"reply_permission": "Everyone"}, "old": True}


# --- OAuth scopes for first comment (Facebook) and Threads replies ---


def test_oauth_requests_engagement_and_reply_scopes():
    from app.services.oauth import _providers

    providers = _providers()
    assert "pages_manage_engagement" in providers["facebook"].scopes
    assert "pages_read_user_content" in providers["facebook"].scopes
    assert "read_insights" in providers["facebook"].scopes
    assert "pages_manage_posts" in providers["facebook"].scopes
    assert "instagram_manage_insights" in providers["instagram"].scopes
    assert "instagram_manage_comments" in providers["instagram"].scopes
    assert "threads_manage_replies" in providers["threads"].scopes
    assert "threads_read_replies" in providers["threads"].scopes
    assert "threads_manage_insights" in providers["threads"].scopes
    assert {"threads_basic", "threads_content_publish"} <= set(
        providers["threads"].scopes
    )
    assert "https://www.googleapis.com/auth/yt-analytics.readonly" in providers["youtube"].scopes
    assert "https://www.googleapis.com/auth/youtube.readonly" in providers["youtube"].scopes
    assert "tweet.moderate.write" in providers["x"].scopes
    assert "video.list" not in providers["tiktok"].scopes


def test_facebook_first_comment_uses_page_token_and_comments_edge(monkeypatch):
    calls = []
    monkeypatch.setattr(
        fbmod,
        "provider_request",
        lambda m, url, **kw: calls.append((m, url, kw.get("access_token")))
        or _Resp({"id": "PAGE_POST"}),
    )
    fbmod.FacebookPlatform().publish(
        "PAGE-TOKEN", "PAGE", "hello", [], settings={"first_comment": "hi"}
    )
    method, url, token = calls[-1]
    assert (
        method == "POST"
        and url.endswith("/PAGE_POST/comments")
        and token == "PAGE-TOKEN"
    )


# --- Threads: Who can reply -> reply_control on the published container ---

from app.integrations.platforms import threads as thmod  # noqa: E402


def _threads(monkeypatch, media, settings):
    calls = []
    monkeypatch.setattr(thmod, "_wait_for_threads_container", lambda *a, **k: None)
    monkeypatch.setattr(thmod, "public_media_url", lambda url, platform=None: url)

    def fake(method, url, **kw):
        calls.append((url, kw.get("json")))
        return _Resp({"id": f"id{len(calls)}"})

    monkeypatch.setattr(thmod, "provider_request", fake)
    thmod.ThreadsPlatform().publish("t", "42", "hello", media, settings=settings)
    return calls


@pytest.mark.parametrize(
    "label,value",
    [
        ("Accounts you follow", "accounts_you_follow"),
        ("Only accounts you mention", "mentioned_only"),
        ("Followers only", "followers_only"),
    ],
)
def test_threads_reply_control_on_text_post(monkeypatch, label, value):
    calls = _threads(monkeypatch, [], {"reply_control": label})
    assert calls[0][1]["reply_control"] == value
    assert "reply_control" not in calls[-1][1]  # threads_publish body


def test_threads_everyone_or_missing_omits_reply_control(monkeypatch):
    for settings in (None, {"reply_control": "Everyone"}, {"reply_control": "bogus"}):
        assert "reply_control" not in _threads(monkeypatch, [], settings)[0][1]


def test_threads_reply_control_only_on_carousel_parent(monkeypatch):
    calls = _threads(
        monkeypatch,
        ["https://x/a.jpg", "https://x/b.jpg"],
        {"reply_control": "Followers only"},
    )
    children, parent = calls[:2], calls[2]
    assert all("reply_control" not in body for _, body in children)
    assert (
        parent[1]["media_type"] == "CAROUSEL"
        and parent[1]["reply_control"] == "followers_only"
    )


def test_threads_adapter_receives_settings_via_publish(monkeypatch):
    assert publishing._accepts_settings(thmod.ThreadsPlatform().publish)
