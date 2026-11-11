"""Add approval_decisions history table and copy existing decisions into it."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "20261111_approval_decisions"
down_revision = "20261111_token_refresh_state"
branch_labels = None
depends_on = None


def _has_table(table: str) -> bool:
    bind = op.get_bind()
    return table in inspect(bind).get_table_names()


def _backfill() -> None:
    """One history row per decision already stored on approval_workflows.

    Done in SQL so stored values (UUIDs, timestamps, JSON) are copied as they are.
    """
    bind = op.get_bind()
    new_id = (
        "gen_random_uuid()"
        if bind.dialect.name == "postgresql"
        else "lower(hex(randomblob(16)))"
    )
    op.execute(
        sa.text(
            "INSERT INTO approval_decisions (id, created_at, updated_at, owner_id, "
            "item_id, reviewer_id, reviewer_name, decision, comment, decided_at, "
            "content, media_urls, post_format, scheduled_at, metadata) "
            f"SELECT {new_id}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, i.owner_id, "
            "w.item_id, w.reviewer_id, "
            "SUBSTR(COALESCE(NULLIF(u.full_name, ''), u.email, ''), 1, 160), "
            "w.state, w.comment, w.decided_at, COALESCE(i.content, ''), "
            "i.media_urls, COALESCE(i.post_format, 'Post'), i.scheduled_at, i.metadata "
            "FROM approval_workflows w "
            "JOIN publish_items i ON i.id = w.item_id "
            "LEFT JOIN users u ON u.id = w.reviewer_id "
            "WHERE w.decided_at IS NOT NULL "
            "AND w.state IN ('approved', 'rejected', 'changes_requested')"
        )
    )


def upgrade() -> None:
    if _has_table("approval_decisions"):
        return
    op.create_table(
        "approval_decisions",
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
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("item_id", sa.Uuid(), nullable=True),
        sa.Column("reviewer_id", sa.Uuid(), nullable=True),
        sa.Column("reviewer_name", sa.String(length=160), nullable=False),
        sa.Column("decision", sa.String(length=32), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("media_urls", sa.JSON(), nullable=False),
        sa.Column("post_format", sa.String(length=32), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(
            ["owner_id"],
            ["users.id"],
            name=op.f("fk_approval_decisions_owner_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["item_id"],
            ["publish_items.id"],
            name=op.f("fk_approval_decisions_item_id_publish_items"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["reviewer_id"],
            ["users.id"],
            name=op.f("fk_approval_decisions_reviewer_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_approval_decisions")),
    )
    op.create_index(
        "ix_approval_decisions_owner_decided",
        "approval_decisions",
        ["owner_id", "decided_at"],
    )
    op.create_index(
        op.f("ix_approval_decisions_decision"), "approval_decisions", ["decision"]
    )
    _backfill()


def downgrade() -> None:
    if not _has_table("approval_decisions"):
        return
    op.drop_index(
        op.f("ix_approval_decisions_decision"), table_name="approval_decisions"
    )
    op.drop_index(
        "ix_approval_decisions_owner_decided", table_name="approval_decisions"
    )
    op.drop_table("approval_decisions")
