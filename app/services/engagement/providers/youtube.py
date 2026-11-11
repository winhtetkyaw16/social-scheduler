"""YouTube comments and per-video counts.

Comments use commentThreads.list and comments.insert with youtube.force-ssl.
When the account was granted yt-analytics.readonly, insights come from the
YouTube Analytics reports API. Otherwise they fall back to videos.list statistics
(viewCount, likeCount, commentCount).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

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
from app.services.engagement.http import request_json
from app.services.engagement.parsing import as_int, granted_scopes, is_own_author, parse_time
from app.services.oauth_scopes import YOUTUBE_ANALYTICS, YOUTUBE_FORCE_SSL, YOUTUBE_READONLY

DATA = "https://www.googleapis.com/youtube/v3"
ANALYTICS = "https://youtubeanalytics.googleapis.com/v2/reports"
_ANALYTICS_METRICS = ("views", "likes", "comments", "shares")


def _author_channel(snippet: dict) -> str | None:
    channel = snippet.get("authorChannelId")
    if isinstance(channel, dict):
        text = str(channel.get("value") or "").strip()
        return text or None
    if isinstance(channel, str) and channel.strip():
        return channel.strip()
    return None


def _from_snippet(account, comment_id: str, snippet: dict, *, parent_id: str | None) -> ProviderComment:
    channel_id = _author_channel(snippet)
    return ProviderComment(
        provider_comment_id=comment_id,
        text=str(snippet.get("textOriginal") or snippet.get("textDisplay") or ""),
        author_name=(
            snippet.get("authorDisplayName")
            if isinstance(snippet.get("authorDisplayName"), str)
            else None
        ),
        author_avatar_url=(
            snippet.get("authorProfileImageUrl")
            if isinstance(snippet.get("authorProfileImageUrl"), str)
            else None
        ),
        author_provider_id=channel_id,
        created_at_provider=parse_time(snippet.get("publishedAt")),
        provider_parent_id=parent_id,
        is_own=is_own_author(account, channel_id, snippet.get("authorDisplayName")),
        raw={"id": comment_id, "snippet": snippet},
    )


class YouTubeEngagement(EngagementProvider):
    """Comment threads, replies, and per-video counts."""

    network = "youtube"
    capabilities = EngagementCapabilities(
        supports_comments_read=True,
        supports_comment_reply=True,
        supports_insights=True,
        required_scopes={
            CAPABILITY_COMMENTS_READ: (YOUTUBE_FORCE_SSL,),
            CAPABILITY_COMMENT_REPLY: (YOUTUBE_FORCE_SSL,),
            CAPABILITY_INSIGHTS: (YOUTUBE_ANALYTICS, YOUTUBE_FORCE_SSL),
        },
        insights_fallback_scopes=(YOUTUBE_FORCE_SSL, YOUTUBE_READONLY),
    )

    def fetch_comments(self, account, post, since=None) -> list[ProviderComment]:
        token = self.access_token(account)
        video_id = str(post.provider_post_id or "").strip()
        params = {
            "part": "snippet,replies",
            "videoId": video_id,
            "maxResults": "100",
            "textFormat": "plainText",
        }
        comments: list[ProviderComment] = []
        seen: set[str] = set()
        for _ in range(5):
            body = request_json(
                "GET", f"{DATA}/commentThreads", access_token=token, params=params
            )
            for item in body.get("items") or []:
                if not isinstance(item, dict):
                    continue
                top = (item.get("snippet") or {}).get("topLevelComment") or {}
                if not isinstance(top, dict):
                    continue
                top_id = str(top.get("id") or "").strip()
                snippet = top.get("snippet") if isinstance(top.get("snippet"), dict) else {}
                if top_id:
                    comments.append(_from_snippet(account, top_id, snippet, parent_id=None))
                replies = item.get("replies") if isinstance(item.get("replies"), dict) else {}
                for reply in replies.get("comments") or []:
                    if not isinstance(reply, dict):
                        continue
                    reply_id = str(reply.get("id") or "").strip()
                    reply_snippet = (
                        reply.get("snippet") if isinstance(reply.get("snippet"), dict) else {}
                    )
                    parent = str(reply_snippet.get("parentId") or top_id or "").strip() or None
                    if reply_id:
                        comments.append(
                            _from_snippet(account, reply_id, reply_snippet, parent_id=parent)
                        )
            page = str(body.get("nextPageToken") or "").strip()
            if not page or page in seen or not body.get("items"):
                break
            seen.add(page)
            params["pageToken"] = page
        return comments

    def reply_to_comment(self, account, comment, text: str) -> ProviderReply:
        token = self.access_token(account)
        body = request_json(
            "POST",
            f"{DATA}/comments",
            access_token=token,
            params={"part": "snippet"},
            json_body={
                "snippet": {
                    "parentId": str(comment.provider_comment_id or "").strip(),
                    "textOriginal": text,
                }
            },
        )
        reply_id = str(body.get("id") or "").strip()
        if not reply_id:
            raise RuntimeError("YouTube did not return a comment id")
        return ProviderReply(provider_comment_id=reply_id, raw=body)

    def fetch_insights(self, account, post) -> ProviderInsights:
        if YOUTUBE_ANALYTICS in granted_scopes(account):
            try:
                return self._analytics(account, post)
            except Exception as exc:
                from app.services.engagement.base import CreditsRequired, ReconnectRequired

                if isinstance(exc, (ReconnectRequired, CreditsRequired)):
                    raise
        return self._statistics(account, post)

    def _analytics(self, account, post) -> ProviderInsights:
        token = self.access_token(account)
        video_id = str(post.provider_post_id or "").strip()
        end = datetime.now(timezone.utc).date()
        published = getattr(post, "published_at", None)
        if isinstance(published, datetime):
            if published.tzinfo is None:
                published = published.replace(tzinfo=timezone.utc)
            start = published.astimezone(timezone.utc).date()
        else:
            start = end - timedelta(days=365)
        if start > end:
            start = end
        body = request_json(
            "GET",
            ANALYTICS,
            access_token=token,
            params={
                "ids": "channel==MINE",
                "startDate": start.isoformat(),
                "endDate": end.isoformat(),
                "metrics": ",".join(_ANALYTICS_METRICS),
                "filters": f"video=={video_id}",
            },
        )
        headers = [
            str(item.get("name") or "")
            for item in (body.get("columnHeaders") or [])
            if isinstance(item, dict)
        ]
        rows = body.get("rows") if isinstance(body.get("rows"), list) else []
        values = rows[0] if rows and isinstance(rows[0], list) else []
        metrics = {
            name: as_int(values[index])
            for index, name in enumerate(headers)
            if index < len(values)
        }
        return ProviderInsights(
            video_views=metrics.get("views"),
            likes=metrics.get("likes"),
            comments=metrics.get("comments"),
            shares=metrics.get("shares"),
            raw={"source": "youtube_analytics", "metrics": metrics},
        )

    def _statistics(self, account, post) -> ProviderInsights:
        token = self.access_token(account)
        video_id = str(post.provider_post_id or "").strip()
        body = request_json(
            "GET",
            f"{DATA}/videos",
            access_token=token,
            params={"part": "statistics", "id": video_id},
        )
        items = body.get("items") if isinstance(body.get("items"), list) else []
        stats = {}
        if items and isinstance(items[0], dict):
            raw_stats = items[0].get("statistics")
            if isinstance(raw_stats, dict):
                stats = raw_stats
        return ProviderInsights(
            video_views=as_int(stats.get("viewCount")),
            likes=as_int(stats.get("likeCount")),
            comments=as_int(stats.get("commentCount")),
            raw={"source": "youtube_data_statistics", "statistics": stats},
        )
