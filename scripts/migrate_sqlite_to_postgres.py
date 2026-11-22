"""Copy an Alembic-upgraded SQLite database into an empty PostgreSQL database.

The SQLite source is opened read-only. All PostgreSQL inserts run in one
transaction, and the command refuses to run unless both databases are at the
same Alembic revision and the PostgreSQL application tables are empty.
"""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from sqlalchemy import Boolean, JSON, MetaData, Table, create_engine, inspect, text
from sqlalchemy.types import DateTime, Uuid

from app.models import Base  # noqa: F401 — register all application tables.


SOURCE_PATH = Path(os.environ.get("SQLITE_SOURCE_PATH", "/tmp/source.db"))
TARGET_URL = os.environ["DATABASE_URL"]
EXCLUDED_TABLES = {"alembic_version"}
ALLOWED_ORPHAN_RELATIONSHIP = ("post_internal_comments", "scheduled_posts", 1)


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _key_value(value):
    if isinstance(value, str):
        try:
            return UUID(value).hex
        except ValueError:
            return value
    return value


def _self_reference_order(table: Table, rows: list[dict]) -> list[dict]:
    self_foreign_keys = [
        constraint
        for constraint in table.foreign_key_constraints
        if constraint.referred_table is table
    ]
    if not self_foreign_keys or not rows:
        return rows

    primary_key = list(table.primary_key.columns)
    by_primary_key = {
        tuple(_key_value(row[column.name]) for column in primary_key): row
        for row in rows
    }
    ordered: list[dict] = []
    visiting: set[tuple] = set()
    visited: set[tuple] = set()

    def visit(row: dict) -> None:
        row_key = tuple(_key_value(row[column.name]) for column in primary_key)
        if row_key in visited:
            return
        if row_key in visiting:
            raise RuntimeError(f"Self-referencing cycle in {table.name}")
        visiting.add(row_key)
        for constraint in self_foreign_keys:
            elements = list(constraint.elements)
            local_values = [row[element.parent.name] for element in elements]
            if any(value is None for value in local_values):
                continue
            remote_columns = [element.column for element in elements]
            parent_key = tuple(_key_value(value) for value in local_values)
            parent = next(
                (
                    candidate
                    for candidate in rows
                    if tuple(
                        _key_value(candidate[column.name]) for column in remote_columns
                    )
                    == parent_key
                ),
                None,
            )
            if parent is None:
                raise RuntimeError(f"Missing self-reference in {table.name}")
            if parent is not row:
                visit(parent)
        visiting.remove(row_key)
        visited.add(row_key)
        ordered.append(row)

    for source_row in rows:
        visit(source_row)
    return ordered


def _convert(value, column):
    if value is None:
        return None
    column_type = column.type
    if isinstance(column_type, Uuid):
        return value if isinstance(value, UUID) else UUID(str(value))
    if isinstance(column_type, JSON):
        if isinstance(value, (str, bytes, bytearray)):
            return json.loads(value)
        return value
    if isinstance(column_type, DateTime):
        if isinstance(value, str):
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(column_type, Boolean):
        return bool(value)
    return value


def _read_source():
    if not SOURCE_PATH.is_file():
        raise RuntimeError(f"SQLite source not found: {SOURCE_PATH}")
    source = sqlite3.connect(SOURCE_PATH.as_uri() + "?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    source.execute("BEGIN")

    integrity = source.execute("PRAGMA integrity_check").fetchone()[0]
    if integrity != "ok":
        raise RuntimeError(f"SQLite integrity check failed: {integrity}")
    violations = source.execute("PRAGMA foreign_key_check").fetchall()
    orphan_rowids: dict[str, set[int]] = {}
    for table_name, rowid, parent_table, foreign_key_index in violations:
        relationship = (table_name, parent_table, foreign_key_index)
        if relationship != ALLOWED_ORPHAN_RELATIONSHIP:
            raise RuntimeError(
                "SQLite has an unapproved foreign-key violation "
                f"in {table_name} referencing {parent_table}; no rows copied"
            )
        orphan_rowids.setdefault(table_name, set()).add(rowid)
    if len(orphan_rowids.get("post_internal_comments", set())) != 1:
        raise RuntimeError(
            "Expected exactly one approved orphaned internal comment; "
            "source changed since review, so no rows copied"
        )

    source_tables = {
        row[0]
        for row in source.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
    }
    expected_tables = set(Base.metadata.tables)
    missing = expected_tables - source_tables
    if missing:
        raise RuntimeError(f"SQLite source is missing tables: {sorted(missing)}")

    source_revision = source.execute(
        "SELECT version_num FROM alembic_version"
    ).fetchone()[0]
    data = {}
    counts = {}
    skipped_counts = {}
    for table in Base.metadata.sorted_tables:
        if table.name in EXCLUDED_TABLES:
            continue
        columns = {
            row[1]
            for row in source.execute(f"PRAGMA table_info({_quote(table.name)})")
        }
        expected_columns = {column.name for column in table.columns}
        if columns != expected_columns:
            raise RuntimeError(
                f"Column mismatch in {table.name}: "
                f"missing={sorted(expected_columns - columns)}, "
                f"extra={sorted(columns - expected_columns)}"
            )
        if table.name in orphan_rowids:
            selected = source.execute(
                f"SELECT rowid AS __migration_rowid__, * FROM {_quote(table.name)}"
            )
            rows_with_rowid = [dict(row) for row in selected]
            skipped_counts[table.name] = sum(
                row["__migration_rowid__"] in orphan_rowids[table.name]
                for row in rows_with_rowid
            )
            rows = []
            for row in rows_with_rowid:
                rowid = row.pop("__migration_rowid__")
                if rowid not in orphan_rowids[table.name]:
                    rows.append(row)
            if skipped_counts[table.name] != len(orphan_rowids[table.name]):
                raise RuntimeError(
                    f"Could not isolate the approved orphan in {table.name}; "
                    "no rows copied"
                )
        else:
            rows = [
                dict(row)
                for row in source.execute(f"SELECT * FROM {_quote(table.name)}")
            ]
        data[table.name] = _self_reference_order(table, rows)
        counts[table.name] = len(rows)
    return source, source_revision, data, counts, skipped_counts


def main() -> None:
    if not TARGET_URL.startswith("postgresql"):
        raise RuntimeError("DATABASE_URL must point to PostgreSQL")

    source, source_revision, data, source_counts, skipped_counts = _read_source()
    engine = create_engine(TARGET_URL, pool_pre_ping=True)
    try:
        with engine.begin() as connection:
            target_revision = connection.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar_one()
            if target_revision != source_revision:
                raise RuntimeError(
                    f"Alembic revisions differ: SQLite={source_revision}, "
                    f"PostgreSQL={target_revision}"
                )

            target_tables = set(inspect(connection).get_table_names())
            missing = set(Base.metadata.tables) - target_tables
            if missing:
                raise RuntimeError(
                    f"PostgreSQL is missing tables: {sorted(missing)}"
                )

            nonempty = {}
            for table in Base.metadata.sorted_tables:
                count = connection.execute(
                    text(f"SELECT COUNT(*) FROM {_quote(table.name)}")
                ).scalar_one()
                if count:
                    nonempty[table.name] = count
            if nonempty:
                raise RuntimeError(
                    f"PostgreSQL application tables are not empty: {nonempty}"
                )

            for table in Base.metadata.sorted_tables:
                rows = data[table.name]
                if rows:
                    converted = [
                        {
                            column.name: _convert(row[column.name], column)
                            for column in table.columns
                        }
                        for row in rows
                    ]
                    connection.execute(table.insert(), converted)

            target_counts = {
                table.name: connection.execute(
                    text(f"SELECT COUNT(*) FROM {_quote(table.name)}")
                ).scalar_one()
                for table in Base.metadata.sorted_tables
            }
            if target_counts != source_counts:
                raise RuntimeError(
                    f"Row-count mismatch; PostgreSQL transaction will roll back. "
                    f"source={source_counts}, target={target_counts}"
                )

        print(f"Copied {sum(source_counts.values())} rows from SQLite to PostgreSQL.")
        for table_name in sorted(source_counts):
            print(f"{table_name}: {source_counts[table_name]}")
        print(f"Alembic revision preserved: {target_revision}")
        for table_name, count in sorted(skipped_counts.items()):
            print(
                f"Left {count} approved orphan row(s) in the untouched SQLite source: "
                f"{table_name}"
            )
    finally:
        source.close()
        engine.dispose()


if __name__ == "__main__":
    main()
