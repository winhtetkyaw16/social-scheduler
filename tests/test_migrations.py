"""A fresh database upgrade must create the current schema and keep core tables."""

import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, inspect

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
    post_columns = {column["name"] for column in inspect(engine).get_columns("scheduled_posts")}
    assert "provider_post_id" in post_columns
    assert "metadata" in post_columns
