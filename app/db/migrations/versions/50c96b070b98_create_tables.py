"""create tables

Revision ID: 50c96b070b98
Revises: cb8a3ad113fa
Create Date: 2026-10-07 20:16:27.795153
"""

revision = "50c96b070b98"
down_revision = "cb8a3ad113fa"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Keep the schema unchanged; this revision is a named no-op checkpoint."""


def downgrade() -> None:
    """Keep the schema unchanged when reverting the no-op checkpoint."""
