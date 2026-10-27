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
    Base.metadata.create_all(bind=engine)
    for column, ddl in _USER_COLUMN_PATCHES.items():
        _add_column_if_missing(engine, "users", column, ddl)
