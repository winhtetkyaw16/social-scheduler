"""Allow archived status for scheduled posts."""

from alembic import op

revision = "20261009_archive"
down_revision = "50c96b070b98"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("scheduled_posts") as batch_op:
        batch_op.drop_constraint("valid_status", type_="check")
        batch_op.create_check_constraint(
            "valid_status",
            "status IN ('draft','scheduled','queued','publishing','published','failed','cancelled','archived')",
        )


def downgrade() -> None:
    op.execute("UPDATE scheduled_posts SET status = 'cancelled' WHERE status = 'archived'")
    with op.batch_alter_table("scheduled_posts") as batch_op:
        batch_op.drop_constraint("valid_status", type_="check")
        batch_op.create_check_constraint(
            "valid_status",
            "status IN ('draft','scheduled','queued','publishing','published','failed','cancelled')",
        )
