"""Networks whose comment or insight APIs are not available to this app."""

from __future__ import annotations

from urllib.parse import quote
from app.integrations.base import ProviderHTTPError
from app.integrations.platforms.linkedin import _headers as linkedin_headers
from app.services.engagement.base import PostStatusUnconfirmed, RemotePostDeleted

from app.services.engagement.base import (
    CAPABILITY_COMMENT_REPLY,
    CAPABILITY_COMMENTS_READ,
    CAPABILITY_INSIGHTS,
    EngagementCapabilities,
    EngagementProvider,
    NotSupported,
    ProviderInsights,
)
from app.services.engagement.http import request_json
from app.services.engagement.parsing import as_int
from app.services.engagement.copy import comments_unavailable, insights_unavailable
from app.services.oauth_scopes import TIKTOK_VIDEO_LIST_SCOPE, tiktok_video_list_enabled

# Product copy only. The technical reason (Community Management is not approved,
# and TikTok has no comment-text API for posting apps) stays in this comment and the PR.

QUERY_URL = "https://open.tiktokapis.com/v2/video/query/"
_FIELDS = "id,like_count,comment_count,share_count,view_count"


class LinkedInEngagement(EngagementProvider):
    """Unsupported until Community Management is approved. No scope changes."""

    network = "linkedin"

    def verify_post(self, account, post) -> None:
        if "r_member_social" not in (account.scopes or []):
            raise PostStatusUnconfirmed("Published (last known status).")
        token = self.access_token(account)
        urn = str(post.provider_post_id)
        try:
            body = request_json("GET", f"https://api.linkedin.com/rest/posts/{quote(urn, safe='')}",
                                access_token=token, extra_headers=linkedin_headers())
        except ProviderHTTPError as exc:
            if exc.status_code != 404:
                raise
            me = request_json("GET", "https://api.linkedin.com/v2/userinfo", access_token=token)
            if me.get("sub") and f"urn:li:person:{me['sub']}" == account.platform_account_id:
                raise RemotePostDeleted("linkedin") from None
            raise PostStatusUnconfirmed("LinkedIn could not verify the post owner.") from None
        if body.get("id") != urn or body.get("author") != account.platform_account_id:
            raise PostStatusUnconfirmed("LinkedIn could not verify this member post.")
        if body.get("lifecycleState") == "DELETED":
            raise RemotePostDeleted("linkedin")

    def __init__(self) -> None:
        self.capabilities = EngagementCapabilities(
            reasons={
                CAPABILITY_COMMENTS_READ: comments_unavailable("linkedin"),
                CAPABILITY_COMMENT_REPLY: comments_unavailable("linkedin"),
                CAPABILITY_INSIGHTS: insights_unavailable("linkedin"),
            }
        )


class TikTokEngagement(EngagementProvider):
    """Comments stay unsupported. Video-count insights run only behind the env flag."""

    network = "tiktok"

    def _video_ids(self, account, post):
        saved = str(post.provider_post_id)
        if saved.startswith(("inbox:", "v_", "p_")) or "~" in saved:
            body = request_json("POST", "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
                                access_token=self.access_token(account),
                                json_body={"publish_id": saved.removeprefix("inbox:")})
            data = body.get("data") or {}
            state = data.get("status")
            if state == "SEND_TO_USER_INBOX":
                raise PostStatusUnconfirmed("Sent to your TikTok inbox. Finish publishing in TikTok.")
            if state == "FAILED":
                raise PostStatusUnconfirmed("TikTok reports that this upload failed.")
            if state != "PUBLISH_COMPLETE":
                raise PostStatusUnconfirmed("TikTok has not confirmed publication yet.")
            ids = data.get("publicaly_available_post_id") or data.get("publicly_available_post_id")
            if not isinstance(ids, list) or not ids:
                raise PostStatusUnconfirmed("TikTok confirmed publication but has not returned a public post ID.")
            return [str(i) for i in ids]
        return [saved]

    def _videos(self, account, post, fields):
        ids = self._video_ids(account, post)
        if "video.list" not in (account.scopes or []):
            message = (
                "To check public videos, reconnect TikTok and allow access to your video list."
                if tiktok_video_list_enabled()
                else "SocialCastly can't check this video's status on TikTok right now. Open TikTok to check it."
            )
            raise PostStatusUnconfirmed(message)
        body = request_json("POST", QUERY_URL, access_token=self.access_token(account),
                            params={"fields": fields}, json_body={"filters": {"video_ids": ids}})
        videos = (body.get("data") or {}).get("videos") or []
        for video in videos:
            if isinstance(video, dict) and str(video.get("id")) in ids:
                return video
        raise PostStatusUnconfirmed("TikTok cannot see this video. It may be private or deleted.")

    def verify_post(self, account, post) -> None:
        # When insights are enabled the same manual sync calls fetch_insights,
        # which verifies the ID while retrieving metrics in one query.
        if not self.capabilities.supports_insights:
            self._videos(account, post, "id")

    def __init__(self) -> None:
        enabled = tiktok_video_list_enabled()
        reasons = {
            CAPABILITY_COMMENTS_READ: comments_unavailable("tiktok"),
            CAPABILITY_COMMENT_REPLY: comments_unavailable("tiktok"),
        }
        required: dict[str, tuple[str, ...]] = {}
        if enabled:
            required[CAPABILITY_INSIGHTS] = (TIKTOK_VIDEO_LIST_SCOPE,)
        else:
            # video.list is not enabled in the TikTok console. The flag stays off.
            reasons[CAPABILITY_INSIGHTS] = insights_unavailable("tiktok")
        self.capabilities = EngagementCapabilities(
            supports_insights=enabled,
            required_scopes=required,
            reasons=reasons,
        )

    def fetch_insights(self, account, post) -> ProviderInsights:
        if not tiktok_video_list_enabled():
            raise NotSupported(self.network, CAPABILITY_INSIGHTS)
        video = self._videos(account, post, _FIELDS)
        return ProviderInsights(
            video_views=as_int(video.get("view_count")),
            likes=as_int(video.get("like_count")),
            comments=as_int(video.get("comment_count")),
            shares=as_int(video.get("share_count")),
            raw={"source": "tiktok_video_query", "video": video},
        )
