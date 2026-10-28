"""Add account_type/parent + oauth destination pick sessions."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20261028_account_types"
down_revision = "20261022_post_internal_comments"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    cols = {c["name"] for c in inspect(bind).get_columns(table)}
    return column in cols


def _has_table(table: str) -> bool:
    bind = op.get_bind()
    return table in inspect(bind).get_table_names()


def upgrade() -> None:
    if not _has_column("connected_accounts", "account_type"):
        with op.batch_alter_table("connected_accounts") as batch:
            batch.add_column(sa.Column("account_type", sa.String(length=40), nullable=False, server_default="user"))
            batch.add_column(sa.Column("parent_account_id", sa.Uuid(), nullable=True))
            batch.add_column(sa.Column("extra_metadata", sa.JSON(), nullable=False, server_default="{}"))
            batch.create_foreign_key(
                "fk_connected_accounts_parent_account_id",
                "connected_accounts",
                ["parent_account_id"],
                ["id"],
                ondelete="SET NULL",
            )
            batch.create_index("ix_connected_accounts_parent_account_id", ["parent_account_id"])

    if not _has_table("oauth_pick_sessions"):
        op.create_table(
            "oauth_pick_sessions",
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("platform", sa.String(length=40), nullable=False),
            sa.Column("access_token_ciphertext", sa.Text(), nullable=False),
            sa.Column("refresh_token_ciphertext", sa.Text(), nullable=True),
            sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("scopes", sa.JSON(), nullable=False),
            sa.Column("identity_json", sa.JSON(), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_oauth_pick_sessions_user_platform", "oauth_pick_sessions", ["user_id", "platform"])
        op.create_index("ix_oauth_pick_sessions_user_id", "oauth_pick_sessions", ["user_id"])


def downgrade() -> None:
    if _has_table("oauth_pick_sessions"):
        try:
            op.drop_index("ix_oauth_pick_sessions_user_id", table_name="oauth_pick_sessions")
        except Exception:
            pass
        try:
            op.drop_index("ix_oauth_pick_sessions_user_platform", table_name="oauth_pick_sessions")
        except Exception:
            pass
        op.drop_table("oauth_pick_sessions")
    if _has_column("connected_accounts", "account_type"):
        with op.batch_alter_table("connected_accounts") as batch:
            try:
                batch.drop_index("ix_connected_accounts_parent_account_id")
            except Exception:
                pass
            try:
                batch.drop_constraint("fk_connected_accounts_parent_account_id", type_="foreignkey")
            except Exception:
                pass
            batch.drop_column("extra_metadata")
            batch.drop_column("parent_account_id")
            batch.drop_column("account_type")
