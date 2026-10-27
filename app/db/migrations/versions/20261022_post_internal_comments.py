"""Add private comments to scheduled posts."""

from alembic import op
import sqlalchemy as sa

revision = "20261022_post_internal_comments"
down_revision = "20261021_publish_modules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "post_internal_comments",
        sa.Column("post_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["post_id"], ["scheduled_posts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_post_internal_comments_post_id", "post_internal_comments", ["post_id"])
    op.create_index("ix_post_internal_comments_user_id", "post_internal_comments", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_post_internal_comments_user_id", table_name="post_internal_comments")
    op.drop_index("ix_post_internal_comments_post_id", table_name="post_internal_comments")
    op.drop_table("post_internal_comments")
