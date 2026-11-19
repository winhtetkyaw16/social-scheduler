"""Picker list marks already-connected destinations, refreshes their token, and never returns tokens (mocked Graph)."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.core.security import decrypt_token
from app.db.session import SessionLocal
from app.models import User
from app.models.connected_account import ConnectedAccount
from app.services.accounts import create_pick_session, upsert_oauth_account
from app.services.destinations import list_destinations_for_picker, save_destinations


def test_picker_marks_already_added_and_strips_tokens(monkeypatch, auth_headers):
    db = SessionLocal()
    try:
        user = db.scalars(select(User).order_by(User.created_at.desc())).first()
        old_id, new_id = f"page-{uuid4().hex[:8]}", f"page-{uuid4().hex[:8]}"
        upsert_oauth_account(
            db,
            user.id,
            platform="facebook",
            platform_account_id=old_id,
            account_name="Acme Studio",
            account_type="page",
            access_token="old-page-token",
            refresh_token=None,
            token_expires_at=None,
            scopes=["pages_manage_posts"],
        )
        session = create_pick_session(
            db,
            user.id,
            platform="facebook",
            access_token=f"user-{uuid4().hex}",
            refresh_token=None,
            token_expires_at=datetime.now(timezone.utc) + timedelta(days=60),
            scopes=["pages_manage_posts", "pages_manage_engagement"],
            identity_json={"id": "login"},
        )

        def fake_list(db_arg, user_id, session_id):
            return {
                "platform": "facebook",
                "pick_session_id": str(session_id),
                "identity": {},
                "notes": "",
                "destinations": [
                    {
                        "id": old_id,
                        "name": "Acme Studio",
                        "account_type": "page",
                        "platform": "facebook",
                        "access_token": "fresh-page-token",
                    },
                    {
                        "id": new_id,
                        "name": "Banner K",
                        "account_type": "page",
                        "platform": "facebook",
                        "access_token": "t2",
                        "category": "Social media agency",
                    },
                ],
            }

        monkeypatch.setattr("app.services.destinations.list_destinations", fake_list)
        result = list_destinations_for_picker(db, user.id, session.id)
        rows = {row["id"]: row for row in result["destinations"]}
        assert rows[old_id]["already_connected"] is True
        assert rows[new_id]["already_connected"] is False
        assert all("access_token" not in row for row in result["destinations"])
        assert rows[new_id]["category"] == "Social media agency"

        existing = db.scalar(
            select(ConnectedAccount).where(
                ConnectedAccount.user_id == user.id,
                ConnectedAccount.platform_account_id == old_id,
            )
        )
        db.refresh(existing)
        # Opening the picker is read-only: nothing is refreshed or added yet.
        assert decrypt_token(existing.access_token_ciphertext) == "old-page-token"
        assert (
            db.scalar(
                select(ConnectedAccount).where(
                    ConnectedAccount.platform_account_id == new_id
                )
            )
            is None
        )

        # Nothing ticked and no reconnect -> rejected.
        with pytest.raises(HTTPException):
            save_destinations(db, user.id, session.id, [])

        # Reconnect with nothing new ticked: refreshes the existing Page's token and scopes only.
        saved = save_destinations(db, user.id, session.id, [], refresh_existing=True)
        assert [a.platform_account_id for a in saved] == [old_id]
        db.refresh(existing)
        assert decrypt_token(existing.access_token_ciphertext) == "fresh-page-token"
        assert "pages_manage_engagement" in existing.scopes
        assert (
            db.scalar(
                select(ConnectedAccount).where(
                    ConnectedAccount.platform_account_id == new_id
                )
            )
            is None
        )
    finally:
        db.close()


def test_reconnect_plus_new_page(monkeypatch, auth_headers):
    db = SessionLocal()
    try:
        user = db.scalars(select(User).order_by(User.created_at.desc())).first()
        old_id, new_id = f"page-{uuid4().hex[:8]}", f"page-{uuid4().hex[:8]}"
        upsert_oauth_account(
            db,
            user.id,
            platform="facebook",
            platform_account_id=old_id,
            account_name="Acme",
            account_type="page",
            access_token="old",
            refresh_token=None,
            token_expires_at=None,
            scopes=["pages_manage_posts"],
        )
        session = create_pick_session(
            db,
            user.id,
            platform="facebook",
            access_token="user",
            refresh_token=None,
            token_expires_at=None,
            scopes=["pages_manage_engagement"],
            identity_json={"id": "login"},
        )
        monkeypatch.setattr(
            "app.services.destinations.list_destinations",
            lambda *a: {
                "platform": "facebook",
                "pick_session_id": str(session.id),
                "identity": {},
                "notes": "",
                "destinations": [
                    {
                        "id": old_id,
                        "name": "Acme",
                        "account_type": "page",
                        "platform": "facebook",
                        "access_token": "fresh",
                    },
                    {
                        "id": new_id,
                        "name": "New",
                        "account_type": "page",
                        "platform": "facebook",
                        "access_token": "new-t",
                    },
                ],
            },
        )
        saved = save_destinations(
            db, user.id, session.id, [new_id], refresh_existing=True
        )
        assert sorted(a.platform_account_id for a in saved) == sorted([old_id, new_id])
        new = db.scalar(
            select(ConnectedAccount).where(
                ConnectedAccount.platform_account_id == new_id
            )
        )
        assert decrypt_token(new.access_token_ciphertext) == "new-t"
    finally:
        db.close()


def test_reauth_id_round_trips_through_oauth_state(monkeypatch):
    from urllib.parse import parse_qs, urlparse

    from app.services import oauth

    monkeypatch.setenv("FACEBOOK_CLIENT_ID", "id")
    monkeypatch.setenv("FACEBOOK_CLIENT_SECRET", "secret")
    started = oauth.start_oauth("facebook", uuid4(), reauth="PAGE123")
    state = parse_qs(urlparse(started["authorization_url"]).query)["state"][0]
    assert oauth._peek_reauth(state) == "PAGE123"
    assert oauth._peek_reauth(oauth._write_state(uuid4(), "facebook", None)) is None
    assert oauth._peek_reauth("garbage") is None
