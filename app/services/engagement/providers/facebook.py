"""Facebook Page comments and post insights.

Endpoints from the Pages comments guide and the post insights guide:
GET/POST ``/{page-post-id}/comments``, POST ``/{comment-id}/comments``,
GET ``/{page-post-id}/insights``. Deprecated ``post_impressions*`` names are not requested.
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

# Current names from the insights deprecation notes. Shares and saves were not verified.
_INSIGHT_METRICS = (
    "post_media_view",
    "post_total_media_view_unique",
    "post_reactions_like_total",
    "post_reactions_love_total",
    "post_reactions_wow_total",
)
_LIKE_METRICS = (
    "post_reactions_like_total",
    "post_reactions_love_total",
    "post_reactions_wow_total",
)


def _version() -> str:
    return os.getenv("FACEBOOK_GRAPH_API_VERSION", "v21.0") or "v21.0"


def _graph(path: str) -> str:
    return f"https://graph.facebook.com/{_version()}/{path.lstrip('/')}"


class FacebookEngagement(EngagementProvider):
    """Read Page comments, reply as the Page, and read current post insight metrics."""

    network = "facebook"
    capabilities = EngagementCapabilities(
        supports_comments_read=True,
        supports_comment_reply=True,
        supports_insights=True,
        required_scopes={
            CAPABILITY_COMMENTS_READ: ("pages_read_user_content", "pages_read_engagement"),
            CAPABILITY_COMMENT_REPLY: ("pages_manage_engagement", "pages_read_user_content"),
            CAPABILITY_INSIGHTS: ("read_insights", "pages_read_engagement"),
        },
        notes=(
            "Page token. Comments use filter=stream. Insights use post_media_view "
            "and post_total_media_view_unique, not deprecated post_impressions."
        ),
    )

    def fetch_comments(self, account, post, since=None) -> list[ProviderComment]:
        token = self.access_token(account)
        post_id = str(post.provider_post_id or "").strip()
        rows = collect_graph(
            _graph(f"{post_id}/comments"),
            token,
            {
                "fields": "id,from,message,created_time,parent,is_hidden",
                "filter": "stream",
                "limit": "50",
            },
        )
        comments: list[ProviderComment] = []
        for row in rows:
            provider_id = str(row.get("id") or "").strip()
            if not provider_id:
                continue
            author = row.get("from") if isinstance(row.get("from"), dict) else {}
            parent = row.get("parent") if isinstance(row.get("parent"), dict) else {}
            parent_id = str(parent.get("id") or "").strip() or None
            comments.append(
                ProviderComment(
                    provider_comment_id=provider_id,
                    text=str(row.get("message") or ""),
                    author_name=author.get("name") if isinstance(author.get("name"), str) else None,
                    author_provider_id=str(author.get("id") or "") or None,
                    created_at_provider=parse_time(row.get("created_time")),
                    provider_parent_id=parent_id,
                    is_own=is_own_author(account, author.get("id"), author.get("name")),
                    hidden=bool(row.get("is_hidden")),
                    raw=row,
                )
            )
        return comments

    def reply_to_comment(self, account, comment, text: str) -> ProviderReply:
        token = self.access_token(account)
        comment_id = str(comment.provider_comment_id or "").strip()
        body = request_json(
            "POST",
            _graph(f"{comment_id}/comments"),
            access_token=token,
            json_body={"message": text},
        )
        reply_id = str(body.get("id") or "").strip()
        if not reply_id:
            raise RuntimeError("Facebook did not return a comment id")
        return ProviderReply(provider_comment_id=reply_id, raw=body)

    def fetch_insights(self, account, post) -> ProviderInsights:
        token = self.access_token(account)
        post_id = str(post.provider_post_id or "").strip()
        body = request_json(
            "GET",
            _graph(f"{post_id}/insights"),
            access_token=token,
            params={"metric": ",".join(_INSIGHT_METRICS)},
        )
        metrics: dict[str, int] = {}
        for entry in body.get("data") or []:
            if not isinstance(entry, dict):
                continue
            name = str(entry.get("name") or "")
            number = insight_number(entry)
            if name and number is not None:
                metrics[name] = number
        likes = [metrics[name] for name in _LIKE_METRICS if name in metrics]
        return ProviderInsights(
            impressions=metrics.get("post_media_view"),
            reach=metrics.get("post_total_media_view_unique"),
            likes=sum(likes) if likes else None,
            raw={"metrics": metrics},
        )
