"""Store a user's display name and workspace label."""

from alembic import op
import sqlalchemy as sa

revision = "20261010_auth_profile"
down_revision = "20261009_archive"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add profile fields while supplying values for existing accounts."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    if "full_name" not in user_columns:
        op.add_column(
            "users",
            sa.Column("full_name", sa.String(length=160), nullable=False, server_default=""),
        )
    if "workspace_name" not in user_columns:
        op.add_column(
            "users",
            sa.Column("workspace_name", sa.String(length=160), nullable=False, server_default="My Workspace"),
        )


def downgrade() -> None:
    """Remove profile fields introduced by this revision."""
    op.drop_column("users", "workspace_name")
    op.drop_column("users", "full_name")
