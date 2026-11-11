"""Ensure the database schema matches the current SQLAlchemy models."""

from __future__ import annotations

import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

import app.models  # noqa: F401 — register every mapped model with metadata
from app.models import Base

logger = logging.getLogger(__name__)

_USER_COLUMN_PATCHES: dict[str, str] = {
    "full_name": "VARCHAR(160) NOT NULL DEFAULT ''",
    "workspace_name": "VARCHAR(160) NOT NULL DEFAULT 'My Workspace'",
}


def _add_column_if_missing(engine: Engine, table: str, column: str, ddl: str) -> None:
    """Add a column when an older database file predates the current models."""
    inspector = inspect(engine)
    if not inspector.has_table(table):
        return
    existing = {col["name"] for col in inspector.get_columns(table)}
    if column in existing:
        return
    with engine.begin() as connection:
        connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
    logger.info("Added missing column %s.%s", table, column)


def ensure_database_schema(engine: Engine) -> None:
    """Create missing tables and patch legacy schemas without requiring Alembic."""
    had_decision_history = inspect(engine).has_table("approval_decisions")
    Base.metadata.create_all(bind=engine)
    for column, ddl in _USER_COLUMN_PATCHES.items():
        _add_column_if_missing(engine, "users", column, ddl)
    # create_all does not alter an existing connected_accounts table.
    bool_ddl = (
        "BOOLEAN NOT NULL DEFAULT FALSE"
        if engine.dialect.name == "postgresql"
        else "INTEGER NOT NULL DEFAULT 0"
    )
    _add_column_if_missing(engine, "connected_accounts", "needs_reconnect", bool_ddl)
    _add_column_if_missing(engine, "connected_accounts", "reconnect_reason", "TEXT")
    if not had_decision_history:
        _backfill_decision_history(engine)


def _backfill_decision_history(engine: Engine) -> None:
    """Fill a newly created approval_decisions table from existing approval rows."""
    from sqlalchemy.orm import Session

    from app.services.approval_history import backfill_from_workflows

    try:
        with Session(engine) as session:
            added = backfill_from_workflows(session)
        if added:
            logger.info("Copied %s earlier approval decisions into history", added)
    except Exception:
        # History is a convenience; never block startup on it.
        logger.exception("Could not copy earlier approval decisions into history")
