"""Pinterest Pin analytics. v5 has no comments endpoint."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from app.services.engagement.base import (
    CAPABILITY_COMMENT_REPLY,
    CAPABILITY_COMMENTS_READ,
    CAPABILITY_INSIGHTS,
    EngagementCapabilities,
    EngagementProvider,
    ProviderInsights,
)
from app.services.engagement.http import request_json
from app.services.engagement.parsing import as_int

_COMMENT_REASON = (
    "Pinterest API v5 has no Pin comments endpoint. Analytics can return comment counts only."
)
_METRICS = (
    "IMPRESSION",
    "OUTBOUND_CLICK",
    "PIN_CLICK",
    "SAVE",
    "TOTAL_COMMENTS",
    "TOTAL_REACTIONS",
    "VIDEO_MRC_VIEW",
)


def _numbers(payload: dict) -> dict[str, int]:
    found: dict[str, int] = {}
    for key in ("lifetime_metrics", "summary_metrics"):
        block = payload.get(key)
        if not isinstance(block, dict):
            continue
        for name, value in block.items():
            number = as_int(value)
            if number is not None and name not in found:
                found[str(name)] = number
    return found


class PinterestEngagement(EngagementProvider):
    """Pin analytics only. Comment read and reply stay unsupported."""

    network = "pinterest"
    capabilities = EngagementCapabilities(
        supports_comments_read=False,
        supports_comment_reply=False,
        supports_insights=True,
        required_scopes={
            CAPABILITY_INSIGHTS: ("pins:read", "boards:read"),
        },
        reasons={
            CAPABILITY_COMMENTS_READ: _COMMENT_REASON,
            CAPABILITY_COMMENT_REPLY: _COMMENT_REASON,
        },
        notes="Uses the existing pins:read and boards:read scopes. No new Pinterest scope.",
    )

    def fetch_insights(self, account, post) -> ProviderInsights:
        token = self.access_token(account)
        pin_id = quote(str(post.provider_post_id or "").strip(), safe="")
        end = datetime.now(timezone.utc).date() - timedelta(days=1)
        start = end - timedelta(days=29)
        body = request_json(
            "GET",
            f"https://api.pinterest.com/v5/pins/{pin_id}/analytics",
            access_token=token,
            params={
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
                "metric_types": ",".join(_METRICS),
            },
        )
        metrics = _numbers(body)
        clicks = [
            metrics[name] for name in ("PIN_CLICK", "OUTBOUND_CLICK") if name in metrics
        ]
        return ProviderInsights(
            impressions=metrics.get("IMPRESSION"),
            saves=metrics.get("SAVE"),
            clicks=sum(clicks) if clicks else None,
            comments=metrics.get("TOTAL_COMMENTS"),
            likes=metrics.get("TOTAL_REACTIONS"),
            video_views=metrics.get("VIDEO_MRC_VIEW"),
            raw={"metrics": metrics},
        )
