"""The API test suite must never connect to the application's local database."""

import os
import tempfile
from pathlib import Path

from app.core.config import APP_ENV, DATABASE_URL
from app.db.session import engine

ROOT = Path(__file__).resolve().parents[1]


def test_api_test_database_is_temporary_and_separate_from_local_db():
    assert APP_ENV == "test"
    assert DATABASE_URL == os.environ["DATABASE_URL"]
    assert engine.url.drivername == "sqlite"

    database_path = Path(engine.url.database).resolve()
    local_database_path = (ROOT / "local.db").resolve()
    temporary_root = Path(tempfile.gettempdir()).resolve()

    assert database_path != local_database_path
    assert database_path.parent.name.startswith("social-scheduler-tests-")
    assert database_path.is_relative_to(temporary_root)
