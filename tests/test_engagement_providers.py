"""Provider parsing and OAuth scopes. HTTP is scripted. No live network calls."""

from datetime import datetime, timezone
from types import SimpleNamespace
import httpx

from app.core.security import encrypt_token
from app.db.session import SessionLocal
from app.models.connected_account import ConnectedAccount
from app.services.engagement.base import CreditsRequired, NotSupported
from app.services.engagement.providers.facebook import FacebookEngagement
from app.services.engagement.providers.instagram import InstagramEngagement
from app.services.engagement.providers.pinterest import PinterestEngagement
from app.services.engagement.providers.threads import ThreadsEngagement
from app.services.engagement.providers.x import XEngagement
from app.services.engagement.providers.youtube import YouTubeEngagement
from app.services.oauth_scopes import (
    FACEBOOK_SCOPES,
    INSTAGRAM_SCOPES,
    THREADS_SCOPES,
    TIKTOK_SCOPES,
    X_SCOPES,
    YOUTUBE_ANALYTICS,
    YOUTUBE_SCOPES,
    tiktok_scopes,
)


class _Script:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, method, url, **kwargs):
        self.calls.append(
            {
                "method": method,
                "url": url,
                "params": kwargs.get("params"),
                "json": kwargs.get("json"),
                "data": kwargs.get("data"),
                "headers": kwargs.get("headers"),
            }
        )
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def _account(platform, account_id="acct-1", scopes=None):
    return SimpleNamespace(
        platform=platform,
        platform_account_id=account_id,
        account_name="Studio",
        extra_metadata={"username": "studio"},
        scopes=list(scopes or []),
        needs_reconnect=False,
        is_active=True,
        access_token_ciphertext=encrypt_token("provider-token"),
    )


def _post(provider_id="post-1"):
    return SimpleNamespace(
        provider_post_id=provider_id,
        published_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
    )


def _comment(provider_id="comment-1"):
    return SimpleNamespace(provider_comment_id=provider_id)


def _ok(payload, status_code=200):
    return httpx.Response(status_code, json=payload)


def test_oauth_scope_constants_match_the_consoles():
    from app.services.oauth import _providers

    providers = _providers()
    assert providers["facebook"].scopes == FACEBOOK_SCOPES
    assert providers["instagram"].scopes == INSTAGRAM_SCOPES
    assert "instagram_business_basic" not in INSTAGRAM_SCOPES
    assert "instagram_manage_insights" in INSTAGRAM_SCOPES
    assert providers["threads"].scopes == THREADS_SCOPES
    assert providers["youtube"].scopes == YOUTUBE_SCOPES
    assert YOUTUBE_ANALYTICS in YOUTUBE_SCOPES
    assert providers["x"].scopes == X_SCOPES
    assert providers["pinterest"].scopes[-1] == "user_accounts:read"
    assert "pins:read" in providers["pinterest"].scopes
    assert providers["tiktok"].scopes == TIKTOK_SCOPES
    assert "video.list" not in tiktok_scopes()


def test_tiktok_video_list_stays_gated(monkeypatch):
    from app.services.engagement.registry import get_engagement_provider
    from app.services.oauth import _providers

    assert get_engagement_provider("tiktok").capabilities.supports_insights is False
    monkeypatch.setenv("TIKTOK_ENABLE_VIDEO_LIST", "true")
    assert tiktok_scopes()[-1] == "video.list"
    assert _providers()["tiktok"].scopes[-1] == "video.list"
    enabled = get_engagement_provider("tiktok")
    assert enabled.capabilities.supports_insights is True
    assert enabled.capabilities.supports_comments_read is False
    script = _Script(
        [
            _ok(
                {
                    "data": {
                        "videos": [
                            {
                                "id": "vid-1",
                                "like_count": 3,
                                "comment_count": 1,
                                "share_count": 2,
                                "view_count": 40,
                            }
                        ]
                    },
                    "error": {"code": "ok"},
                }
            )
        ]
    )
    monkeypatch.setattr("app.services.engagement.http.httpx.request", script)
    insights = enabled.fetch_insights(_account("tiktok", scopes=["video.list"]), _post("vid-1"))
    assert insights.video_views == 40
    assert insights.likes == 3
    assert insights.comments == 1
    assert insights.shares == 2
    assert script.calls[0]["url"] == "https://open.tiktokapis.com/v2/video/query/"
    assert script.calls[0]["json"] == {"filters": {"video_ids": ["vid-1"]}}
    monkeypatch.setenv("TIKTOK_ENABLE_VIDEO_LIST", "false")
    try:
        get_engagement_provider("tiktok").fetch_insights(_account("tiktok"), _post())
    except NotSupported:
        pass
    else:
        raise AssertionError("comments and video counts stay off when the flag is off")


def test_facebook_parses_comments_reply_and_insights(monkeypatch):
    script = _Script(
        [
            _ok(
                {
                    "data": [
                        {
                            "id": "c1",
                            "message": "Hello",
                            "created_time": "2026-11-01T12:00:00+0000",
                            "from": {"id": "page-1", "name": "Studio"},
                            "is_hidden": False,
                        },
                        {
                            "id": "c2",
                            "message": "A reply",
                            "created_time": "2026-11-01T13:00:00+0000",
                            "from": {"id": "user-9", "name": "Ada"},
                            "parent": {"id": "c1"},
                            "is_hidden": True,
                        },
                    ]
                }
            ),
            _ok({"id": "reply-1"}),
            _ok(
                {
                    "data": [
                        {"name": "post_media_view", "values": [{"value": 20}]},
                        {"name": "post_total_media_view_unique", "values": [{"value": 11}]},
                        {"name": "post_reactions_like_total", "values": [{"value": 3}]},
                        {"name": "post_reactions_love_total", "values": [{"value": 1}]},
                        {"name": "post_impressions", "values": [{"value": 999}]},
                    ]
                }
            ),
        ]
    )
    monkeypatch.setattr("app.services.engagement.http.httpx.request", script)
    provider = FacebookEngagement()
    account = _account("facebook", "page-1")
    comments = provider.fetch_comments(account, _post("PAGE_POST"))
    assert [item.provider_comment_id for item in comments] == ["c1", "c2"]
    assert comments[0].is_own is True
    assert comments[1].provider_parent_id == "c1"
    assert comments[1].hidden is True
    assert comments[1].text == "A reply"
    assert "/PAGE_POST/comments" in script.calls[0]["url"]
    assert script.calls[0]["params"]["filter"] == "stream"
    reply = provider.reply_to_comment(account, _comment("c2"), "Thanks")
    assert reply.provider_comment_id == "reply-1"
    assert script.calls[1]["json"] == {"message": "Thanks"}
    assert script.calls[1]["url"].endswith("/c2/comments")
    insights = provider.fetch_insights(account, _post("PAGE_POST"))
    assert insights.impressions == 20
    assert insights.reach == 11
    assert insights.likes == 4
    assert "post_impressions" not in script.calls[2]["params"]["metric"]
    assert "post_media_view" in script.calls[2]["params"]["metric"]


def test_instagram_parses_replies_and_views(monkeypatch):
    script = _Script(
        [
            _ok(
                {
                    "data": [
                        {
                            "id": "ig1",
                            "text": "Nice",
                            "username": "ada",
                            "timestamp": "2026-11-02T00:00:00+0000",
                            "replies": {
                                "data": [
                                    {
                                        "id": "ig2",
                                        "text": "Thanks",
                                        "username": "studio",
                                        "timestamp": "2026-11-02T01:00:00+0000",
                                    }
                                ]
                            },
                        }
                    ]
                }
            ),
            _ok({"id": "ig-reply"}),
            _ok(
                {
                    "data": [
                        {"name": "views", "values": [{"value": 15}]},
                        {"name": "reach", "values": [{"value": 9}]},
                        {"name": "saved", "values": [{"value": 2}]},
                        {"name": "likes", "values": [{"value": 4}]},
                    ]
                }
            ),
        ]
    )
    monkeypatch.setattr("app.services.engagement.http.httpx.request", script)
    provider = InstagramEngagement()
    account = _account("instagram", "ig-user")
    comments = provider.fetch_comments(account, _post("MEDIA"))
    assert [item.provider_comment_id for item in comments] == ["ig1", "ig2"]
    assert comments[1].provider_parent_id == "ig1"
    assert comments[1].is_own is True
    assert script.calls[0]["params"]["limit"] == "50"
    assert "impressions" not in script.calls[0]["params"]["fields"]
    reply = provider.reply_to_comment(account, _comment("ig1"), "Hello")
    assert reply.provider_comment_id == "ig-reply"
    assert script.calls[1]["url"].endswith("/ig1/replies")
    assert script.calls[1]["data"] == {"message": "Hello"}
    insights = provider.fetch_insights(account, _post("MEDIA"))
    assert insights.impressions == 15
    assert insights.reach == 9
    assert insights.saves == 2
    assert "views" in script.calls[2]["params"]["metric"]
    assert "impressions" not in script.calls[2]["params"]["metric"]


def test_threads_replies_and_insights(monkeypatch):
    script = _Script(
        [
            _ok(
                {
                    "data": [
                        {
                            "id": "th1",
                            "text": "Reply",
                            "username": "ada",
                            "timestamp": "2026-11-03T00:00:00+0000",
                            "hide_status": "NOT_HUSHED",
                            "replied_to": {"id": "root"},
                        }
                    ]
                }
            ),
            _ok({"id": "container-1"}),
            _ok({"status": "FINISHED"}),
            _ok({"id": "published-reply"}),
            _ok(
                {
                    "data": [
                        {"name": "views", "values": [{"value": 8}]},
                        {"name": "likes", "values": [{"value": 2}]},
                        {"name": "replies", "values": [{"value": 1}]},
                        {"name": "shares", "values": [{"value": 1}]},
                    ]
                }
            ),
        ]
    )
    monkeypatch.setattr("app.services.engagement.http.httpx.request", script)
    provider = ThreadsEngagement()
    account = _account("threads", "threads-user")
    comments = provider.fetch_comments(account, _post("THREAD"))
    assert comments[0].text == "Reply"
    assert comments[0].provider_parent_id == "root"
    assert comments[0].hidden is False
    assert script.calls[0]["url"].startswith("https://graph.threads.com/")
    assert script.calls[0]["url"].endswith("/THREAD/replies")
    reply = provider.reply_to_comment(account, _comment("th1"), "On it")
    assert reply.provider_comment_id == "published-reply"
    assert script.calls[1]["json"]["reply_to_id"] == "th1"
    assert script.calls[1]["url"].endswith("/me/threads")
    assert script.calls[3]["url"].endswith("/threads-user/threads_publish")
    assert script.calls[3]["json"] == {"creation_id": "container-1"}
    insights = provider.fetch_insights(account, _post("THREAD"))
    assert insights.impressions == 8
    assert insights.comments == 1
    assert insights.likes == 2


def test_x_search_reply_metrics_hide_and_402(monkeypatch, client, auth_headers):
    script = _Script(
        [
            _ok(
                {
                    "data": [
                        {
                            "id": "reply-9",
                            "text": "Nice post",
                            "author_id": "user-2",
                            "created_at": "2026-11-04T00:00:00.000Z",
                            "conversation_id": "root-tweet",
                            "referenced_tweets": [{"type": "replied_to", "id": "root-tweet"}],
                        }
                    ],
                    "includes": {
                        "users": [
                            {
                                "id": "user-2",
                                "name": "Ada",
                                "username": "ada",
                                "profile_image_url": "https://example.com/a.png",
                            }
                        ]
                    },
                }
            ),
            _ok({"data": {"id": "our-reply"}}),
            _ok({"data": {"hidden": True}}),
            _ok(
                {
                    "data": {
                        "id": "root-tweet",
                        "public_metrics": {
                            "impression_count": 100,
                            "like_count": 5,
                            "reply_count": 2,
                            "retweet_count": 1,
                            "bookmark_count": 4,
                        },
                    }
                }
            ),
        ]
    )
    monkeypatch.setattr("app.services.engagement.http.httpx.request", script)
    provider = XEngagement()
    account = _account("x", "user-1", scopes=["tweet.read", "tweet.write", "tweet.moderate.write"])
    comments = provider.fetch_comments(account, _post("root-tweet"))
    assert comments[0].text == "Nice post"
    assert comments[0].author_handle == "ada"
    assert comments[0].provider_parent_id == "root-tweet"
    assert "conversation_id:root-tweet is:reply" in script.calls[0]["params"]["query"]
    reply = provider.reply_to_comment(account, _comment("reply-9"), "Thanks")
    assert reply.provider_comment_id == "our-reply"
    assert script.calls[1]["json"]["reply"]["in_reply_to_tweet_id"] == "reply-9"
    provider.hide_reply(account, _comment("reply-9"), True)
    assert script.calls[2]["method"] == "PUT"
    assert script.calls[2]["url"].endswith("/tweets/reply-9/hidden")
    assert script.calls[2]["json"] == {"hidden": True}
    insights = provider.fetch_insights(account, _post("root-tweet"))
    assert insights.impressions == 100
    assert insights.likes == 5
    assert insights.comments == 2
    assert insights.saves == 4

    def credits(*args, **kwargs):
        return httpx.Response(
            402,
            json={"title": "CreditsDepleted", "detail": "payment required", "status": 402},
        )

    monkeypatch.setattr("app.services.engagement.http.httpx.request", credits)
    try:
        provider.fetch_comments(account, _post("root-tweet"))
    except CreditsRequired as exc:
        assert "credits" in exc.message.lower()
    else:
        raise AssertionError("402 should be a credits error")

    headers, _ = auth_headers
    from tests.test_engagement import _connect, _published, _user_id

    user_id = _user_id(headers)
    account_id = _connect(client, headers, "x")
    post_id = _published(user_id, account_id)
    response = client.post(f"/api/v1/posts/{post_id}/engagement/sync", headers=headers)
    assert response.status_code == 402, response.text
    assert "credits" in response.json()["detail"].lower()
    db = SessionLocal()
    try:
        stored = db.get(ConnectedAccount, account_id)
        assert stored.needs_reconnect is False
    finally:
        db.close()


def test_youtube_comments_analytics_and_statistics_fallback(monkeypatch):
    analytics = _Script(
        [
            _ok(
                {
                    "items": [
                        {
                            "id": "thread-1",
                            "snippet": {
                                "topLevelComment": {
                                    "id": "top-1",
                                    "snippet": {
                                        "textOriginal": "First",
                                        "authorDisplayName": "Ada",
                                        "authorChannelId": {"value": "chan-9"},
                                        "publishedAt": "2026-11-05T00:00:00Z",
                                    },
                                }
                            },
                            "replies": {
                                "comments": [
                                    {
                                        "id": "reply-1",
                                        "snippet": {
                                            "textOriginal": "Second",
                                            "parentId": "top-1",
                                            "authorChannelId": {"value": "chan-1"},
                                            "publishedAt": "2026-11-05T01:00:00Z",
                                        },
                                    }
                                ]
                            },
                        }
                    ]
                }
            ),
            _ok({"id": "new-reply"}),
            _ok(
                {
                    "columnHeaders": [
                        {"name": "views"},
                        {"name": "likes"},
                        {"name": "comments"},
                        {"name": "shares"},
                    ],
                    "rows": [[30, 6, 2, 1]],
                }
            ),
        ]
    )
    monkeypatch.setattr("app.services.engagement.http.httpx.request", analytics)
    provider = YouTubeEngagement()
    account = _account(
        "youtube",
        "chan-1",
        scopes=[
            "https://www.googleapis.com/auth/youtube.force-ssl",
            YOUTUBE_ANALYTICS,
        ],
    )
    comments = provider.fetch_comments(account, _post("video-1"))
    assert [item.provider_comment_id for item in comments] == ["top-1", "reply-1"]
    assert comments[1].provider_parent_id == "top-1"
    assert comments[1].is_own is True
    assert "commentThreads" in analytics.calls[0]["url"]
    reply = provider.reply_to_comment(account, _comment("top-1"), "Hello")
    assert reply.provider_comment_id == "new-reply"
    assert analytics.calls[1]["json"]["snippet"]["parentId"] == "top-1"
    insights = provider.fetch_insights(account, _post("video-1"))
    assert insights.video_views == 30
    assert insights.likes == 6
    assert insights.shares == 1
    assert "youtubeanalytics.googleapis.com" in analytics.calls[2]["url"]
    assert analytics.calls[2]["params"]["filters"] == "video==video-1"

    stats = _Script(
        [
            _ok(
                {
                    "items": [
                        {
                            "statistics": {
                                "viewCount": "12",
                                "likeCount": "3",
                                "commentCount": "1",
                            }
                        }
                    ]
                }
            )
        ]
    )
    monkeypatch.setattr("app.services.engagement.http.httpx.request", stats)
    basic = _account("youtube", "chan-1", scopes=["https://www.googleapis.com/auth/youtube.readonly"])
    fallback = provider.fetch_insights(basic, _post("video-1"))
    assert fallback.video_views == 12
    assert fallback.likes == 3
    assert fallback.comments == 1
    assert "/videos" in stats.calls[0]["url"]
    assert stats.calls[0]["params"]["part"] == "statistics"


def test_pinterest_analytics_only(monkeypatch):
    script = _Script(
        [
            _ok(
                {
                    "summary_metrics": {"IMPRESSION": 7, "PIN_CLICK": 2, "SAVE": 1},
                    "lifetime_metrics": {"TOTAL_COMMENTS": 4, "TOTAL_REACTIONS": 5},
                }
            )
        ]
    )
    monkeypatch.setattr("app.services.engagement.http.httpx.request", script)
    provider = PinterestEngagement()
    account = _account("pinterest", scopes=["pins:read", "boards:read"])
    try:
        provider.fetch_comments(account, _post("pin-1"), None)
    except NotSupported:
        pass
    else:
        raise AssertionError("Pinterest comments stay unsupported")
    insights = provider.fetch_insights(account, _post("pin-1"))
    assert insights.impressions == 7
    assert insights.clicks == 2
    assert insights.saves == 1
    assert insights.comments == 4
    assert insights.likes == 5
    assert "/v5/pins/pin-1/analytics" in script.calls[0]["url"]
    assert "IMPRESSION" in script.calls[0]["params"]["metric_types"]


def test_expired_token_sets_needs_reconnect(monkeypatch, client, auth_headers):
    from tests.test_engagement import _add_comment, _connect, _published, _user_id

    monkeypatch.setattr(
        "app.services.engagement.http.httpx.request",
        lambda *args, **kwargs: httpx.Response(
            401,
            json={"error": {"message": "Error validating access token", "code": 190, "type": "OAuthException"}},
        ),
    )
    headers, _ = auth_headers
    user_id = _user_id(headers)
    account_id = _connect(client, headers, "facebook")
    post_id = _published(user_id, account_id)
    comment_id = _add_comment(post_id, account_id, text="Hi", network="facebook", minutes_ago=1)
    response = client.post(
        f"/api/v1/comments/{comment_id}/reply",
        headers=headers,
        json={"text": "Thanks"},
    )
    assert response.status_code == 409, response.text
    assert "Reconnect" in response.json()["detail"]
    db = SessionLocal()
    try:
        stored = db.get(ConnectedAccount, account_id)
        assert stored.needs_reconnect is True
    finally:
        db.close()
