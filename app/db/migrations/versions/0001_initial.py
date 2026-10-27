"""Create the initial model tables.

Revision ID: 0001_initial
Revises:
"""

import sqlalchemy as sa
from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("is_verified", sa.Boolean(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "connected_accounts",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("platform", sa.String(40), nullable=False),
        sa.Column("platform_account_id", sa.String(255), nullable=False),
        sa.Column("account_name", sa.String(255), nullable=False),
        sa.Column("access_token_ciphertext", sa.Text(), nullable=False),
        sa.Column("refresh_token_ciphertext", sa.Text(), nullable=True),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("scopes", sa.JSON(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_connected_accounts_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_connected_accounts")),
        sa.UniqueConstraint(
            "user_id", "platform", "platform_account_id", name="uq_connected_account_owner_platform_identity"
        ),
    )
    op.create_index("ix_connected_accounts_user_platform", "connected_accounts", ["user_id", "platform"], unique=False)

    op.create_table(
        "scheduled_posts",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("connected_account_id", sa.Uuid(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("media_urls", sa.JSON(), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("max_attempts", sa.Integer(), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("provider_post_id", sa.String(255), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_code", sa.String(100), nullable=True),
        sa.Column("last_error_message", sa.Text(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('draft','scheduled','queued','publishing','published','failed','cancelled')",
            name=op.f("ck_scheduled_posts_valid_status"),
        ),
        sa.CheckConstraint(
            "attempt_count >= 0 AND max_attempts > 0", name=op.f("ck_scheduled_posts_valid_attempt_limits")
        ),
        sa.ForeignKeyConstraint(
            ["connected_account_id"],
            ["connected_accounts.id"],
            name=op.f("fk_scheduled_posts_connected_account_id_connected_accounts"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_scheduled_posts_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_scheduled_posts")),
        sa.UniqueConstraint("idempotency_key", name=op.f("uq_scheduled_posts_idempotency_key")),
    )
    op.create_index("ix_posts_due", "scheduled_posts", ["status", "scheduled_at"], unique=False)
    op.create_index("ix_posts_user_created", "scheduled_posts", ["user_id", "created_at"], unique=False)

    op.create_table(
        "execution_logs",
        sa.Column("scheduled_post_id", sa.Uuid(), nullable=False),
        sa.Column("attempt_number", sa.Integer(), nullable=False),
        sa.Column("outcome", sa.String(20), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("provider_request_id", sa.String(255), nullable=True),
        sa.Column("provider_status_code", sa.Integer(), nullable=True),
        sa.Column("error_code", sa.String(100), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "outcome IN ('started','succeeded','retrying','failed','skipped')",
            name=op.f("ck_execution_logs_valid_outcome"),
        ),
        sa.CheckConstraint("attempt_number > 0", name=op.f("ck_execution_logs_positive_attempt_number")),
        sa.ForeignKeyConstraint(
            ["scheduled_post_id"],
            ["scheduled_posts.id"],
            name=op.f("fk_execution_logs_scheduled_post_id_scheduled_posts"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_execution_logs")),
    )
    op.create_index(
        "ix_execution_logs_post_created", "execution_logs", ["scheduled_post_id", "created_at"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_execution_logs_post_created", table_name="execution_logs")
    op.drop_table("execution_logs")
    op.drop_index("ix_posts_user_created", table_name="scheduled_posts")
    op.drop_index("ix_posts_due", table_name="scheduled_posts")
    op.drop_table("scheduled_posts")
    op.drop_index("ix_connected_accounts_user_platform", table_name="connected_accounts")
    op.drop_table("connected_accounts")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
