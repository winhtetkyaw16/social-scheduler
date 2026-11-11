"""Networks whose comment or insight APIs are not available to this app."""

from __future__ import annotations

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
        token = self.access_token(account)
        video_id = str(post.provider_post_id or "").strip()
        body = request_json(
            "POST",
            QUERY_URL,
            access_token=token,
            params={"fields": _FIELDS},
            json_body={"filters": {"video_ids": [video_id]}},
        )
        data = body.get("data") if isinstance(body.get("data"), dict) else {}
        videos = data.get("videos") if isinstance(data.get("videos"), list) else []
        video = videos[0] if videos and isinstance(videos[0], dict) else {}
        return ProviderInsights(
            video_views=as_int(video.get("view_count")),
            likes=as_int(video.get("like_count")),
            comments=as_int(video.get("comment_count")),
            shares=as_int(video.get("share_count")),
            raw={"source": "tiktok_video_query", "video": video},
        )
