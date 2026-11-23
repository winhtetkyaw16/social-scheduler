"""Track remote post deletion and engagement retry state separately from publishing."""

import sqlalchemy as sa
from alembic import op

revision = "20261123_remote_post_sync_state"
down_revision = "20261111_comments_insights"
branch_labels = None
depends_on = None


def _columns() -> tuple[sa.Column, ...]:
    return (
        sa.Column(
            "remote_status",
            sa.String(length=20),
            server_default="available",
            nullable=False,
        ),
        sa.Column("remote_deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "engagement_sync_failures",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
        sa.Column("engagement_sync_retry_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("engagement_sync_error_code", sa.String(length=100), nullable=True),
    )


def upgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("scheduled_posts", recreate="always") as batch:
            for column in _columns():
                batch.add_column(column)
            batch.create_check_constraint(
                "valid_remote_status", "remote_status IN ('available','deleted')"
            )
            batch.create_check_constraint(
                "valid_engagement_sync_failures", "engagement_sync_failures >= 0"
            )
        return

    for column in _columns():
        op.add_column("scheduled_posts", column)
    op.create_check_constraint(
        "valid_remote_status",
        "scheduled_posts",
        "remote_status IN ('available','deleted')",
    )
    op.create_check_constraint(
        "valid_engagement_sync_failures",
        "scheduled_posts",
        "engagement_sync_failures >= 0",
    )


def downgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("scheduled_posts", recreate="always") as batch:
            batch.drop_constraint("valid_engagement_sync_failures", type_="check")
            batch.drop_constraint("valid_remote_status", type_="check")
            for name in (
                "engagement_sync_error_code",
                "engagement_sync_retry_at",
                "engagement_sync_failures",
                "remote_deleted_at",
                "remote_status",
            ):
                batch.drop_column(name)
        return

    op.drop_constraint(
        "valid_engagement_sync_failures", "scheduled_posts", type_="check"
    )
    op.drop_constraint("valid_remote_status", "scheduled_posts", type_="check")
    for name in (
        "engagement_sync_error_code",
        "engagement_sync_retry_at",
        "engagement_sync_failures",
        "remote_deleted_at",
        "remote_status",
    ):
        op.drop_column("scheduled_posts", name)
