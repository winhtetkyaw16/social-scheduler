"""Regression: OAuth pick save must tolerate naive token_expires_at from SQLite."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models import User
from app.services.accounts import create_pick_session, upsert_oauth_account
from app.services.destinations import save_destinations


def test_upsert_oauth_account_accepts_naive_token_expires_at(auth_headers):
    _headers, _tokens = auth_headers
    db = SessionLocal()
    try:
        user = db.scalars(select(User).order_by(User.created_at.desc())).first()
        assert user is not None
        naive_expiry = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=60)
        assert naive_expiry.tzinfo is None
        account = upsert_oauth_account(
            db,
            user.id,
            platform="facebook",
            platform_account_id=f"page-{uuid4().hex[:10]}",
            account_name="Social Studio",
            account_type="page",
            access_token=f"page-token-{uuid4().hex}",
            refresh_token=None,
            token_expires_at=naive_expiry,
            scopes=["pages_manage_posts"],
            extra_metadata={"category": "DIGITAL CREATOR"},
        )
        assert account.id is not None
        assert account.account_type == "page"
    finally:
        db.close()


def test_save_destinations_with_sqlite_naive_expiry(monkeypatch, auth_headers):
    _headers, _tokens = auth_headers
    db = SessionLocal()
    try:
        user = db.scalars(select(User).order_by(User.created_at.desc())).first()
        assert user is not None
        session = create_pick_session(
            db,
            user.id,
            platform="facebook",
            access_token=f"user-token-{uuid4().hex}",
            refresh_token=None,
            token_expires_at=datetime.now(timezone.utc) + timedelta(days=60),
            scopes=["pages_show_list", "pages_manage_posts"],
            identity_json={"id": "login-1", "name": "Win", "account_type": "login"},
        )
        db.expire(session)
        reloaded = db.get(type(session), session.id)
        assert reloaded.token_expires_at is not None
        assert reloaded.token_expires_at.tzinfo is None

        page_id = f"page-{uuid4().hex[:10]}"

        def fake_list(db_arg, user_id, session_id):
            return {
                "platform": "facebook",
                "pick_session_id": str(session_id),
                "identity": {},
                "destinations": [
                    {
                        "id": page_id,
                        "name": "Social Studio",
                        "account_type": "page",
                        "access_token": f"page-token-{uuid4().hex}",
                        "category": "DIGITAL CREATOR",
                    }
                ],
                "notes": "",
            }

        monkeypatch.setattr("app.services.destinations.list_destinations", fake_list)
        saved = save_destinations(db, user.id, session.id, [page_id])
        assert len(saved) == 1
        assert saved[0].account_type == "page"
        assert saved[0].platform_account_id == page_id
    finally:
        db.close()
