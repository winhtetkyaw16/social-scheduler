"""A fresh database upgrade must create the current schema and keep core tables."""

import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from sqlalchemy import create_engine, inspect, text

ROOT = Path(__file__).resolve().parents[1]
CORE_TABLES = {
    "users",
    "connected_accounts",
    "scheduled_posts",
    "execution_logs",
    "workspaces",
    "publish_items",
    "media_assets",
    "approval_workflows",
    "post_internal_comments",
}


def test_alembic_upgrade_head_on_empty_database(tmp_path):
    database = tmp_path / "fresh.db"
    url = f"sqlite:///{database}"
    env = os.environ.copy()
    env["DATABASE_URL"] = url
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=ROOT,
        env=env,
        check=True,
    )
    engine = create_engine(url)
    names = set(inspect(engine).get_table_names())
    missing = CORE_TABLES - names
    assert not missing, f"upgrade head did not create {sorted(missing)}"
    user_columns = {column["name"] for column in inspect(engine).get_columns("users")}
    assert {"email", "full_name", "workspace_name", "password_hash"} <= user_columns
    post_columns = {
        column["name"] for column in inspect(engine).get_columns("scheduled_posts")
    }
    assert "provider_post_id" in post_columns
    assert "metadata" in post_columns
    account_columns = {
        column["name"] for column in inspect(engine).get_columns("connected_accounts")
    }
    assert {"needs_reconnect", "reconnect_reason"} <= account_columns


def _alembic(url: str, *args: str) -> None:
    env = os.environ.copy()
    env["DATABASE_URL"] = url
    subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=ROOT,
        env=env,
        check=True,
    )


def test_token_refresh_migration_upgrades_an_existing_database(tmp_path):
    """Existing Page rows lose the copied user-token expiry; other rows keep theirs."""
    database = tmp_path / "existing.db"
    url = f"sqlite:///{database}"
    _alembic(url, "upgrade", "20261028_queue_slots")
    engine = create_engine(url)
    now = datetime.now(timezone.utc)
    user_id = str(uuid4())
    page_id = str(uuid4())
    linkedin_id = str(uuid4())
    instagram_id = str(uuid4())
    expiry = (now + timedelta(days=40)).isoformat()
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO users (id, email, full_name, workspace_name, password_hash, "
                "is_active, is_verified, created_at, updated_at) "
                "VALUES (:id, :email, 'Win', 'Studio', 'hash', 1, 0, :now, :now)"
            ),
            {"id": user_id, "email": f"{uuid4().hex[:8]}@example.com", "now": now},
        )
        for row_id, platform, account_type, meta in (
            (page_id, "facebook", "page", "{}"),
            (linkedin_id, "linkedin", "personal", "{}"),
            (
                instagram_id,
                "instagram",
                "business",
                '{"linked_facebook_page_id": "page-1"}',
            ),
        ):
            conn.execute(
                text(
                    "INSERT INTO connected_accounts ("
                    "id, user_id, platform, platform_account_id, account_name, account_type, "
                    "access_token_ciphertext, refresh_token_ciphertext, token_expires_at, "
                    "scopes, is_active, extra_metadata, created_at, updated_at"
                    ") VALUES ("
                    ":id, :user_id, :platform, :platform_account_id, 'Account', :account_type, "
                    "'cipher', 'refresh-cipher', :expiry, '[]', 1, :meta, :now, :now)"
                ),
                {
                    "id": row_id,
                    "user_id": user_id,
                    "platform": platform,
                    "platform_account_id": platform + "-1",
                    "account_type": account_type,
                    "expiry": expiry,
                    "meta": meta,
                    "now": now,
                },
            )
    _alembic(url, "upgrade", "head")
    with engine.connect() as conn:
        columns = {
            column["name"]
            for column in inspect(engine).get_columns("connected_accounts")
        }
        assert "needs_reconnect" in columns
        page = conn.execute(
            text(
                "SELECT token_expires_at, refresh_token_ciphertext, needs_reconnect, "
                "extra_metadata FROM connected_accounts WHERE id = :id"
            ),
            {"id": page_id},
        ).one()
        linkedin = conn.execute(
            text(
                "SELECT token_expires_at, refresh_token_ciphertext FROM connected_accounts WHERE id = :id"
            ),
            {"id": linkedin_id},
        ).one()
        instagram = conn.execute(
            text(
                "SELECT token_expires_at, refresh_token_ciphertext FROM connected_accounts WHERE id = :id"
            ),
            {"id": instagram_id},
        ).one()
    assert page.token_expires_at is None
    assert page.refresh_token_ciphertext is None
    assert page.needs_reconnect in (0, False)
    assert "non_expiring" in str(page.extra_metadata)
    assert linkedin.token_expires_at is not None
    assert linkedin.refresh_token_ciphertext == "refresh-cipher"
    assert instagram.token_expires_at is None
    assert instagram.refresh_token_ciphertext is None
