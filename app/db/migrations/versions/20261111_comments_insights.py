"""Add post_comments and post_insights_snapshots.

Comments are unique per connected account, network, and provider comment id so
a later sync updates the same row. Insight metrics are nullable because each
network reports a different set.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "20261111_comments_insights"
down_revision = "20261111_approval_decisions"
branch_labels = None
depends_on = None


def _has_table(table: str) -> bool:
    bind = op.get_bind()
    return table in inspect(bind).get_table_names()


def upgrade() -> None:
    if not _has_table("post_comments"):
        op.create_table(
            "post_comments",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.Column("post_id", sa.Uuid(), nullable=False),
            sa.Column("social_account_id", sa.Uuid(), nullable=False),
            sa.Column("network", sa.String(length=40), nullable=False),
            sa.Column("provider_comment_id", sa.String(length=255), nullable=False),
            sa.Column("provider_post_id", sa.String(length=255), nullable=False),
            sa.Column("parent_comment_id", sa.Uuid(), nullable=True),
            sa.Column("provider_parent_id", sa.String(length=255), nullable=True),
            sa.Column("thread_root_id", sa.Uuid(), nullable=True),
            sa.Column("provider_thread_root_id", sa.String(length=255), nullable=True),
            sa.Column("author_name", sa.String(length=255), nullable=True),
            sa.Column("author_handle", sa.String(length=255), nullable=True),
            sa.Column("author_avatar_url", sa.String(length=1024), nullable=True),
            sa.Column("author_provider_id", sa.String(length=255), nullable=True),
            sa.Column("text", sa.Text(), nullable=False),
            sa.Column("created_at_provider", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "fetched_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.Column(
                "is_read",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
            sa.Column(
                "replied",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
            sa.Column("replied_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("reply_provider_id", sa.String(length=255), nullable=True),
            sa.Column(
                "is_own",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
            sa.Column(
                "is_hidden",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
            sa.Column(
                "is_deleted",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
            sa.Column("raw", sa.JSON(), nullable=False),
            sa.ForeignKeyConstraint(
                ["post_id"],
                ["scheduled_posts.id"],
                name=op.f("fk_post_comments_post_id_scheduled_posts"),
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["social_account_id"],
                ["connected_accounts.id"],
                name=op.f("fk_post_comments_social_account_id_connected_accounts"),
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["parent_comment_id"],
                ["post_comments.id"],
                name=op.f("fk_post_comments_parent_comment_id_post_comments"),
                ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(
                ["thread_root_id"],
                ["post_comments.id"],
                name=op.f("fk_post_comments_thread_root_id_post_comments"),
                ondelete="SET NULL",
            ),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_post_comments")),
            sa.UniqueConstraint(
                "social_account_id",
                "network",
                "provider_comment_id",
                name="uq_post_comments_account_network_provider",
            ),
        )
        op.create_index(
            "ix_post_comments_post_created",
            "post_comments",
            ["post_id", "created_at_provider"],
        )
        op.create_index(
            "ix_post_comments_account_read",
            "post_comments",
            ["social_account_id", "is_read"],
        )
        op.create_index(
            "ix_post_comments_parent",
            "post_comments",
            ["parent_comment_id"],
        )
    if not _has_table("post_insights_snapshots"):
        op.create_table(
            "post_insights_snapshots",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.Column("post_id", sa.Uuid(), nullable=False),
            sa.Column("social_account_id", sa.Uuid(), nullable=False),
            sa.Column("network", sa.String(length=40), nullable=False),
            sa.Column(
                "captured_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.Column("impressions", sa.Integer(), nullable=True),
            sa.Column("reach", sa.Integer(), nullable=True),
            sa.Column("likes", sa.Integer(), nullable=True),
            sa.Column("comments", sa.Integer(), nullable=True),
            sa.Column("shares", sa.Integer(), nullable=True),
            sa.Column("saves", sa.Integer(), nullable=True),
            sa.Column("clicks", sa.Integer(), nullable=True),
            sa.Column("video_views", sa.Integer(), nullable=True),
            sa.Column("engagement_rate", sa.Float(), nullable=True),
            sa.Column("raw", sa.JSON(), nullable=False),
            sa.ForeignKeyConstraint(
                ["post_id"],
                ["scheduled_posts.id"],
                name=op.f("fk_post_insights_snapshots_post_id_scheduled_posts"),
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["social_account_id"],
                ["connected_accounts.id"],
                name=op.f(
                    "fk_post_insights_snapshots_social_account_id_connected_accounts"
                ),
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_post_insights_snapshots")),
        )
        op.create_index(
            "ix_post_insights_post_captured",
            "post_insights_snapshots",
            ["post_id", "captured_at"],
        )
        op.create_index(
            "ix_post_insights_account_captured",
            "post_insights_snapshots",
            ["social_account_id", "captured_at"],
        )


def downgrade() -> None:
    if _has_table("post_insights_snapshots"):
        op.drop_index(
            "ix_post_insights_account_captured", table_name="post_insights_snapshots"
        )
        op.drop_index(
            "ix_post_insights_post_captured", table_name="post_insights_snapshots"
        )
        op.drop_table("post_insights_snapshots")
    if _has_table("post_comments"):
        op.drop_index("ix_post_comments_parent", table_name="post_comments")
        op.drop_index("ix_post_comments_account_read", table_name="post_comments")
        op.drop_index("ix_post_comments_post_created", table_name="post_comments")
        op.drop_table("post_comments")
