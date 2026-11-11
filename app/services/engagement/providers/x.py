"""X replies, public metrics, and hide.

Read replies with recent search ``conversation_id:{id} is:reply``.
Reply with ``POST /2/tweets`` and ``reply.in_reply_to_tweet_id``.
Insights use ``public_metrics`` on ``GET /2/tweets/{id}``.
Hide is ``PUT /2/tweets/{id}/hidden`` and needs ``tweet.moderate.write``.
A 402 or credits error is ``CreditsRequired``, not a reconnect.
"""

from __future__ import annotations

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
from app.services.engagement.http import request_json
from app.services.engagement.parsing import as_int, is_own_author, parse_time

API = "https://api.x.com/2"
_TWEET_FIELDS = "created_at,author_id,conversation_id,public_metrics,referenced_tweets"


def _users(body: dict) -> dict[str, dict]:
    includes = body.get("includes") if isinstance(body.get("includes"), dict) else {}
    users = includes.get("users") if isinstance(includes.get("users"), list) else []
    return {
        str(user.get("id")): user
        for user in users
        if isinstance(user, dict) and user.get("id") is not None
    }


def _parent_id(row: dict) -> str | None:
    refs = row.get("referenced_tweets")
    if not isinstance(refs, list):
        return None
    for item in refs:
        if isinstance(item, dict) and item.get("type") == "replied_to":
            text = str(item.get("id") or "").strip()
            return text or None
    return None


class XEngagement(EngagementProvider):
    """Read a post's replies, reply, hide a reply, and read public metrics."""

    network = "x"
    capabilities = EngagementCapabilities(
        supports_comments_read=True,
        supports_comment_reply=True,
        supports_insights=True,
        supports_hide_reply=True,
        required_scopes={
            CAPABILITY_COMMENTS_READ: ("tweet.read",),
            CAPABILITY_COMMENT_REPLY: ("tweet.write",),
            CAPABILITY_INSIGHTS: ("tweet.read",),
            CAPABILITY_HIDE_REPLY: ("tweet.moderate.write",),
        },
    )

    def fetch_comments(self, account, post, since=None) -> list[ProviderComment]:
        token = self.access_token(account)
        root_id = str(post.provider_post_id or "").strip()
        params = {
            "query": f"conversation_id:{root_id} is:reply",
            "max_results": "100",
            "tweet.fields": _TWEET_FIELDS,
            "expansions": "author_id",
            "user.fields": "name,username,profile_image_url",
        }
        comments: list[ProviderComment] = []
        seen_tokens: set[str] = set()
        for _ in range(5):
            body = request_json("GET", f"{API}/tweets/search/recent", access_token=token, params=params)
            users = _users(body)
            for row in body.get("data") or []:
                if not isinstance(row, dict):
                    continue
                provider_id = str(row.get("id") or "").strip()
                if not provider_id:
                    continue
                author = users.get(str(row.get("author_id") or ""), {})
                username = author.get("username") if isinstance(author.get("username"), str) else None
                comments.append(
                    ProviderComment(
                        provider_comment_id=provider_id,
                        text=str(row.get("text") or ""),
                        author_name=author.get("name") if isinstance(author.get("name"), str) else None,
                        author_handle=username,
                        author_avatar_url=(
                            author.get("profile_image_url")
                            if isinstance(author.get("profile_image_url"), str)
                            else None
                        ),
                        author_provider_id=str(row.get("author_id") or "") or None,
                        created_at_provider=parse_time(row.get("created_at")),
                        provider_parent_id=_parent_id(row),
                        provider_thread_root_id=str(row.get("conversation_id") or root_id),
                        is_own=is_own_author(account, row.get("author_id"), username),
                        raw=row,
                    )
                )
            meta = body.get("meta") if isinstance(body.get("meta"), dict) else {}
            next_token = str(meta.get("next_token") or "").strip()
            if not next_token or next_token in seen_tokens or not body.get("data"):
                break
            seen_tokens.add(next_token)
            params["next_token"] = next_token
        return comments

    def reply_to_comment(self, account, comment, text: str) -> ProviderReply:
        token = self.access_token(account)
        body = request_json(
            "POST",
            f"{API}/tweets",
            access_token=token,
            json_body={
                "text": text,
                "reply": {"in_reply_to_tweet_id": str(comment.provider_comment_id or "").strip()},
            },
        )
        data = body.get("data") if isinstance(body.get("data"), dict) else {}
        reply_id = str(data.get("id") or "").strip()
        if not reply_id:
            raise RuntimeError("X did not return a reply id")
        return ProviderReply(provider_comment_id=reply_id, raw=body)

    def hide_reply(self, account, comment, hidden: bool) -> None:
        token = self.access_token(account)
        tweet_id = str(comment.provider_comment_id or "").strip()
        request_json(
            "PUT",
            f"{API}/tweets/{tweet_id}/hidden",
            access_token=token,
            json_body={"hidden": bool(hidden)},
        )

    def fetch_insights(self, account, post) -> ProviderInsights:
        token = self.access_token(account)
        tweet_id = str(post.provider_post_id or "").strip()
        body = request_json(
            "GET",
            f"{API}/tweets/{tweet_id}",
            access_token=token,
            params={"tweet.fields": "public_metrics"},
        )
        data = body.get("data") if isinstance(body.get("data"), dict) else {}
        metrics = data.get("public_metrics") if isinstance(data.get("public_metrics"), dict) else {}
        return ProviderInsights(
            impressions=as_int(metrics.get("impression_count")),
            likes=as_int(metrics.get("like_count")),
            comments=as_int(metrics.get("reply_count")),
            shares=as_int(metrics.get("retweet_count")),
            saves=as_int(metrics.get("bookmark_count")),
            raw={"public_metrics": metrics},
        )
