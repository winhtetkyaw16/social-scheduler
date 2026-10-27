"""Add workspaces table and user profile columns."""

import sqlalchemy as sa
from alembic import op

revision = "20261010_workspaces"
down_revision = "20261010_auth_profile"
branch_labels = None
depends_on = None


def upgrade() -> None:
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
    if not inspector.has_table("workspaces"):
        op.create_table(
            "workspaces",
            sa.Column("name", sa.String(length=160), nullable=False),
            sa.Column("owner_id", sa.Uuid(), nullable=False),
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_workspaces_owner_id"), "workspaces", ["owner_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_workspaces_owner_id"), table_name="workspaces")
    op.drop_table("workspaces")
