"""Several accounts per network: per-account captions, no overwrites, UTF-8 responses."""

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from sqlalchemy import select

from app.core.security import decrypt_token
from app.db.session import SessionLocal
from app.models import ConnectedAccount, ScheduledPost
from app.services.accounts import upsert_oauth_account
from app.services.posts import _caption_for_account

A = uuid4()
B = uuid4()


def test_caption_fallback_account_then_network_then_default():
    meta = {
        "caption": "Default",
        "captionMode": "custom",
        "captionsByNetwork": {"facebook": "FB default"},
        "captionsByAccount": {str(A): "Page A only"},
        "useUniversalCaptionByAccount": {str(A): False, str(B): True},
    }
    assert _caption_for_account(meta, A, "", "facebook") == "Page A only"
    assert _caption_for_account(meta, B, "", "facebook") == "FB default"
    assert _caption_for_account(meta, B, "", "linkedin") == "Default"


def test_blank_network_caption_falls_back_to_default():
    meta = {
        "caption": "Default",
        "captionMode": "custom",
        "captionsByNetwork": {"facebook": "  "},
    }
    assert _caption_for_account(meta, A, "", "facebook") == "Default"


def test_twitter_platform_reads_x_network_caption():
    meta = {
        "caption": "Default",
        "captionMode": "custom",
        "captionsByNetwork": {"x": "X text"},
    }
    assert _caption_for_account(meta, A, "", "twitter") == "X text"


def test_old_metadata_without_network_captions_still_works():
    old = {
        "caption": "Shared",
        "captionMode": "custom",
        "captionsByAccount": {str(A): "Mine"},
        "useUniversalCaptionByAccount": {str(A): False},
    }
    assert _caption_for_account(old, A, "") == "Mine"
    assert _caption_for_account(old, B, "", "facebook") == "Shared"
    assert (
        _caption_for_account({}, A, "Content fallback", "facebook")
        == "Content fallback"
    )
    assert (
        _caption_for_account(
            {"caption": "U", "captionsByNetwork": {"facebook": "N"}}, A, "", "facebook"
        )
        == "U"
    )


def test_second_account_on_same_network_does_not_overwrite_first(client, auth_headers):
    headers, _ = auth_headers
    seed = client.post(
        "/api/v1/accounts",
        headers=headers,
        json={
            "platform": "x",
            "platform_account_id": f"seed-{uuid4().hex[:6]}",
            "account_name": "Seed",
            "access_token": "seed-token",
            "scopes": [],
        },
    )
    assert seed.status_code == 201, seed.text
    db = SessionLocal()
    try:
        user_id = db.scalar(
            select(ConnectedAccount.user_id).where(
                ConnectedAccount.id == UUID(seed.json()["id"])
            )
        )
        kw = dict(
            account_name="SocialCastly Page",
            refresh_token=None,
            token_expires_at=None,
            scopes=[],
        )
        first = upsert_oauth_account(
            db,
            user_id,
            platform="facebook",
            platform_account_id=f"pg-{uuid4().hex[:6]}",
            access_token="tok-first",
            **kw,
        )
        second = upsert_oauth_account(
            db,
            user_id,
            platform="facebook",
            platform_account_id=f"pg-{uuid4().hex[:6]}",
            access_token="tok-second",
            **kw,
        )
        assert first.id != second.id
        again = upsert_oauth_account(
            db,
            user_id,
            platform="facebook",
            platform_account_id=first.platform_account_id,
            access_token="tok-first-refreshed",
            **kw,
        )
        assert again.id == first.id
        db.expire_all()
        rows = db.scalars(
            select(ConnectedAccount).where(
                ConnectedAccount.user_id == user_id,
                ConnectedAccount.platform == "facebook",
            )
        ).all()
        tokens = {str(r.id): decrypt_token(r.access_token_ciphertext) for r in rows}
        assert len(rows) == 2
        assert tokens[str(first.id)] == "tok-first-refreshed"
        assert tokens[str(second.id)] == "tok-second"
        ids = (str(first.id), str(second.id))
    finally:
        db.close()

    later = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    made = []
    for acc_id in ids:
        r = client.post(
            "/api/v1/posts",
            headers=headers,
            json={
                "connected_account_id": acc_id,
                "content": "Hello",
                "media_urls": [],
                "scheduled_at": later,
                "idempotency_key": uuid4().hex,
                "post_metadata": {"format": "Post"},
            },
        )
        assert r.status_code == 200, r.text
        made.append(r.json())
    db = SessionLocal()
    try:
        for p, acc_id in zip(made, ids):
            row = db.scalar(
                select(ScheduledPost).where(ScheduledPost.id == UUID(p["id"]))
            )
            assert str(row.connected_account_id) == acc_id
    finally:
        db.close()


def test_api_and_html_declare_utf8(client):
    health = client.get("/api/v1/health")
    assert "charset=utf-8" in health.headers["content-type"].lower()
    page = client.get("/")
    if "text/html" in page.headers.get("content-type", ""):
        assert "charset=utf-8" in page.headers["content-type"].lower()
