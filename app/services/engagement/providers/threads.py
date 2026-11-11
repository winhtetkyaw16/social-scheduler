"""Threads replies and media insights.

Host from the current Threads docs: ``https://graph.threads.com/v1.0``.
Read ``GET /{threads-media-id}/replies``. Reply creates a text container with
``reply_to_id``, polls container status, then publishes it.
Insights: ``GET /{threads-media-id}/insights``.
"""

from __future__ import annotations

import os
import time

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
from app.services.engagement.parsing import insight_number, is_own_author, parse_time

_REPLY_FIELDS = "id,text,username,timestamp,permalink,hide_status,replied_to,is_reply"
_HIDDEN = {"HIDDEN", "COVERED", "BLOCKED", "RESTRICTED"}
_METRICS = ("views", "likes", "replies", "reposts", "quotes", "shares")


def _version() -> str:
    return os.getenv("THREADS_API_VERSION", "v1.0") or "v1.0"


def _base() -> str:
    return f"https://graph.threads.com/{_version()}"


def _replied_to_id(value) -> str | None:
    if isinstance(value, dict):
        text = str(value.get("id") or "").strip()
        return text or None
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


class ThreadsEngagement(EngagementProvider):
    """Read and publish Threads replies, and read media insights."""

    network = "threads"
    capabilities = EngagementCapabilities(
        supports_comments_read=True,
        supports_comment_reply=True,
        supports_insights=True,
        required_scopes={
            CAPABILITY_COMMENTS_READ: ("threads_basic", "threads_read_replies"),
            CAPABILITY_COMMENT_REPLY: (
                "threads_basic",
                "threads_content_publish",
                "threads_manage_replies",
            ),
            CAPABILITY_INSIGHTS: ("threads_basic", "threads_manage_insights"),
        },
        notes="Replies are top-level from /replies. Nested replies use replied_to when present.",
    )

    def fetch_comments(self, account, post, since=None) -> list[ProviderComment]:
        token = self.access_token(account)
        media_id = str(post.provider_post_id or "").strip()
        url = f"{_base()}/{media_id}/replies"
        params: dict[str, str] = {"fields": _REPLY_FIELDS, "limit": "50"}
        comments: list[ProviderComment] = []
        seen: set[str] = set()
        for _ in range(5):
            body = request_json("GET", url, access_token=token, params=params)
            for row in body.get("data") or []:
                if not isinstance(row, dict):
                    continue
                provider_id = str(row.get("id") or "").strip()
                if not provider_id:
                    continue
                username = row.get("username") if isinstance(row.get("username"), str) else None
                status = str(row.get("hide_status") or "").upper()
                comments.append(
                    ProviderComment(
                        provider_comment_id=provider_id,
                        text=str(row.get("text") or ""),
                        author_name=username,
                        author_handle=username,
                        created_at_provider=parse_time(row.get("timestamp")),
                        provider_parent_id=_replied_to_id(row.get("replied_to")),
                        provider_thread_root_id=media_id,
                        is_own=is_own_author(account, username),
                        hidden=status in _HIDDEN,
                        raw=row,
                    )
                )
            cursors = (body.get("paging") or {}).get("cursors") or {}
            after = cursors.get("after") if isinstance(cursors, dict) else None
            if not after or after in seen or not body.get("data"):
                break
            seen.add(str(after))
            params["after"] = str(after)
        return comments

    def reply_to_comment(self, account, comment, text: str) -> ProviderReply:
        token = self.access_token(account)
        user_id = str(account.platform_account_id or "").strip()
        created = request_json(
            "POST",
            f"{_base()}/me/threads",
            access_token=token,
            json_body={
                "media_type": "TEXT",
                "text": text,
                "reply_to_id": str(comment.provider_comment_id or "").strip(),
            },
        )
        creation_id = str(created.get("id") or "").strip()
        if not creation_id:
            raise RuntimeError("Threads did not return a reply container id")
        _wait_until_ready(token, creation_id)
        published = request_json(
            "POST",
            f"{_base()}/{user_id}/threads_publish",
            access_token=token,
            json_body={"creation_id": creation_id},
        )
        reply_id = str(published.get("id") or "").strip()
        if not reply_id:
            raise RuntimeError("Threads did not return a published reply id")
        return ProviderReply(provider_comment_id=reply_id, raw=published)

    def fetch_insights(self, account, post) -> ProviderInsights:
        token = self.access_token(account)
        media_id = str(post.provider_post_id or "").strip()
        body = request_json(
            "GET",
            f"{_base()}/{media_id}/insights",
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
        return ProviderInsights(
            impressions=metrics.get("views"),
            likes=metrics.get("likes"),
            comments=metrics.get("replies"),
            shares=metrics.get("shares"),
            raw={"metrics": metrics},
        )


def _wait_until_ready(access_token: str, creation_id: str) -> None:
    """Poll container status. A text reply is often FINISHED on the first check."""
    url = f"{_base()}/{creation_id}"
    for attempt in range(3):
        body = request_json(
            "GET",
            url,
            access_token=access_token,
            params={"fields": "status,error_message"},
        )
        state = str(body.get("status") or "").upper()
        if state in {"FINISHED", "PUBLISHED", "READY", ""}:
            return
        if state in {"ERROR", "EXPIRED"}:
            detail = body.get("error_message") or state
            raise RuntimeError(f"Threads could not prepare the reply ({detail})")
        if attempt < 2:
            time.sleep(1)
    raise RuntimeError("Threads is still preparing that reply. Try again in a moment.")
