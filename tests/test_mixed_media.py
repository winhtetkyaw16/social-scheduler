"""Mixed-media composer: per-channel media picks, fixed validation rules, publish-time conversions, TikTok photos."""

from uuid import uuid4

import httpx
import pytest
from PIL import Image

from app.core.exceptions import ProviderConfigurationError
from app.integrations.platforms.tiktok import TikTokPlatform
from app.services import media_convert
from app.services.error_messages import media_requirement_error
from app.services.posts import _media_for_account

V = "https://cdn.example.com/clip.mp4"
P = [f"https://cdn.example.com/p{i}.jpg" for i in range(5)]
MIX = [V, *P]


# ---- validation ---------------------------------------------------------------------------------

@pytest.mark.parametrize("platform,media,ok", [
    ("instagram", MIX, True),                                   # mixed carousel allowed
    ("instagram", [f"https://a.test/{i}.jpg" for i in range(20)], True),
    ("instagram", [f"https://a.test/{i}.jpg" for i in range(21)], False),
    ("tiktok", [V], True),
    ("tiktok", P, True),                                        # photo post
    ("tiktok", [f"https://a.test/{i}.jpg" for i in range(35)], True),
    ("tiktok", [f"https://a.test/{i}.jpg" for i in range(36)], False),
    ("tiktok", MIX, False),
    ("tiktok", [], False),
    ("x", ["https://a.test/a.gif"], True),
    ("x", ["https://a.test/a.gif", "https://a.test/b.jpg"], False),
    ("youtube", MIX, True),                                     # YouTube just uses the video
    ("youtube", P, False),
    ("facebook", [V, "https://a.test/v2.mp4"], False),
    ("threads", MIX, True),
])
def test_media_rules(platform, media, ok):
    assert (media_requirement_error(platform, media, "hi") is None) is ok


def test_linkedin_mov_allowed_only_with_ffmpeg(monkeypatch):
    monkeypatch.setattr("shutil.which", lambda name: "/usr/bin/ffmpeg")
    assert media_requirement_error("linkedin", ["https://a.test/v.mov"], "hi") is None
    monkeypatch.setattr("shutil.which", lambda name: None)
    assert "MP4 only" in media_requirement_error("linkedin", ["https://a.test/v.mov"], "hi")


# ---- per-channel media --------------------------------------------------------------------------

def test_media_selection_per_account_and_network():
    a, b, c = uuid4(), uuid4(), uuid4()
    meta = {
        "sharedMediaUrls": MIX,
        "mediaSelectionByAccount": {str(a): P[:4]},
        "mediaSelectionByNetwork": {"tiktok": [V]},
    }
    assert _media_for_account(meta, a, MIX, "x") == P[:4]
    assert _media_for_account(meta, b, MIX, "tiktok") == [V]
    assert _media_for_account(meta, c, MIX, "instagram") == MIX
    # Selection keeps the shared order and ignores URLs that are no longer attached.
    meta["mediaSelectionByAccount"][str(a)] = [P[2], "https://gone.test/x.jpg", V]
    assert _media_for_account(meta, a, MIX, "x") == [V, P[2]]
    # An empty pick means text-only for that account (not "fall back to everything").
    meta["mediaSelectionByAccount"][str(a)] = []
    assert _media_for_account(meta, a, MIX, "x") == []


def test_old_posts_without_selection_are_unchanged():
    acct = uuid4()
    assert _media_for_account({"sharedMediaUrls": MIX}, acct, MIX) == MIX
    assert _media_for_account({}, acct, MIX) == MIX
    custom = {"sharedMediaUrls": P, "captionMode": "custom", "channelMediaUrlsByAccount": {str(acct): [V]}}
    assert _media_for_account(custom, acct, P) == [*P, V]


def test_selection_with_custom_channel_media():
    acct = uuid4()
    meta = {"sharedMediaUrls": MIX, "captionMode": "custom", "mediaSelectionByAccount": {str(acct): [V]},
            "channelMediaUrlsByAccount": {str(acct): ["https://cdn.example.com/extra.jpg"]}}
    assert _media_for_account(meta, acct, MIX, "facebook") == [V, "https://cdn.example.com/extra.jpg"]


# ---- conversions --------------------------------------------------------------------------------

@pytest.fixture
def uploads(tmp_path, monkeypatch):
    def fake_local(url):
        path = tmp_path / str(url).split("?")[0].rsplit("/", 1)[-1]
        return path if "/static/uploads/" in str(url) and path.is_file() else None

    monkeypatch.setattr(media_convert, "local_upload_path", fake_local)

    def make(name, size=(100, 100), mode="RGB", noise=False):
        img = Image.new(mode, size, (200, 30, 30, 120) if mode == "RGBA" else (200, 30, 30))
        if noise:
            img = Image.effect_noise(size, 90).convert("RGB")
        img.save(tmp_path / name)
        return f"/static/uploads/{name}"

    make.dir = tmp_path
    return make


def _open(make, url):
    return Image.open(make.dir / url.rsplit("/", 1)[-1])


def test_instagram_gets_jpg_and_center_crop(uploads):
    png = uploads("a.png")
    wide = uploads("wide.jpg", size=(3000, 1000))
    ok = uploads("ok.jpg", size=(1080, 1080))
    out = media_convert.prepare_media("instagram", [png, wide, ok, V])
    assert out[0].endswith(".jpg") and out[0] != png
    assert _open(uploads, out[1]).size == (1910, 1000)
    assert out[2] == ok and out[3] == V                         # fine files and remote URLs untouched
    assert media_convert.prepare_media("instagram", [png]) == [out[0]]  # cached on retry


def test_webp_for_linkedin_and_facebook(uploads):
    flat = uploads("a.webp")
    alpha = uploads("b.webp", mode="RGBA")
    li = media_convert.prepare_media("linkedin", [flat, alpha])
    assert li[0].endswith(".jpg") and li[1].endswith(".png")
    assert media_convert.prepare_media("facebook", [flat])[0].endswith(".jpg")


def test_tiktok_png_to_jpg(uploads):
    png = uploads("t.png")
    jpg = uploads("t2.jpg")
    out = media_convert.prepare_media("tiktok", [png, jpg])
    assert out[0].endswith(".jpg") and out[0] != png and out[1] == jpg


def test_facebook_big_photo_is_compressed(uploads):
    big = uploads("big.png", size=(2600, 2600), noise=True)
    assert (uploads.dir / "big.png").stat().st_size > media_convert.FB_MAX_PHOTO_BYTES
    out = media_convert.prepare_media("facebook", [big])
    assert out[0] != big
    assert (uploads.dir / out[0].rsplit("/", 1)[-1]).stat().st_size <= media_convert.FB_MAX_PHOTO_BYTES


def test_linkedin_mov_without_ffmpeg_is_left_alone(uploads, monkeypatch):
    (uploads.dir / "v.mov").write_bytes(b"\x00" * 100)
    monkeypatch.setattr(media_convert.shutil, "which", lambda name: None)
    assert media_convert.prepare_media("linkedin", ["/static/uploads/v.mov"]) == ["/static/uploads/v.mov"]


def test_youtube_uses_only_the_video():
    assert media_convert.prepare_media("youtube", MIX) == [V]
    assert media_convert.prepare_media("youtube", P) == P


def test_conversion_failure_falls_back(uploads, monkeypatch):
    png = uploads("x.png")
    monkeypatch.setattr(media_convert, "_save_image", lambda *a, **k: (_ for _ in ()).throw(OSError("disk")))
    assert media_convert.prepare_media("instagram", [png]) == [png]


def test_crop_box_matches_frontend():
    assert media_convert.instagram_crop_box(3000, 1000) == (545, 0, 2455, 1000)
    assert media_convert.instagram_crop_box(1000, 2000) == (0, 375, 1000, 1625)
    assert media_convert.instagram_crop_box(1080, 1350) == (0, 0, 1080, 1350)


# ---- TikTok photo posts -------------------------------------------------------------------------

class _Resp:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.is_error = status_code >= 400

    def json(self):
        return self._payload


def test_tiktok_photo_post_pull_from_url(monkeypatch):
    bodies = []

    def fake_post(url, **kwargs):
        if url.endswith("creator_info/query/"):
            return _Resp({"data": {"privacy_level_options": ["SELF_ONLY"]}, "error": {"code": "ok"}})
        bodies.append((url, kwargs.get("json")))
        return _Resp({"data": {"publish_id": "p_pub~1"}, "error": {"code": "ok"}})

    monkeypatch.setattr(httpx, "post", fake_post)
    result = TikTokPlatform().publish("tok", "open-id", "Title line\nMore text", P)
    assert result.post_id == "p_pub~1"
    url, body = bodies[0]
    assert url.endswith("/post/publish/content/init/")
    assert body["media_type"] == "PHOTO" and body["post_mode"] == "DIRECT_POST"
    assert body["source_info"] == {"source": "PULL_FROM_URL", "photo_cover_index": 0, "photo_images": P}
    assert body["post_info"]["title"] == "Title line" and body["post_info"]["description"].startswith("Title line")


def test_tiktok_photo_falls_back_to_inbox(monkeypatch):
    modes = []

    def fake_post(url, **kwargs):
        if url.endswith("creator_info/query/"):
            return _Resp({"data": {"privacy_level_options": ["SELF_ONLY"]}, "error": {"code": "ok"}})
        body = kwargs.get("json")
        modes.append(body["post_mode"])
        if body["post_mode"] == "DIRECT_POST":
            return _Resp({"error": {"code": "scope_not_authorized", "message": "scope"}}, 403)
        return _Resp({"data": {"publish_id": "p2"}, "error": {"code": "ok"}})

    monkeypatch.setattr(httpx, "post", fake_post)
    result = TikTokPlatform().publish("tok", "open-id", "hi", P[:2])
    assert modes == ["DIRECT_POST", "MEDIA_UPLOAD"] and result.post_id == "inbox:p2"


def test_tiktok_photo_needs_public_https(monkeypatch):
    monkeypatch.delenv("PUBLIC_BASE_URL", raising=False)
    monkeypatch.setattr("app.integrations.media_urls.PUBLIC_BASE_URL", "")
    with pytest.raises(ProviderConfigurationError):
        TikTokPlatform().publish("tok", "open-id", "hi", ["/static/uploads/a.jpg"])
    with pytest.raises(ProviderConfigurationError, match="https"):
        TikTokPlatform().publish("tok", "open-id", "hi", ["http://cdn.example.com/a.jpg"])


def test_tiktok_rejects_mix_and_too_many():
    with pytest.raises(ProviderConfigurationError, match="not a mix"):
        TikTokPlatform().publish("tok", "open-id", "hi", MIX)
    with pytest.raises(ProviderConfigurationError, match="35"):
        TikTokPlatform().publish("tok", "open-id", "hi", [f"https://a.test/{i}.jpg" for i in range(36)])


def test_facebook_video_choice_publishes_as_video(monkeypatch):
    """Fix for me sheet: picking "Video" for a Facebook account sends only the video, posted to /videos."""
    from app.integrations.platforms import facebook as fb_mod

    acct = uuid4()
    meta = {"sharedMediaUrls": MIX, "captionMode": "custom", "mediaSelectionByAccount": {str(acct): [V]}}
    media = _media_for_account(meta, acct, MIX, "facebook")
    assert media == [V]
    assert media_requirement_error("facebook", media) is None

    calls = []

    class Resp:
        status_code = 200

        def json(self):
            return {"id": "vid1"}

    monkeypatch.setattr(fb_mod, "provider_request", lambda method, url, **kw: calls.append((method, url, kw)) or Resp())
    result = fb_mod.FacebookPlatform().publish("tok", "111", "hello", media)
    assert result.post_id == "vid1"
    assert len(calls) == 1 and calls[0][1].endswith("/111/videos")
    assert calls[0][2]["json"]["file_url"].endswith("clip.mp4")
