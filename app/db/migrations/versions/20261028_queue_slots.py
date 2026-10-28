"""Add Buffer-style queue_slots table."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "20261028_queue_slots"
down_revision = "20261028_account_types"
branch_labels = None
depends_on = None


def _has_table(table: str) -> bool:
    bind = op.get_bind()
    return table in inspect(bind).get_table_names()


def upgrade() -> None:
    if _has_table("queue_slots"):
        return
    op.create_table(
        "queue_slots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("platform", sa.String(length=40), nullable=False),
        sa.Column("weekday", sa.Integer(), nullable=False),
        sa.Column("time_local", sa.String(length=5), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "platform", "weekday", "time_local", name="uq_queue_slot_user_platform_weekday_time"),
    )
    op.create_index("ix_queue_slots_user_platform", "queue_slots", ["user_id", "platform"])
    op.create_index(op.f("ix_queue_slots_user_id"), "queue_slots", ["user_id"])


def downgrade() -> None:
    if not _has_table("queue_slots"):
        return
    op.drop_index(op.f("ix_queue_slots_user_id"), table_name="queue_slots")
    op.drop_index("ix_queue_slots_user_platform", table_name="queue_slots")
    op.drop_table("queue_slots")
