"""Account avatar_url extraction from provider metadata."""

from types import SimpleNamespace
from uuid import uuid4
from datetime import datetime, timezone

from app.schemas.account import AccountRead, extract_avatar_url


def test_extract_avatar_url_shapes():
    assert extract_avatar_url({"avatar_url": "https://cdn.example/a.jpg"}) == "https://cdn.example/a.jpg"
    assert extract_avatar_url({"profile_image_url": "https://cdn.example/b.jpg"}) == "https://cdn.example/b.jpg"
    assert extract_avatar_url({"picture": {"data": {"url": "https://cdn.example/c.jpg"}}}) == "https://cdn.example/c.jpg"
    assert extract_avatar_url({"picture": "not-a-url"}) is None
    assert extract_avatar_url({}) is None
    assert extract_avatar_url(None) is None


def test_account_read_exposes_avatar_url():
    account = SimpleNamespace(
        id=uuid4(),
        platform="x",
        platform_account_id="1",
        account_name="Win",
        account_type="user",
        parent_account_id=None,
        token_expires_at=None,
        scopes=["tweet.read"],
        is_active=True,
        created_at=datetime.now(timezone.utc),
        extra_metadata={"username": "win", "avatar_url": "https://cdn.example/win.jpg"},
    )
    read = AccountRead.from_account(account)
    assert read.avatar_url == "https://cdn.example/win.jpg"
    assert read.extra_metadata["username"] == "win"
