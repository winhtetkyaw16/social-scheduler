"""Instagram comments and media insights on the Facebook Login path.

Host is graph.facebook.com. Read ``GET /{ig-media-id}/comments`` (max 50, with replies
expanded). Reply ``POST /{ig-comment-id}/replies``. Insights use ``views``, not the
deprecated ``impressions`` metric.
"""

from __future__ import annotations

import os

from app.services.engagement.base import (
    CAPABILITY_COMMENT_REPLY,
    CAPABILITY_COMMENTS_READ,
    CAPABILITY_INSIGHTS,
    EngagementCapabilities,
    EngagementProvider,
    ProviderComment,
    ProviderInsights,
    ProviderReply,
)
from app.services.engagement.http import collect_graph, request_json
from app.services.engagement.parsing import insight_number, is_own_author, parse_time

_FIELDS = "id,text,username,timestamp,replies{id,text,username,timestamp}"
_METRICS = ("views", "reach", "likes", "comments", "saved", "shares")


def _version() -> str:
    return os.getenv("INSTAGRAM_GRAPH_API_VERSION", "v24.0") or "v24.0"


def _graph(path: str) -> str:
    return f"https://graph.facebook.com/{_version()}/{path.lstrip('/')}"


def _comment(account, row: dict, *, parent_id: str | None) -> ProviderComment | None:
    provider_id = str(row.get("id") or "").strip()
    if not provider_id:
        return None
    username = row.get("username") if isinstance(row.get("username"), str) else None
    return ProviderComment(
        provider_comment_id=provider_id,
        text=str(row.get("text") or ""),
        author_name=username,
        author_handle=username,
        created_at_provider=parse_time(row.get("timestamp")),
        provider_parent_id=parent_id,
        is_own=is_own_author(account, username),
        raw=row,
    )


class InstagramEngagement(EngagementProvider):
    """Instagram professional account comments, replies, and media insights."""

    network = "instagram"
    capabilities = EngagementCapabilities(
        supports_comments_read=True,
        supports_comment_reply=True,
        supports_insights=True,
        required_scopes={
            CAPABILITY_COMMENTS_READ: (
                "instagram_basic",
                "instagram_manage_comments",
                "pages_read_engagement",
            ),
            CAPABILITY_COMMENT_REPLY: ("instagram_manage_comments", "instagram_basic"),
            CAPABILITY_INSIGHTS: (
                "instagram_basic",
                "instagram_manage_insights",
                "pages_read_engagement",
            ),
        },
        notes="Facebook Login path. Insights request views, not deprecated impressions.",
    )

    def fetch_comments(self, account, post, since=None) -> list[ProviderComment]:
        token = self.access_token(account)
        media_id = str(post.provider_post_id or "").strip()
        rows = collect_graph(
            _graph(f"{media_id}/comments"),
            token,
            {"fields": _FIELDS, "limit": "50"},
        )
        comments: list[ProviderComment] = []
        for row in rows:
            parent = _comment(account, row, parent_id=None)
            if parent is None:
                continue
            comments.append(parent)
            replies = row.get("replies") if isinstance(row.get("replies"), dict) else {}
            for child in replies.get("data") or []:
                if not isinstance(child, dict):
                    continue
                item = _comment(account, child, parent_id=parent.provider_comment_id)
                if item is not None:
                    comments.append(item)
        return comments

    def reply_to_comment(self, account, comment, text: str) -> ProviderReply:
        token = self.access_token(account)
        comment_id = str(comment.provider_comment_id or "").strip()
        body = request_json(
            "POST",
            _graph(f"{comment_id}/replies"),
            access_token=token,
            data={"message": text},
        )
        reply_id = str(body.get("id") or "").strip()
        if not reply_id:
            raise RuntimeError("Instagram did not return a reply id")
        return ProviderReply(provider_comment_id=reply_id, raw=body)

    def fetch_insights(self, account, post) -> ProviderInsights:
        token = self.access_token(account)
        media_id = str(post.provider_post_id or "").strip()
        body = request_json(
            "GET",
            _graph(f"{media_id}/insights"),
            access_token=token,
            params={"metric": ",".join(_METRICS)},
        )
        metrics: dict[str, int] = {}
        for entry in body.get("data") or []:
            if not isinstance(entry, dict):
                continue
            name = str(entry.get("name") or "")
            number = insight_number(entry)
            if name and number is not None:
                metrics[name] = number
        # views replaced impressions. Store it as impressions and keep the official name in raw.
        return ProviderInsights(
            impressions=metrics.get("views"),
            reach=metrics.get("reach"),
            likes=metrics.get("likes"),
            comments=metrics.get("comments"),
            shares=metrics.get("shares"),
            saves=metrics.get("saved"),
            raw={"metrics": metrics},
        )
