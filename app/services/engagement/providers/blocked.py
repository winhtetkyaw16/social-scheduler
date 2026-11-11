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
from app.services.oauth_scopes import TIKTOK_VIDEO_LIST_SCOPE, tiktok_video_list_enabled

LINKEDIN_REASON = (
    "LinkedIn's Community Management API isn't approved for this app. "
    "Comments and post analytics need that product, and member comment read is restricted."
)
TIKTOK_COMMENT_REASON = "TikTok has no comment-text API for posting apps."
TIKTOK_INSIGHTS_OFF = (
    "TikTok video counts need video.list, which is not enabled in the TikTok console. "
    "Leave TIKTOK_ENABLE_VIDEO_LIST off until that scope is approved."
)

QUERY_URL = "https://open.tiktokapis.com/v2/video/query/"
_FIELDS = "id,like_count,comment_count,share_count,view_count"


class LinkedInEngagement(EngagementProvider):
    """Unsupported until Community Management is approved. No scope changes."""

    network = "linkedin"

    def __init__(self) -> None:
        self.capabilities = EngagementCapabilities(
            reasons={
                CAPABILITY_COMMENTS_READ: LINKEDIN_REASON,
                CAPABILITY_COMMENT_REPLY: LINKEDIN_REASON,
                CAPABILITY_INSIGHTS: LINKEDIN_REASON,
            }
        )


class TikTokEngagement(EngagementProvider):
    """Comments stay unsupported. Video-count insights run only behind the env flag."""

    network = "tiktok"

    def __init__(self) -> None:
        enabled = tiktok_video_list_enabled()
        reasons = {
            CAPABILITY_COMMENTS_READ: TIKTOK_COMMENT_REASON,
            CAPABILITY_COMMENT_REPLY: TIKTOK_COMMENT_REASON,
        }
        required: dict[str, tuple[str, ...]] = {}
        if enabled:
            required[CAPABILITY_INSIGHTS] = (TIKTOK_VIDEO_LIST_SCOPE,)
        else:
            reasons[CAPABILITY_INSIGHTS] = TIKTOK_INSIGHTS_OFF
        self.capabilities = EngagementCapabilities(
            supports_insights=enabled,
            required_scopes=required,
            reasons=reasons,
            notes=(
                "video.list is requested only when TIKTOK_ENABLE_VIDEO_LIST is true. "
                "That flag is off by default so connect keeps working."
            ),
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
