"""Comments, insights, inbox, and the engagement sync. No real network calls."""

import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

import httpx
import pytest
from jose import jwt
from sqlalchemy import create_engine, func, inspect, select, text
from sqlalchemy.exc import IntegrityError

from app.core.config import ALGORITHM, SECRET_KEY
from app.db.session import SessionLocal
from app.models import ScheduledPost
from app.models.connected_account import ConnectedAccount
from app.models.engagement import PostComment, PostInsightsSnapshot
from app.services.engagement.base import (
    EngagementCapabilities,
    EngagementProvider,
    EngagementRetryableError,
    NotSupported,
    ProviderComment,
    ProviderInsights,
    ProviderReply,
    RemotePostDeleted,
    UnsupportedEngagementProvider,
)
from app.services.engagement.registry import canonical_network, supported_networks
from app.services.engagement.sync import upsert_comments
from app.tasks.celery_app import celery_app

ROOT = Path(__file__).resolve().parents[1]
NOW = datetime.now(timezone.utc)

COMMENT_COLUMNS = {
    "id",
    "created_at",
    "updated_at",
    "post_id",
    "social_account_id",
    "network",
    "provider_comment_id",
    "provider_post_id",
    "parent_comment_id",
    "provider_parent_id",
    "thread_root_id",
    "provider_thread_root_id",
    "author_name",
    "author_handle",
    "author_avatar_url",
    "author_provider_id",
    "text",
    "created_at_provider",
    "fetched_at",
    "is_read",
    "replied",
    "replied_at",
    "reply_provider_id",
    "is_own",
    "is_hidden",
    "is_deleted",
    "raw",
}
INSIGHT_COLUMNS = {
    "id",
    "created_at",
    "updated_at",
    "post_id",
    "social_account_id",
    "network",
    "captured_at",
    "impressions",
    "reach",
    "likes",
    "comments",
    "shares",
    "saves",
    "clicks",
    "video_views",
    "engagement_rate",
    "raw",
}


@pytest.fixture(autouse=True)
def _no_real_http(monkeypatch):
    """Provider and token code must not reach the network from these tests."""

    def boom(*args, **kwargs):
        raise AssertionError(f"unexpected HTTP call: {args[:2]}")

    monkeypatch.setattr(httpx, "request", boom)
    monkeypatch.setattr(httpx, "get", boom)
    monkeypatch.setattr(httpx, "post", boom)
    monkeypatch.setattr(httpx, "put", boom)
    monkeypatch.setattr(httpx, "delete", boom)


@pytest.fixture(autouse=True)
def _schema():
    from app.db.bootstrap import ensure_database_schema
    from app.db.session import engine

    ensure_database_schema(engine)


class FakeProvider(EngagementProvider):
    """In-memory network used to prove sync, reply, and capability gating."""

    def __init__(self, network, *, fail=False, scopes=None, only=None):
        self.network = network
        self.fail = fail
        self.only = set(only or [])
        self.calls = []
        required = scopes or {
            "comments_read": ("pages_read_engagement",),
            "comment_reply": ("pages_manage_engagement",),
            "insights": ("pages_read_engagement",),
        }
        self.capabilities = EngagementCapabilities(
            supports_comments_read=True,
            supports_comment_reply=True,
            supports_insights=True,
            required_scopes=required,
        )
        self.comments = [
            ProviderComment(
                provider_comment_id=f"{network}-root",
                text="Nice post",
                author_name="Ada",
                author_handle="ada",
                created_at_provider=NOW - timedelta(minutes=30),
                raw={"id": "root"},
            ),
            ProviderComment(
                provider_comment_id=f"{network}-child",
                text="Thanks",
                author_name="Grace",
                provider_parent_id=f"{network}-root",
                created_at_provider=NOW - timedelta(minutes=10),
                raw={"id": "child"},
            ),
        ]
        self.insights = ProviderInsights(
            impressions=100,
            likes=4,
            comments=2,
            engagement_rate=0.06,
            raw={"source": "fake"},
        )
        self.reply_id = f"{network}-our-reply"

    def _selected(self, account) -> bool:
        return not self.only or getattr(account, "id", None) in self.only

    def fetch_comments(self, account, post, since=None):
        if not self._selected(account):
            return []
        self.calls.append("comments")
        if self.fail:
            raise RuntimeError("provider down")
        return list(self.comments)

    def fetch_insights(self, account, post):
        if not self._selected(account):
            return None
        self.calls.append("insights")
        if self.fail:
            raise RuntimeError("provider down")
        return self.insights

    def reply_to_comment(self, account, comment, text):
        self.calls.append(("reply", text))
        if self.fail:
            raise RuntimeError("provider down")
        return ProviderReply(provider_comment_id=self.reply_id, raw={"text": text})


def _install(monkeypatch, providers: dict[str, EngagementProvider], *, unsupported_rest=False):
    from app.services.engagement import registry

    real = registry.get_engagement_provider

    def wrapped(name):
        key = canonical_network(name)
        if key in providers:
            return providers[key]
        if unsupported_rest:
            return UnsupportedEngagementProvider(key or "unknown")
        return real(name)

    monkeypatch.setattr(registry, "get_engagement_provider", wrapped)


def _user_id(headers) -> UUID:
    token = headers["Authorization"].split(" ", 1)[1]
    return UUID(jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])["sub"])


def _login(client, name="other"):
    email = f"{name}-{uuid4().hex[:8]}@example.com"
    password = "super-secret-password"
    registered = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": name,
            "workspace_name": "Other studio",
            "email": email,
            "password": password,
        },
    )
    assert registered.status_code == 201, registered.text
    logged = client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    assert logged.status_code == 200, logged.text
    return {"Authorization": f"Bearer {logged.json()['access_token']}"}


def _connect(client, headers, platform="facebook", scopes=None):
    body = {
        "platform": platform,
        "platform_account_id": f"{platform}-{uuid4().hex[:8]}",
        "account_name": f"{platform} page",
        "access_token": "test-access-token",
        "scopes": scopes or ["pages_show_list"],
    }
    if platform == "facebook":
        body["account_type"] = "page"
    created = client.post("/api/v1/accounts", headers=headers, json=body)
    assert created.status_code == 201, created.text
    return UUID(created.json()["id"])


def _legacy_account(user_id, platform, name):
    """Insert an account the connect API would reject, such as legacy ``twitter``."""
    db = SessionLocal()
    try:
        account = ConnectedAccount(
            user_id=user_id,
            platform=platform,
            platform_account_id=f"{platform}-{uuid4().hex[:8]}",
            account_name=name,
            account_type="user",
            access_token_ciphertext="test-access-token",
            scopes=[],
            is_active=True,
            needs_reconnect=False,
            extra_metadata={},
        )
        db.add(account)
        db.commit()
        return account.id
    finally:
        db.close()


def _published(
    user_id,
    account_id,
    *,
    days_ago=0,
    content="Hello world",
    provider_post_id=None,
    media_urls=None,
    published_at="default",
    status="published",
):
    when = datetime.now(timezone.utc) - timedelta(days=days_ago)
    db = SessionLocal()
    try:
        post = ScheduledPost(
            user_id=user_id,
            connected_account_id=account_id,
            content=content,
            media_urls=list(media_urls or []),
            scheduled_at=when,
            status=status,
            idempotency_key=uuid4().hex,
            provider_post_id=provider_post_id or uuid4().hex,
            published_at=when if published_at == "default" else published_at,
            post_metadata={},
        )
        db.add(post)
        db.commit()
        return post.id
    finally:
        db.close()


def _add_comment(
    post_id,
    account_id,
    *,
    text,
    network,
    minutes_ago,
    is_read=False,
    replied=False,
    is_own=False,
    author="Ada",
    deleted=False,
    parent_id=None,
):
    when = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    db = SessionLocal()
    try:
        row = PostComment(
            post_id=post_id,
            social_account_id=account_id,
            network=network,
            provider_comment_id=uuid4().hex,
            provider_post_id="provider-post",
            parent_comment_id=parent_id,
            author_name=author,
            text=text,
            created_at_provider=when,
            fetched_at=when,
            is_read=is_read,
            replied=replied,
            is_own=is_own,
            is_deleted=deleted,
            raw={},
        )
        db.add(row)
        db.commit()
        return row.id
    finally:
        db.close()


def _alembic(url: str, *args: str) -> None:
    env = os.environ.copy()
    env["DATABASE_URL"] = url
    subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=ROOT,
        env=env,
        check=True,
    )


def test_default_provider_raises_not_supported():
    provider = UnsupportedEngagementProvider("facebook")
    assert provider.capabilities.supports_comments_read is False
    assert provider.capabilities.supports_comment_reply is False
    assert provider.capabilities.supports_insights is False
    assert provider.capabilities.required_scopes == {}
    with pytest.raises(NotSupported):
        provider.fetch_comments(None, None, None)
    with pytest.raises(NotSupported):
        provider.reply_to_comment(None, None, "hi")
    with pytest.raises(NotSupported):
        provider.fetch_insights(None, None)


def test_registry_capability_matrix():
    from app.services.engagement.registry import get_engagement_provider

    assert supported_networks() == (
        "facebook",
        "instagram",
        "threads",
        "x",
        "linkedin",
        "youtube",
        "tiktok",
        "pinterest",
    )
    expected = {
        "facebook": (True, True, True, False),
        "instagram": (True, True, True, False),
        "threads": (True, True, True, False),
        "x": (False, False, False, False),
        "linkedin": (False, False, False, False),
        "youtube": (True, True, True, False),
        "tiktok": (False, False, False, False),
        "pinterest": (False, False, True, False),
    }
    for name, flags in expected.items():
        caps = get_engagement_provider(name).capabilities
        assert (
            caps.supports_comments_read,
            caps.supports_comment_reply,
            caps.supports_insights,
            caps.supports_hide_reply,
        ) == flags, name
    linkedin = get_engagement_provider("linkedin").capabilities
    assert linkedin.reasons["comments_read"] == (
        "Comments from LinkedIn aren't available in SocialCastly yet"
    )
    assert linkedin.reasons["insights"] == (
        "Insights from LinkedIn aren't available in SocialCastly yet"
    )
    tiktok = get_engagement_provider("tiktok").capabilities
    assert tiktok.reasons["comments_read"] == (
        "Comments from TikTok aren't available in SocialCastly yet"
    )
    assert tiktok.reasons["insights"] == (
        "Insights from TikTok aren't available in SocialCastly yet"
    )
    assert get_engagement_provider("Twitter").network == "x"
    x_caps = get_engagement_provider("x").capabilities
    assert x_caps.reasons["comments_read"] == (
        "Comments from X aren't available in SocialCastly yet"
    )
    assert x_caps.reasons["comment_reply"] == (
        "Comments from X aren't available in SocialCastly yet"
    )
    assert x_caps.reasons["insights"] == (
        "Insights from X aren't available in SocialCastly yet"
    )
    assert x_caps.reasons["hide_reply"] == (
        "Comments from X aren't available in SocialCastly yet"
    )


def test_x_engagement_is_refused_until_the_flag_is_on(client, auth_headers, monkeypatch):
    """ENGAGEMENT_X_ENABLED defaults off. Calls and capabilities stay closed."""
    from app.core.config import engagement_x_enabled
    from app.services.engagement.providers.x import XEngagement
    from app.services.engagement.registry import get_engagement_provider
    from app.services.engagement.sync import sync_posts
    monkeypatch.delenv("X_ENABLE_POST_STATUS", raising=False)

    monkeypatch.delenv("ENGAGEMENT_X_ENABLED", raising=False)
    assert engagement_x_enabled() is False
    for raw in ("", "false", "0", "no", "off"):
        monkeypatch.setenv("ENGAGEMENT_X_ENABLED", raw)
        assert engagement_x_enabled() is False, raw

    provider = XEngagement()
    with pytest.raises(NotSupported):
        provider.fetch_comments(None, None)
    with pytest.raises(NotSupported):
        provider.reply_to_comment(None, None, "hi")
    with pytest.raises(NotSupported):
        provider.hide_reply(None, None, True)
    with pytest.raises(NotSupported):
        provider.fetch_insights(None, None)

    headers, _ = auth_headers
    user_id = _user_id(headers)
    account_id = _connect(
        client,
        headers,
        "x",
        scopes=["tweet.read", "tweet.write", "tweet.moderate.write"],
    )
    post_id = _published(user_id, account_id)
    comment_id = _add_comment(post_id, account_id, text="Hi", network="x", minutes_ago=5)
    unavailable = "Comments from X aren't available in SocialCastly yet"

    reply = client.post(
        f"/api/v1/comments/{comment_id}/reply",
        headers=headers,
        json={"text": "Thanks"},
    )
    assert reply.status_code == 501, reply.text
    assert reply.json()["detail"] == unavailable

    hidden = client.post(
        f"/api/v1/comments/{comment_id}/hide",
        headers=headers,
        json={"hidden": True},
    )
    assert hidden.status_code == 501, hidden.text
    assert hidden.json()["detail"] == unavailable

    refreshed = client.post(f"/api/v1/posts/{post_id}/engagement/sync", headers=headers)
    assert refreshed.status_code == 501, refreshed.text
    assert refreshed.json()["detail"] == unavailable

    db = SessionLocal()
    try:
        post = db.get(ScheduledPost, post_id)
        summary = sync_posts(db, [post], force_insights=True)
    finally:
        db.close()
    assert summary["comments_upserted"] == 0
    assert summary["insights_captured"] == 0
    assert summary["errors"] == 0
    assert summary["credits"] == 0
    assert summary["skipped"] == 1

    caps = client.get("/api/v1/engagement/capabilities", headers=headers)
    assert caps.status_code == 200, caps.text
    matrix = caps.json()
    x_row = next(row for row in matrix["networks"] if row["network"] == "x")
    assert x_row["supports_comments_read"] is False
    assert x_row["supports_comment_reply"] is False
    assert x_row["supports_insights"] is False
    assert x_row["supports_hide_reply"] is False
    assert x_row["reasons"]["comments_read"] == unavailable
    assert x_row["reasons"]["insights"] == (
        "Insights from X aren't available in SocialCastly yet"
    )
    account = next(row for row in matrix["accounts"] if row["account_id"] == str(account_id))
    assert account["can_read_comments"] is False
    assert account["can_reply"] is False
    assert account["can_read_insights"] is False
    assert account["can_hide_reply"] is False
    assert account["supports_hide_reply"] is False

    for raw in ("1", "true", "yes", "on", "TRUE"):
        monkeypatch.setenv("ENGAGEMENT_X_ENABLED", raw)
        assert engagement_x_enabled() is True, raw
    enabled = get_engagement_provider("x").capabilities
    assert (
        enabled.supports_comments_read,
        enabled.supports_comment_reply,
        enabled.supports_insights,
        enabled.supports_hide_reply,
    ) == (True, True, True, True)
    opened = client.get("/api/v1/engagement/capabilities", headers=headers)
    opened_row = next(row for row in opened.json()["networks"] if row["network"] == "x")
    assert opened_row["supports_comments_read"] is True
    assert opened_row["supports_comment_reply"] is True
    assert opened_row["supports_insights"] is True
    assert opened_row["supports_hide_reply"] is True
    assert opened_row["reasons"] == {}


def test_alembic_head_is_the_engagement_revision():
    env = os.environ.copy()
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "heads"],
        cwd=ROOT,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    lines = [
        line.strip()
        for line in (result.stdout + "\n" + result.stderr).splitlines()
        if "(head)" in line
    ]
    assert lines == ["20261123_remote_post_sync_state (head)"]


def test_engagement_migration_upgrades_and_downgrades(tmp_path):
    database = tmp_path / "engagement.db"
    url = f"sqlite:///{database}"
    _alembic(url, "upgrade", "20261111_approval_decisions")
    engine = create_engine(url)
    assert "post_comments" not in inspect(engine).get_table_names()
    _alembic(url, "upgrade", "head")
    names = set(inspect(engine).get_table_names())
    assert {"post_comments", "post_insights_snapshots", "approval_decisions"} <= names
    comment_columns = {column["name"] for column in inspect(engine).get_columns("post_comments")}
    insight_columns = {
        column["name"] for column in inspect(engine).get_columns("post_insights_snapshots")
    }
    assert COMMENT_COLUMNS <= comment_columns
    assert INSIGHT_COLUMNS <= insight_columns
    unique = {item["name"] for item in inspect(engine).get_unique_constraints("post_comments")}
    assert "uq_post_comments_account_network_provider" in unique
    _alembic(url, "downgrade", "20261111_approval_decisions")
    left = set(inspect(engine).get_table_names())
    assert "post_comments" not in left
    assert "post_insights_snapshots" not in left
    assert "approval_decisions" in left
    _alembic(url, "upgrade", "head")
    assert "post_comments" in inspect(engine).get_table_names()


def test_bootstrap_creates_engagement_tables_without_the_new_migration(tmp_path):
    """Startup create_all adds the tables on a database that stopped at the previous head."""
    from app.db.bootstrap import ensure_database_schema

    database = tmp_path / "legacy.db"
    url = f"sqlite:///{database}"
    _alembic(url, "upgrade", "20261111_approval_decisions")
    engine = create_engine(url)
    assert "post_comments" not in inspect(engine).get_table_names()
    ensure_database_schema(engine)
    names = set(inspect(engine).get_table_names())
    assert "post_comments" in names
    assert "post_insights_snapshots" in names
    columns = {column["name"] for column in inspect(engine).get_columns("post_comments")}
    assert {"provider_comment_id", "is_read", "replied", "is_own", "raw"} <= columns


def test_upsert_is_idempotent_and_links_the_thread(client, auth_headers):
    headers, _ = auth_headers
    user_id = _user_id(headers)
    account_id = _connect(client, headers)
    post_id = _published(user_id, account_id)
    db = SessionLocal()
    try:
        account = db.get(ConnectedAccount, account_id)
        post = db.get(ScheduledPost, post_id)
        batch = [
            ProviderComment(
                provider_comment_id="c-root",
                text="First",
                author_name="Ada",
                created_at_provider=NOW - timedelta(hours=2),
            ),
            ProviderComment(
                provider_comment_id="c-child",
                text="Reply",
                provider_parent_id="c-root",
                provider_thread_root_id="c-root",
                created_at_provider=NOW - timedelta(hours=1),
            ),
        ]
        assert upsert_comments(db, post, account, batch) == 2
        db.commit()
        root = db.scalar(select(PostComment).where(PostComment.provider_comment_id == "c-root"))
        root.is_read = True
        root.replied = True
        db.commit()
        again = [
            ProviderComment(
                provider_comment_id="c-root",
                text="Edited",
                author_name="Ada Lovelace",
                created_at_provider=NOW - timedelta(hours=2),
            ),
            ProviderComment(
                provider_comment_id="c-child",
                text="Reply",
                provider_parent_id="c-root",
                provider_thread_root_id="c-root",
            ),
        ]
        assert upsert_comments(db, post, account, again) == 2
        db.commit()
        rows = list(
            db.scalars(
                select(PostComment).where(PostComment.social_account_id == account_id)
            ).all()
        )
        assert len(rows) == 2
        root = next(row for row in rows if row.provider_comment_id == "c-root")
        child = next(row for row in rows if row.provider_comment_id == "c-child")
        assert root.text == "Edited"
        assert root.author_name == "Ada Lovelace"
        assert root.is_read is True
        assert root.replied is True
        assert child.parent_comment_id == root.id
        assert child.thread_root_id == root.id
        duplicate = PostComment(
            post_id=post_id,
            social_account_id=account_id,
            network="facebook",
            provider_comment_id="c-root",
            provider_post_id="x",
            text="nope",
            fetched_at=NOW,
            raw={},
        )
        db.add(duplicate)
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
    finally:
        db.close()


def test_sync_upserts_throttles_insights_and_isolates_account_errors(client, auth_headers, monkeypatch):
    headers, _ = auth_headers
    user_id = _user_id(headers)
    facebook_id = _connect(client, headers, "facebook")
    instagram_id = _connect(client, headers, "instagram")
    recent = _published(user_id, facebook_id, content="Recent")
    old = _published(user_id, facebook_id, days_ago=45, content="Old")
    broken_post = _published(user_id, instagram_id, content="Broken")
    facebook = FakeProvider("facebook", only={facebook_id})
    instagram = FakeProvider("instagram", fail=True, only={instagram_id})
    _install(
        monkeypatch,
        {"facebook": facebook, "instagram": instagram},
        unsupported_rest=True,
    )
    monkeypatch.setenv("ENGAGEMENT_SYNC_LOOKBACK_DAYS", "30")

    from app.tasks.sync_engagement import sweep_engagement

    first = sweep_engagement()
    assert first["errors"] == 1
    assert first["comments_upserted"] == 2
    assert first["insights_captured"] == 1
    assert "comments" in facebook.calls
    assert "insights" in facebook.calls
    db = SessionLocal()
    try:
        stored = list(
            db.scalars(select(PostComment).where(PostComment.post_id == recent)).all()
        )
        assert {row.provider_comment_id for row in stored} == {"facebook-root", "facebook-child"}
        child = next(row for row in stored if row.provider_comment_id == "facebook-child")
        assert child.parent_comment_id is not None
        snapshots = list(
            db.scalars(
                select(PostInsightsSnapshot).where(PostInsightsSnapshot.post_id == recent)
            ).all()
        )
        assert len(snapshots) == 1
        assert snapshots[0].impressions == 100
        assert snapshots[0].saves is None
        assert (
            db.scalar(
                select(func.count()).select_from(PostComment).where(PostComment.post_id == old)
            )
            == 0
        )
        assert (
            db.scalar(
                select(func.count())
                .select_from(PostComment)
                .where(PostComment.post_id == broken_post)
            )
            == 0
        )
    finally:
        db.close()

    facebook.calls.clear()
    second = sweep_engagement()
    assert second["errors"] == 0
    assert second["insights_captured"] == 0
    assert "insights" not in facebook.calls
    db = SessionLocal()
    try:
        failed_post = db.get(ScheduledPost, broken_post)
        assert failed_post.engagement_sync_failures == 1
        assert failed_post.engagement_sync_retry_at is not None
        assert (
            db.scalar(
                select(func.count())
                .select_from(PostInsightsSnapshot)
                .where(PostInsightsSnapshot.post_id == recent)
            )
            == 1
        )
    finally:
        db.close()


def test_remote_deleted_post_is_persisted_and_excluded_from_later_sweeps(
    client, auth_headers, monkeypatch
):
    from app.schemas.post import PostRead
    from app.services.engagement.sync import posts_in_lookback

    headers, _ = auth_headers
    user_id = _user_id(headers)
    account_id = _connect(client, headers, "youtube")
    post_id = _published(user_id, account_id, provider_post_id="video-gone")

    class DeletedProvider(FakeProvider):
        def fetch_comments(self, account, post, since=None):
            self.calls.append("comments")
            raise RemotePostDeleted("youtube")

    provider = DeletedProvider("youtube", only={account_id})
    _install(monkeypatch, {"youtube": provider}, unsupported_rest=True)
    from app.tasks.sync_engagement import sweep_engagement

    first = sweep_engagement()
    assert first["errors"] == 0
    assert provider.calls == ["comments"]
    db = SessionLocal()
    try:
        post = db.get(ScheduledPost, post_id)
        assert post.remote_status == "deleted"
        assert post.remote_deleted_at is not None
        assert post.engagement_sync_failures == 0
        assert post.engagement_sync_retry_at is None
        assert post.attempt_count == 0
        response = PostRead.model_validate(post)
        assert response.remote_status == "deleted"
        assert response.remote_deleted_at is not None
        assert post_id not in {row.id for row in posts_in_lookback(db)}
    finally:
        db.close()

    second = sweep_engagement()
    assert second["errors"] == 0
    assert provider.calls == ["comments"]


def test_engagement_backoff_is_bounded_and_does_not_change_publish_attempts(
    client, auth_headers
):
    from app.services.engagement.sync import _record_engagement_retry

    headers, _ = auth_headers
    user_id = _user_id(headers)
    account_id = _connect(client, headers)
    post_id = _published(user_id, account_id)
    db = SessionLocal()
    try:
        post = db.get(ScheduledPost, post_id)
        post.attempt_count = 4
        post.engagement_sync_failures = 8
        db.commit()
        before = datetime.now(timezone.utc)
        _record_engagement_retry(db, post_id, RuntimeError("temporary provider error"))
        db.refresh(post)
        retry_at = post.engagement_sync_retry_at
        if retry_at.tzinfo is None:
            retry_at = retry_at.replace(tzinfo=timezone.utc)
        delay = retry_at - before
        assert timedelta(hours=23, minutes=59) < delay < timedelta(hours=24, minutes=1)
        assert post.engagement_sync_failures == 9
        assert post.attempt_count == 4

        before_retry_after = datetime.now(timezone.utc)
        _record_engagement_retry(
            db,
            post_id,
            EngagementRetryableError(
                "rate limited", category="rate_limit", retry_after_seconds=10**9
            ),
        )
        db.refresh(post)
        retry_at = post.engagement_sync_retry_at
        if retry_at.tzinfo is None:
            retry_at = retry_at.replace(tzinfo=timezone.utc)
        retry_after_delay = retry_at - before_retry_after
        assert timedelta(days=6, hours=23) < retry_after_delay < timedelta(days=7, minutes=1)
        assert post.engagement_sync_failures == 10
        assert post.engagement_sync_error_code == "rate_limit"
        assert post.attempt_count == 4
    finally:
        db.close()


def test_sync_skips_reconnect_without_calling_the_provider(client, auth_headers, monkeypatch):
    headers, _ = auth_headers
    user_id = _user_id(headers)
    account_id = _connect(client, headers)
    _published(user_id, account_id)
    provider = FakeProvider("facebook", only={account_id})
    _install(monkeypatch, {"facebook": provider}, unsupported_rest=True)
    db = SessionLocal()
    try:
        account = db.get(ConnectedAccount, account_id)
        account.needs_reconnect = True
        account.reconnect_reason = "Reconnect Facebook before scheduled posts can keep publishing."
        db.commit()
    finally:
        db.close()
    from app.tasks.sync_engagement import sweep_engagement

    summary = sweep_engagement()
    assert summary["reconnects"] >= 1
    assert summary["errors"] == 0
    assert provider.calls == []


def test_beat_and_inprocess_scheduler_register_engagement_sync(monkeypatch):
    job = celery_app.conf.beat_schedule["sync-post-engagement"]
    assert job["task"] == "app.tasks.sync_engagement.sync_engagement"
    assert job["schedule"] == 900

    import app.tasks.inprocess_scheduler as scheduler

    calls = []
    monkeypatch.setattr(
        "app.tasks.sync_engagement.sweep_engagement",
        lambda: calls.append("sync") or {"posts_synced": 3},
    )
    scheduler._last_engagement_sync_at = None
    assert scheduler.maybe_sync_engagement() == 3
    assert calls == ["sync"]
    assert scheduler.maybe_sync_engagement() == 0
    assert calls == ["sync"]
    scheduler._last_engagement_sync_at = None


def test_endpoints_require_auth_and_hide_other_users(client, auth_headers):
    headers, _ = auth_headers
    other = _login(client)
    user_id = _user_id(headers)
    account_id = _connect(client, headers)
    post_id = _published(user_id, account_id)
    comment_id = _add_comment(
        post_id,
        account_id,
        text="Hello",
        network="facebook",
        minutes_ago=5,
    )
    missing = "00000000-0000-0000-0000-000000000099"
    unauthenticated = [
        ("GET", f"/api/v1/posts/{post_id}/comments"),
        ("GET", "/api/v1/inbox"),
        ("GET", "/api/v1/inbox/posts"),
        ("POST", f"/api/v1/comments/{comment_id}/reply"),
        ("POST", f"/api/v1/comments/{comment_id}/read"),
        ("POST", "/api/v1/comments/read"),
        ("GET", f"/api/v1/posts/{post_id}/insights"),
        ("GET", "/api/v1/engagement/capabilities"),
        ("POST", f"/api/v1/posts/{post_id}/engagement/sync"),
    ]
    for method, path in unauthenticated:
        response = client.request(method, path)
        assert response.status_code == 401, (method, path, response.status_code)

    for method, path in (
        ("GET", f"/api/v1/posts/{post_id}/comments"),
        ("GET", f"/api/v1/posts/{post_id}/insights"),
        ("POST", f"/api/v1/posts/{post_id}/engagement/sync"),
        ("POST", f"/api/v1/comments/{comment_id}/reply"),
        ("POST", f"/api/v1/comments/{comment_id}/read"),
    ):
        response = client.request(
            method,
            path,
            headers=other,
            json={"text": "nope"} if method == "POST" and path.endswith("/reply") else None,
        )
        assert response.status_code == 404, (method, path, response.text)

    bulk = client.post(
        "/api/v1/comments/read",
        headers=other,
        json={"comment_ids": [str(comment_id)]},
    )
    assert bulk.status_code == 404
    missing_post = client.get(f"/api/v1/posts/{missing}/comments", headers=headers)
    assert missing_post.status_code == 404


def test_inbox_filters_pagination_and_read_state(client, auth_headers):
    headers, _ = auth_headers
    user_id = _user_id(headers)
    facebook = _connect(client, headers, "facebook")
    instagram = _connect(client, headers, "instagram")
    fb_post = _published(user_id, facebook, content="Facebook launch post")
    ig_post = _published(user_id, instagram, content="Instagram photo")
    newest = _add_comment(
        fb_post, facebook, text="Newest unread", network="facebook", minutes_ago=1, author="Ada"
    )
    middle = _add_comment(
        ig_post,
        instagram,
        text="Needs a reply",
        network="instagram",
        minutes_ago=10,
        author="Grace",
    )
    replied = _add_comment(
        fb_post,
        facebook,
        text="Already answered",
        network="facebook",
        minutes_ago=20,
        is_read=True,
        replied=True,
    )
    _add_comment(
        fb_post,
        facebook,
        text="Gone",
        network="facebook",
        minutes_ago=2,
        deleted=True,
    )
    own = _add_comment(
        fb_post,
        facebook,
        text="Our own note",
        network="facebook",
        minutes_ago=3,
        is_own=True,
        is_read=True,
        parent_id=replied,
    )

    everything = client.get("/api/v1/inbox", headers=headers)
    assert everything.status_code == 200, everything.text
    body = everything.json()
    ids = [item["id"] for item in body["items"]]
    assert str(own) not in ids
    assert ids == [str(newest), str(middle), str(replied)]
    assert all(item["text"] != "Gone" for item in body["items"])
    assert all(not item["is_own"] for item in body["items"])
    replied_row = next(item for item in body["items"] if item["id"] == str(replied))
    assert replied_row["replied"] is True
    assert next(item for item in body["items"] if item["id"] == str(newest))["replied"] is False
    assert body["unread_count"] == 2
    assert body["unread_by_network"]["facebook"] == 1
    assert body["unread_by_network"]["instagram"] == 1
    assert all(item["kind"] == "comment" for item in body["items"])
    assert body["counts"] == {"all": 3, "unread": 2, "unreplied": 2, "replied": 1}

    unread = client.get("/api/v1/inbox?status=unread", headers=headers)
    unread_ids = {item["id"] for item in unread.json()["items"]}
    assert str(newest) in unread_ids
    assert str(middle) in unread_ids
    assert str(replied) not in unread_ids

    unreplied = client.get("/api/v1/inbox?status=unreplied&network=instagram", headers=headers)
    unreplied_body = unreplied.json()
    assert [item["id"] for item in unreplied_body["items"]] == [str(middle)]
    assert unreplied_body["items"][0]["account_name"]
    assert "Instagram" in unreplied_body["items"][0]["post_excerpt"]

    found = client.get("/api/v1/inbox?search=ada&status=all", headers=headers)
    found_items = found.json()["items"]
    assert any(item["id"] == str(newest) for item in found_items)
    assert found_items
    assert all(
        "ada" in (item["author_name"] or "").lower() or "ada" in item["text"].lower()
        for item in found_items
    )

    page = client.get(
        f"/api/v1/inbox?account_id={facebook}&limit=1&offset=0", headers=headers
    )
    assert page.status_code == 200
    assert len(page.json()["items"]) == 1
    assert page.json()["total"] == 2

    one = client.post(f"/api/v1/comments/{newest}/read", headers=headers)
    assert one.status_code == 200, one.text
    assert one.json()["is_read"] is True
    again = client.post(f"/api/v1/comments/{newest}/read", headers=headers)
    assert again.status_code == 200

    mixed = client.post(
        "/api/v1/comments/read",
        headers=headers,
        json={"comment_ids": [str(middle), str(uuid4())]},
    )
    assert mixed.status_code == 404
    still = client.get("/api/v1/inbox?status=unread&network=instagram", headers=headers)
    assert any(item["id"] == str(middle) for item in still.json()["items"])

    marked = client.post(
        "/api/v1/comments/read",
        headers=headers,
        json={"all_matching": True, "network": "instagram", "status": "unread"},
    )
    assert marked.status_code == 200, marked.text
    assert marked.json()["updated"] >= 1
    after = client.get("/api/v1/inbox?status=unread&network=instagram", headers=headers)
    assert after.json()["items"] == []

    empty = client.post("/api/v1/comments/read", headers=headers, json={})
    assert empty.status_code == 422

    unread_again = client.post(f"/api/v1/comments/{newest}/unread", headers=headers)
    assert unread_again.status_code == 200, unread_again.text
    assert unread_again.json()["is_read"] is False
    missing_unread = client.post(f"/api/v1/comments/{uuid4()}/unread", headers=headers)
    assert missing_unread.status_code == 404


def test_reply_is_gated_then_stores_our_reply(client, auth_headers, monkeypatch):
    headers, _ = auth_headers
    user_id = _user_id(headers)
    account_id = _connect(client, headers)
    post_id = _published(user_id, account_id)
    comment_id = _add_comment(
        post_id, account_id, text="Question?", network="facebook", minutes_ago=4
    )
    linkedin_id = _connect(client, headers, "linkedin")
    linkedin_post = _published(user_id, linkedin_id)
    linkedin_comment = _add_comment(
        linkedin_post, linkedin_id, text="Hi", network="linkedin", minutes_ago=1
    )
    blocked = client.post(
        f"/api/v1/comments/{linkedin_comment}/reply",
        headers=headers,
        json={"text": "On it"},
    )
    assert blocked.status_code == 501, blocked.text
    assert blocked.json()["detail"] == (
        "Comments from LinkedIn aren't available in SocialCastly yet"
    )

    provider = FakeProvider("facebook")
    _install(monkeypatch, {"facebook": provider})
    db = SessionLocal()
    try:
        account = db.get(ConnectedAccount, account_id)
        account.needs_reconnect = True
        account.reconnect_reason = "Reconnect Facebook to reply."
        db.commit()
    finally:
        db.close()
    reconnect = client.post(
        f"/api/v1/comments/{comment_id}/reply",
        headers=headers,
        json={"text": "On it"},
    )
    assert reconnect.status_code == 409, reconnect.text
    assert "Reconnect Facebook" in reconnect.json()["detail"]
    assert provider.calls == []

    db = SessionLocal()
    try:
        account = db.get(ConnectedAccount, account_id)
        account.needs_reconnect = False
        account.reconnect_reason = None
        db.commit()
    finally:
        db.close()
    sent = client.post(
        f"/api/v1/comments/{comment_id}/reply",
        headers=headers,
        json={"text": "  On it  "},
    )
    assert sent.status_code == 200, sent.text
    body = sent.json()
    assert body["parent"]["replied"] is True
    assert body["parent"]["reply_provider_id"] == "facebook-our-reply"
    assert body["reply"]["is_own"] is True
    assert body["reply"]["text"] == "On it"
    assert body["reply"]["parent_comment_id"] == str(comment_id)
    assert provider.calls[-1] == ("reply", "On it")

    thread = client.get(f"/api/v1/posts/{post_id}/comments", headers=headers)
    assert thread.status_code == 200, thread.text
    roots = thread.json()["comments"]
    assert len(roots) == 1
    assert roots[0]["id"] == str(comment_id)
    assert roots[0]["replies"][0]["is_own"] is True


def test_insights_and_manual_sync(client, auth_headers, monkeypatch):
    headers, _ = auth_headers
    user_id = _user_id(headers)
    account_id = _connect(client, headers, scopes=["pages_manage_engagement"])
    post_id = _published(user_id, account_id)
    draft = _published(user_id, account_id)
    db = SessionLocal()
    try:
        post = db.get(ScheduledPost, draft)
        post.status = "draft"
        post.provider_post_id = None
        post.published_at = None
        db.commit()
    finally:
        db.close()

    empty = client.get(f"/api/v1/posts/{post_id}/insights", headers=headers)
    assert empty.status_code == 200, empty.text
    assert empty.json()["latest"] is None
    assert empty.json()["history"] == []

    refused = client.post(f"/api/v1/posts/{draft}/engagement/sync", headers=headers)
    assert refused.status_code == 409

    provider = FakeProvider("facebook")
    _install(monkeypatch, {"facebook": provider})
    refreshed = client.post(f"/api/v1/posts/{post_id}/engagement/sync", headers=headers)
    assert refreshed.status_code == 200, refreshed.text
    assert refreshed.json()["comments_upserted"] == 2
    assert refreshed.json()["insights_captured"] is True
    again = client.post(f"/api/v1/posts/{post_id}/engagement/sync", headers=headers)
    assert again.status_code == 200, again.text
    assert again.json()["insights_captured"] is True

    history = client.get(f"/api/v1/posts/{post_id}/insights", headers=headers)
    assert history.status_code == 200, history.text
    payload = history.json()
    assert payload["latest"]["impressions"] == 100
    assert payload["latest"]["saves"] is None
    assert len(payload["history"]) == 2
    assert "raw" not in payload["latest"]

    caps = client.get("/api/v1/engagement/capabilities", headers=headers)
    assert caps.status_code == 200, caps.text
    matrix = caps.json()
    by_network = {row["network"]: row for row in matrix["networks"]}
    assert set(by_network) == set(supported_networks())
    assert by_network["linkedin"]["supports_comments_read"] is False
    assert by_network["linkedin"]["reasons"]["comments_read"] == (
        "Comments from LinkedIn aren't available in SocialCastly yet"
    )
    assert by_network["tiktok"]["reasons"]["comments_read"] == (
        "Comments from TikTok aren't available in SocialCastly yet"
    )
    facebook = next(row for row in matrix["accounts"] if row["account_id"] == str(account_id))
    assert facebook["supports_comment_reply"] is True
    assert facebook["can_reply"] is True
    assert facebook["can_read_comments"] is False
    assert facebook["can_read_insights"] is False
    assert facebook["reconnect_for_permissions"] is True
    assert facebook["message"] == "Reconnect your Facebook account to see comments and insights"
    assert "pages_read_engagement" in facebook["missing_scopes"]["comments_read"]


def test_manual_sync_bypasses_sweep_lookback_and_retry_backoff(
    client, auth_headers, monkeypatch
):
    headers, _ = auth_headers
    user_id = _user_id(headers)
    account_id = _connect(client, headers, "youtube")
    post_id = _published(user_id, account_id, provider_post_id="video-gone")
    db = SessionLocal()
    try:
        post = db.get(ScheduledPost, post_id)
        post.published_at = datetime.now(timezone.utc) - timedelta(days=90)
        post.engagement_sync_retry_at = datetime.now(timezone.utc) + timedelta(days=2)
        post.engagement_sync_failures = 3
        db.commit()
    finally:
        db.close()

    class DeletedProvider(FakeProvider):
        def fetch_comments(self, account, post, since=None):
            self.calls.append("comments")
            raise RemotePostDeleted("youtube")

    provider = DeletedProvider("youtube", only={account_id})
    _install(monkeypatch, {"youtube": provider}, unsupported_rest=True)
    response = client.post(
        f"/api/v1/posts/{post_id}/engagement/sync", headers=headers
    )

    assert response.status_code == 410
    assert provider.calls == ["comments"]
    db = SessionLocal()
    try:
        post = db.get(ScheduledPost, post_id)
        assert post.remote_status == "deleted"
        assert post.remote_deleted_at is not None
        assert post.engagement_sync_failures == 0
        assert post.engagement_sync_retry_at is None
    finally:
        db.close()


def test_threaded_comments_endpoint_orders_replies(client, auth_headers):
    headers, _ = auth_headers
    user_id = _user_id(headers)
    account_id = _connect(client, headers)
    post_id = _published(user_id, account_id)
    db = SessionLocal()
    try:
        root = PostComment(
            post_id=post_id,
            social_account_id=account_id,
            network="facebook",
            provider_comment_id="root",
            provider_post_id="p",
            text="Root",
            created_at_provider=NOW - timedelta(hours=2),
            fetched_at=NOW,
            raw={},
        )
        db.add(root)
        db.flush()
        child = PostComment(
            post_id=post_id,
            social_account_id=account_id,
            network="facebook",
            provider_comment_id="child",
            provider_post_id="p",
            parent_comment_id=root.id,
            thread_root_id=root.id,
            text="Child",
            created_at_provider=NOW - timedelta(hours=1),
            fetched_at=NOW,
            raw={},
        )
        db.add(child)
        db.commit()
    finally:
        db.close()
    response = client.get(f"/api/v1/posts/{post_id}/comments", headers=headers)
    assert response.status_code == 200, response.text
    comments = response.json()["comments"]
    assert len(comments) == 1
    assert comments[0]["text"] == "Root"
    assert comments[0]["replies"][0]["text"] == "Child"


def test_migration_inserts_round_trip_metrics(tmp_path):
    """A migrated database accepts a comment and a snapshot with null metrics."""
    database = tmp_path / "rows.db"
    url = f"sqlite:///{database}"
    _alembic(url, "upgrade", "head")
    engine = create_engine(url)
    user_id = str(uuid4())
    account_id = str(uuid4())
    post_id = str(uuid4())
    now = datetime.now(timezone.utc).isoformat()
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO users (id, email, full_name, workspace_name, password_hash, "
                "is_active, is_verified, created_at, updated_at) "
                "VALUES (:id, :email, 'Win', 'Studio', 'hash', 1, 0, :now, :now)"
            ),
            {"id": user_id, "email": f"{uuid4().hex[:8]}@example.com", "now": now},
        )
        conn.execute(
            text(
                "INSERT INTO connected_accounts ("
                "id, user_id, platform, platform_account_id, account_name, account_type, "
                "access_token_ciphertext, scopes, is_active, extra_metadata, created_at, updated_at"
                ") VALUES ("
                ":id, :user_id, 'facebook', 'page-1', 'Page', 'page', 'cipher', '[]', 1, '{}', :now, :now)"
            ),
            {"id": account_id, "user_id": user_id, "now": now},
        )
        conn.execute(
            text(
                "INSERT INTO scheduled_posts ("
                "id, user_id, connected_account_id, content, media_urls, scheduled_at, status, "
                "attempt_count, max_attempts, idempotency_key, provider_post_id, published_at, "
                "metadata, created_at, updated_at"
                ") VALUES ("
                ":id, :user_id, :account_id, 'Hi', '[]', :now, 'published', 1, 5, :key, "
                "'prov', :now, '{}', :now, :now)"
            ),
            {
                "id": post_id,
                "user_id": user_id,
                "account_id": account_id,
                "now": now,
                "key": uuid4().hex,
            },
        )
        conn.execute(
            text(
                "INSERT INTO post_comments ("
                "id, post_id, social_account_id, network, provider_comment_id, provider_post_id, "
                "text, fetched_at, raw, created_at, updated_at"
                ") VALUES ("
                ":id, :post_id, :account_id, 'facebook', 'c1', 'prov', 'Hello', :now, '{}', :now, :now)"
            ),
            {"id": str(uuid4()), "post_id": post_id, "account_id": account_id, "now": now},
        )
        conn.execute(
            text(
                "INSERT INTO post_insights_snapshots ("
                "id, post_id, social_account_id, network, captured_at, impressions, raw, "
                "created_at, updated_at"
                ") VALUES ("
                ":id, :post_id, :account_id, 'facebook', :now, 12, '{}', :now, :now)"
            ),
            {"id": str(uuid4()), "post_id": post_id, "account_id": account_id, "now": now},
        )
    with engine.connect() as conn:
        comment = conn.execute(text("SELECT text, is_read FROM post_comments")).one()
        snapshot = conn.execute(
            text("SELECT impressions, likes, saves FROM post_insights_snapshots")
        ).one()
    assert comment.text == "Hello"
    assert comment.is_read in (0, False)
    assert snapshot.impressions == 12
    assert snapshot.likes is None
    assert snapshot.saves is None


def test_inbox_posts_include_posts_with_no_comments(client, auth_headers, monkeypatch):
    """Published inbox posts show up with totals, even when nobody has commented."""
    headers, _ = auth_headers
    other = _login(client)
    user_id = _user_id(headers)
    other_id = _user_id(other)
    instagram = _connect(client, headers, "instagram")
    facebook = _connect(client, headers, "facebook")
    youtube = _connect(client, headers, "youtube")
    linkedin = _connect(client, headers, "linkedin")
    tiktok = _connect(client, headers, "tiktok")
    x_account = _connect(client, headers, "x")
    twitter = _legacy_account(user_id, "twitter", "Legacy bird")
    other_ig = _connect(client, other, "instagram")

    newest = _published(
        user_id,
        instagram,
        days_ago=0,
        content="Latte art this morning",
        media_urls=["https://cdn.example/latte.jpg", "https://cdn.example/second.jpg"],
    )
    quiet = _published(
        user_id,
        facebook,
        days_ago=1,
        content="A quiet Facebook note",
        published_at=None,
    )
    older = _published(user_id, youtube, days_ago=3, content="Studio tour")
    _published(user_id, linkedin, days_ago=0, content="LinkedIn update")
    _published(user_id, tiktok, days_ago=0, content="TikTok clip")
    _published(user_id, instagram, days_ago=0, content="Still a draft", status="draft")
    _published(user_id, instagram, days_ago=0, content="Waiting to go out", status="scheduled")
    x_post = _published(user_id, x_account, days_ago=0, content="A note on X")
    twitter_post = _published(user_id, twitter, days_ago=2, content="Old twitter name")
    other_post = _published(other_id, other_ig, days_ago=0, content="Someone else's latte")

    _add_comment(newest, instagram, text="Love this", network="instagram", minutes_ago=5, author="Ada")
    _add_comment(
        newest,
        instagram,
        text="Me too",
        network="instagram",
        minutes_ago=4,
        author="Grace",
        is_read=True,
    )
    _add_comment(
        newest,
        instagram,
        text="Our reply",
        network="instagram",
        minutes_ago=3,
        is_own=True,
        is_read=True,
    )
    _add_comment(newest, instagram, text="Removed", network="instagram", minutes_ago=2, deleted=True)
    _add_comment(older, youtube, text="Nice video", network="youtube", minutes_ago=30, author="Sam")
    _add_comment(
        quiet,
        facebook,
        text="Own only",
        network="facebook",
        minutes_ago=8,
        is_own=True,
        is_read=True,
    )

    monkeypatch.delenv("ENGAGEMENT_X_ENABLED", raising=False)
    denied = client.get("/api/v1/inbox/posts", headers=headers)
    assert denied.status_code == 200, denied.text
    body = denied.json()
    ids = [item["id"] for item in body["items"]]
    assert str(x_post) not in ids
    assert str(twitter_post) not in ids
    assert str(other_post) not in ids
    assert ids == [str(newest), str(quiet), str(older)]
    assert body["total"] == 3
    top = body["items"][0]
    assert top["network"] == "instagram"
    assert "instagram" in top["account_name"].lower()
    assert top["content"] == "Latte art this morning"
    assert top["media_thumb"] == "https://cdn.example/latte.jpg"
    assert top["comment_count"] == 2
    assert top["unread_count"] == 1
    assert top["social_account_id"] == str(instagram)
    assert top["published_at"]
    quiet_row = body["items"][1]
    assert quiet_row["id"] == str(quiet)
    assert quiet_row["comment_count"] == 0
    assert quiet_row["unread_count"] == 0
    assert quiet_row["media_thumb"] == ""
    assert quiet_row["published_at"] is None
    assert body["items"][2]["comment_count"] == 1
    assert body["items"][2]["unread_count"] == 1
    assert body["items"][2]["network"] == "youtube"

    found = client.get("/api/v1/inbox/posts?search=LATTE", headers=headers)
    assert [item["id"] for item in found.json()["items"]] == [str(newest)]
    by_name = client.get("/api/v1/inbox/posts?search=youtube", headers=headers)
    assert [item["id"] for item in by_name.json()["items"]] == [str(older)]
    network = client.get("/api/v1/inbox/posts?network=YouTube", headers=headers)
    assert [item["id"] for item in network.json()["items"]] == [str(older)]
    blocked = client.get("/api/v1/inbox/posts?network=tiktok", headers=headers)
    assert blocked.json() == {"items": [], "total": 0, "limit": 50, "offset": 0}
    assert client.get("/api/v1/inbox/posts?network=x", headers=headers).json()["items"] == []

    one_account = client.get(
        f"/api/v1/inbox/posts?account_id={facebook}&limit=1&offset=0", headers=headers
    )
    assert one_account.status_code == 200
    assert [item["id"] for item in one_account.json()["items"]] == [str(quiet)]
    assert one_account.json()["total"] == 1

    paged = client.get("/api/v1/inbox/posts?limit=1&offset=1", headers=headers)
    assert [item["id"] for item in paged.json()["items"]] == [str(quiet)]
    assert paged.json()["total"] == 3

    hidden = client.get("/api/v1/inbox/posts", headers=other)
    assert [item["id"] for item in hidden.json()["items"]] == [str(other_post)]

    from sqlalchemy import event

    from app.db.session import engine

    def _statements(path):
        seen = []

        def before(conn, cursor, statement, parameters, context, executemany):
            seen.append(statement)

        event.listen(engine, "before_cursor_execute", before)
        try:
            response = client.get(path, headers=headers)
            assert response.status_code == 200, response.text
        finally:
            event.remove(engine, "before_cursor_execute", before)
        return seen

    narrow = _statements("/api/v1/inbox/posts?limit=1")
    wide = _statements("/api/v1/inbox/posts?limit=20")
    assert narrow
    assert len(narrow) == len(wide)
    joined = "\n".join(wide).lower()
    assert "post_comments" in joined
    assert "group by" in joined

    monkeypatch.setenv("ENGAGEMENT_X_ENABLED", "true")
    enabled = client.get("/api/v1/inbox/posts?network=twitter", headers=headers)
    assert enabled.status_code == 200, enabled.text
    enabled_ids = {item["id"] for item in enabled.json()["items"]}
    assert enabled_ids == {str(x_post), str(twitter_post)}
    assert {item["network"] for item in enabled.json()["items"]} == {"x"}
