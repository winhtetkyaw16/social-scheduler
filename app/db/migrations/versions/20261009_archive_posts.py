"""Allow archived status for scheduled posts."""

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic import op

revision = "20261009_archive"
down_revision = "50c96b070b98"
branch_labels = None
depends_on = None

_ARCHIVED_STATUS = "status IN ('draft','scheduled','queued','publishing','published','failed','cancelled','archived')"
_OPEN_STATUS = "status IN ('draft','scheduled','queued','publishing','published','failed','cancelled')"


def _restore_initial_tables_if_missing() -> None:
    """Recreate the 0001 schema when an older copy of cb8a3ad113fa dropped it."""
    bind = op.get_bind()
    if sa.inspect(bind).has_table("users"):
        return
    path = Path(__file__).with_name("0001_initial.py")
    spec = importlib.util.spec_from_file_location("social_scheduler_0001_initial", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load the initial schema revision")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.upgrade()


def _status_check_names() -> list[str]:
    """Return named status checks that do not already allow archived posts."""
    bind = op.get_bind()
    names: list[str] = []
    for constraint in sa.inspect(bind).get_check_constraints("scheduled_posts"):
        name = constraint.get("name")
        sqltext = " ".join(str(constraint.get("sqltext") or "").lower().split())
        if name and "status" in sqltext and "archived" not in sqltext:
            names.append(name)
    return names


def upgrade() -> None:
    _restore_initial_tables_if_missing()
    names = _status_check_names() or ["ck_scheduled_posts_valid_status"]
    with op.batch_alter_table("scheduled_posts") as batch_op:
        for name in names:
            # op.f keeps an already rendered name from being prefixed again.
            batch_op.drop_constraint(op.f(name), type_="check")
        batch_op.create_check_constraint("valid_status", _ARCHIVED_STATUS)


def downgrade() -> None:
    op.execute("UPDATE scheduled_posts SET status = 'cancelled' WHERE status = 'archived'")
    bind = op.get_bind()
    names = []
    for constraint in sa.inspect(bind).get_check_constraints("scheduled_posts"):
        name = constraint.get("name")
        sqltext = " ".join(str(constraint.get("sqltext") or "").lower().split())
        if name and "archived" in sqltext:
            names.append(name)
    with op.batch_alter_table("scheduled_posts") as batch_op:
        for name in names or ["ck_scheduled_posts_valid_status"]:
            batch_op.drop_constraint(op.f(name), type_="check")
        batch_op.create_check_constraint("valid_status", _OPEN_STATUS)
