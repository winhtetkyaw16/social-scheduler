"""Facebook Page comments and post insights.

Endpoints from the Pages comments guide and the post insights guide:
GET/POST ``/{page-post-id}/comments``, POST ``/{comment-id}/comments``,
GET ``/{page-post-id}/insights``. Deprecated ``post_impressions*`` names are not requested.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from app.integrations.base import ProviderHTTPError
from app.integrations.media_urls import guess_media_kind
from app.services.engagement.base import (
    CAPABILITY_COMMENT_REPLY,
    CAPABILITY_COMMENTS_READ,
    CAPABILITY_HIDE_REPLY,
    CAPABILITY_INSIGHTS,
    EngagementCapabilities,
    EngagementProvider,
    ProviderComment,
    ProviderInsights,
    ProviderReply,
)
from app.services.engagement.http import collect_graph, request_json
from app.services.engagement.providers.meta_status import verify_meta_post
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
_VIDEO_INSIGHT_METRICS = (
    "total_video_views",
    "total_video_views_unique",
    "total_video_impressions",
    "total_video_reactions_by_type_total",
)
_VIDEO_PAGE_POST_FALLBACK_METRICS = ("post_media_view",)


def _version() -> str:
    return os.getenv("FACEBOOK_GRAPH_API_VERSION", "v21.0") or "v21.0"


def _graph(path: str) -> str:
    return f"https://graph.facebook.com/{_version()}/{path.lstrip('/')}"


class FacebookEngagement(EngagementProvider):
    """Read Page comments, reply as the Page, and read current post insight metrics."""

    network = "facebook"
    delete_scopes = ("pages_manage_engagement",)

    def delete_comment(self, account, comment) -> None:
        result = request_json("DELETE", _graph(comment.provider_comment_id), access_token=self.access_token(account))
        if result.get("success") is not True:
            raise RuntimeError("Facebook did not confirm comment deletion")
    capabilities = EngagementCapabilities(
        supports_comments_read=True,
        supports_comment_reply=True,
        supports_hide_reply=True,
        supports_insights=True,
        required_scopes={
            CAPABILITY_COMMENTS_READ: ("pages_read_user_content", "pages_read_engagement"),
            CAPABILITY_COMMENT_REPLY: ("pages_manage_engagement", "pages_read_user_content"),
            CAPABILITY_HIDE_REPLY: ("pages_manage_engagement",),
            CAPABILITY_INSIGHTS: (
                "read_insights",
                "pages_read_engagement",
                "pages_manage_engagement",
            ),
        },
        notes=(
            "Page token. Page posts use post_media_view and "
            "post_total_media_view_unique; videos use the Video Insights endpoint."
        ),
    )

    def verify_post(self, account, post) -> None:
        verify_meta_post(self.network, _graph, account, post, self.access_token(account))

    def hide_reply(self, account, comment, hidden: bool) -> None:
        comment_id = str(comment.provider_comment_id or "").strip()
        if not comment_id:
            raise ValueError("Facebook comment ID is missing")
        result = request_json(
            "POST",
            _graph(comment_id),
            access_token=self.access_token(account),
            json_body={"is_hidden": hidden},
        )
        if result.get("success") is not True:
            raise RuntimeError("Facebook did not confirm the comment visibility change")

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
        metadata = getattr(post, "post_metadata", None)
        metadata = metadata if isinstance(metadata, dict) else {}
        object_id = str(metadata.get("facebook_object_id") or "").strip()
        media_urls = getattr(post, "media_urls", None) or []
        object_type = str(metadata.get("facebook_object_type") or "").lower()
        format_name = str(metadata.get("format") or "").strip().casefold()
        is_video = object_type == "video" or any(
            guess_media_kind(url) == "video" for url in media_urls
        ) or format_name in {"reel", "video"}
        if not is_video and media_urls:
            # Older rows may have no Facebook object metadata and an opaque
            # media URL. Resolve attachments before the Page Post branch so a
            # video cannot silently take the normal multi-metric request.
            _, resolved_video_id = _resolve_video_ids(
                account, post, token, post_id, "", allow_untyped_attachment=False
            )
            if resolved_video_id:
                is_video = True
                object_id = resolved_video_id
        if is_video:
            page_post_id, video_id = _resolve_video_ids(
                account, post, token, post_id, object_id
            )
            if not video_id:
                if not page_post_id:
                    raise RuntimeError("Facebook did not return a video identifier")
                return _page_post_insights(
                    _request_page_post_insights(
                        token,
                        page_post_id,
                        metrics=_VIDEO_PAGE_POST_FALLBACK_METRICS,
                    ),
                    source="page_post_fallback",
                )
            try:
                body = request_json(
                    "GET",
                    _graph(f"{video_id}/video_insights"),
                    access_token=token,
                    params={"metric": ",".join(_VIDEO_INSIGHT_METRICS)},
                )
            except ProviderHTTPError as exc:
                if exc.status_code != 400:
                    raise
                # Some Graph API versions/accounts reject the Video Insights
                # edge; Page Post Insights can still return standard metrics.
                if not page_post_id:
                    raise exc
                try:
                    fallback = _request_page_post_insights(
                        token,
                        page_post_id,
                        metrics=_VIDEO_PAGE_POST_FALLBACK_METRICS,
                    )
                except ProviderHTTPError:
                    raise exc
                return _page_post_insights(fallback, source="page_post_fallback")
            insights = _video_insights(body)
            if any(
                value is not None
                for value in (
                    insights.impressions,
                    insights.reach,
                    insights.likes,
                    insights.video_views,
                )
            ):
                return insights
            if page_post_id:
                fallback = _request_page_post_insights(
                    token,
                    page_post_id,
                    metrics=_VIDEO_PAGE_POST_FALLBACK_METRICS,
                )
                return _page_post_insights(fallback, source="page_post_fallback")
            return insights
        try:
            body = _request_page_post_insights(token, post_id)
        except ProviderHTTPError as exc:
            if exc.status_code != 400 or not post_id:
                raise
            # Legacy photo publishing could save the Photo ID when Meta did
            # not include post_id. Resolve its Page story ID and retry once.
            try:
                photo = request_json(
                    "GET",
                    _graph(post_id),
                    access_token=token,
                    params={"fields": "page_story_id"},
                )
            except ProviderHTTPError:
                raise exc
            page_post_id = str(photo.get("page_story_id") or "").strip()
            if not page_post_id or page_post_id == post_id:
                raise exc
            body = _request_page_post_insights(token, page_post_id)
        return _page_post_insights(body)


def _request_page_post_insights(
    token: str, post_id: str, *, metrics: tuple[str, ...] = _INSIGHT_METRICS
) -> dict:
    return request_json(
        "GET",
        _graph(f"{post_id}/insights"),
        access_token=token,
        params={"metric": ",".join(metrics)},
    )


def _resolve_video_ids(
    account,
    post,
    token: str,
    post_id: str,
    object_id: str,
    *,
    allow_untyped_attachment: bool = True,
) -> tuple[str, str]:
    """Resolve legacy Facebook video posts without deprecated object_id fields.

    New publishes persist both IDs. Older rows may have stored a Video ID in
    provider_post_id, so inspect the Page Post attachment and, if necessary,
    match the row against the Page's supported published_posts edge.
    """
    if object_id:
        return post_id, object_id

    if post_id:
        try:
            page_post = request_json(
                "GET",
                _graph(post_id),
                access_token=token,
                params={"fields": "id,attachments{target}"},
            )
            page_id = str(page_post.get("id") or "").strip()
            video_id = _attachment_video_id(
                page_post,
                allow_untyped=allow_untyped_attachment,
            )
            if page_id and video_id:
                return page_id, video_id
        except ProviderHTTPError:
            pass

    page_account_id = str(getattr(account, "platform_account_id", "") or "").strip()
    content = " ".join(str(getattr(post, "content", "") or "").split()).casefold()
    if not page_account_id or not content:
        return post_id, ""
    try:
        body = request_json(
            "GET",
            _graph(f"{page_account_id}/published_posts"),
            access_token=token,
            params={
                "fields": "id,message,created_time,attachments{target}",
                "limit": "100",
            },
        )
    except ProviderHTTPError:
        return post_id, ""

    matches = []
    for item in body.get("data") or []:
        if not isinstance(item, dict):
            continue
        remote_content = " ".join(str(item.get("message") or "").split()).casefold()
        video_id = _attachment_video_id(
            item,
            allow_untyped=allow_untyped_attachment,
        )
        if remote_content == content and video_id:
            matches.append((item, video_id))
    if not matches:
        return post_id, ""

    published_at = getattr(post, "published_at", None)
    if published_at is not None and published_at.tzinfo is None:
        published_at = published_at.replace(tzinfo=timezone.utc)
    if published_at is not None and len(matches) > 1:
        matches.sort(
            key=lambda pair: abs(
                (_provider_time(pair[0].get("created_time")) or published_at)
                - published_at
            )
        )
    if len(matches) > 1:
        nearest = _provider_time(matches[0][0].get("created_time"))
        if (
            published_at is None
            or nearest is None
            or abs(nearest - published_at) > timedelta(days=2)
        ):
            return post_id, ""
    matched_post, video_id = matches[0]
    return str(matched_post.get("id") or post_id), video_id


def _attachment_video_id(post_body: dict, *, allow_untyped: bool = True) -> str:
    attachments = post_body.get("attachments")
    rows = attachments.get("data") if isinstance(attachments, dict) else []
    for item in rows or []:
        target = item.get("target") if isinstance(item, dict) else None
        if not isinstance(target, dict) or not target.get("id"):
            continue
        media_type = str(item.get("media_type") or item.get("type") or "").casefold()
        if media_type and "photo" in media_type:
            continue
        if media_type:
            if "video" not in media_type:
                continue
            return str(target["id"]).strip()
        if not allow_untyped:
            continue
        return str(target["id"]).strip()
    return ""


def _provider_time(value) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return (
        parsed.replace(tzinfo=timezone.utc)
        if parsed.tzinfo is None
        else parsed.astimezone(timezone.utc)
    )


def _page_post_insights(body: dict, *, source: str = "page_post") -> ProviderInsights:
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
        raw={"metrics": metrics, "source": source},
    )


def _video_insights(body: dict) -> ProviderInsights:
    metrics: dict[str, object] = {}
    for entry in body.get("data") or []:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("name") or "")
        if not name:
            continue
        values = entry.get("values") or []
        value = (
            values[0].get("value")
            if values and isinstance(values[0], dict)
            else None
        )
        metrics[name] = value
    reactions = metrics.get("total_video_reactions_by_type_total")
    likes = None
    if isinstance(reactions, dict):
        like_counts = [
            value
            for key, value in reactions.items()
            if key in {"like", "love", "wow", "haha", "sorry", "anger"}
            and isinstance(value, (int, float))
        ]
        likes = sum(like_counts) if like_counts else None
    return ProviderInsights(
        impressions=_metric_int(metrics.get("total_video_impressions")),
        reach=_metric_int(metrics.get("total_video_views_unique")),
        likes=likes,
        video_views=_metric_int(metrics.get("total_video_views")),
        raw={"metrics": metrics},
    )


def _metric_int(value) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    return None
