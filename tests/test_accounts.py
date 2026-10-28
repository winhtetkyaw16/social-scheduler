"""Connected accounts encrypt tokens and hide them from API responses."""

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from sqlalchemy import select

from app.core.security import decrypt_token
from app.db.session import SessionLocal
from app.models import ConnectedAccount


def test_create_account_encrypts_and_hides_tokens(client, auth_headers):
    headers, _tokens = auth_headers
    secret = f"provider-token-{uuid4().hex}"
    refresh = f"provider-refresh-{uuid4().hex}"
    created = client.post(
        "/api/v1/accounts",
        headers=headers,
        json={
            "platform": "x",
            "platform_account_id": "acct-1",
            "account_name": "Brand",
            "account_type": "user",
            "access_token": secret,
            "refresh_token": refresh,
            "token_expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
            "scopes": ["tweet.write"],
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["platform"] == "x"
    assert body["account_type"] == "user"
    assert "access_token" not in body
    assert "refresh_token" not in body
    assert "ciphertext" not in created.text
    assert secret not in created.text
    assert refresh not in created.text

    listed = client.get("/api/v1/accounts", headers=headers)
    assert listed.status_code == 200
    assert secret not in listed.text
    assert "access_token_ciphertext" not in listed.text

    db = SessionLocal()
    try:
        row = db.scalar(select(ConnectedAccount).where(ConnectedAccount.id == UUID(body["id"])))
        assert row is not None
        assert row.access_token_ciphertext != secret
        assert decrypt_token(row.access_token_ciphertext) == secret
        assert decrypt_token(row.refresh_token_ciphertext) == refresh
    finally:
        db.close()


def test_unsupported_platform_is_rejected(client, auth_headers):
    headers, _tokens = auth_headers
    rejected = client.post(
        "/api/v1/accounts",
        headers=headers,
        json={
            "platform": "myspace",
            "platform_account_id": "page-1",
            "account_name": "Page",
            "access_token": "should-not-be-stored",
            "scopes": [],
        },
    )
    assert rejected.status_code == 422
    assert "should-not-be-stored" not in rejected.text

    missing = client.get("/api/v1/accounts/x/connect", headers=headers)
    assert missing.status_code == 503
    assert "X_CLIENT_ID" in missing.text

    facebook_missing = client.get("/api/v1/accounts/facebook/connect", headers=headers)
    assert facebook_missing.status_code == 503
    assert "FACEBOOK_CLIENT_ID" in facebook_missing.text

    catalog = client.get("/api/v1/accounts/catalog", headers=headers)
    assert catalog.status_code == 200
    ids = {row["id"] for row in catalog.json()}
    assert {"x", "facebook", "threads", "youtube"}.issubset(ids)
