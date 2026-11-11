"""Track accounts that need a reconnect, and clear copied expiries on Page tokens.

Facebook Page tokens and Instagram tokens taken from a Page are non-expiring
when they were minted from a long-lived user token. Older rows stored the user
token's expiry (about 60 days) on those destinations, which made the UI ask
for a reconnect the Page token does not need.
"""

import json

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "20261111_token_refresh_state"
down_revision = "20261028_queue_slots"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    cols = {c["name"] for c in inspect(bind).get_columns(table)}
    return column in cols


def _as_dict(value) -> dict:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str) and value.strip():
        try:
            loaded = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return dict(loaded) if isinstance(loaded, dict) else {}
    return {}


def _clear_non_expiring_page_tokens() -> None:
    """Null the copied user-token expiry on Page-backed destinations."""
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, platform, account_type, extra_metadata FROM connected_accounts"
        )
    ).fetchall()
    for row in rows:
        meta = _as_dict(row.extra_metadata)
        platform = (row.platform or "").strip().lower()
        account_type = (row.account_type or "").strip().lower()
        page = platform == "facebook" and account_type == "page"
        instagram_page = platform == "instagram" and bool(
            meta.get("linked_facebook_page_id")
        )
        if not page and not instagram_page:
            continue
        meta["token_lifetime"] = "non_expiring"
        payload = json.dumps(meta)
        if bind.dialect.name == "postgresql":
            bind.execute(
                sa.text(
                    "UPDATE connected_accounts SET token_expires_at = NULL, "
                    "refresh_token_ciphertext = NULL, "
                    "extra_metadata = CAST(:meta AS JSON) WHERE id = :id"
                ),
                {"meta": payload, "id": row.id},
            )
        else:
            bind.execute(
                sa.text(
                    "UPDATE connected_accounts SET token_expires_at = NULL, "
                    "refresh_token_ciphertext = NULL, "
                    "extra_metadata = :meta WHERE id = :id"
                ),
                {"meta": payload, "id": row.id},
            )


def upgrade() -> None:
    if not _has_column("connected_accounts", "needs_reconnect"):
        with op.batch_alter_table("connected_accounts") as batch:
            batch.add_column(
                sa.Column(
                    "needs_reconnect",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                )
            )
    if not _has_column("connected_accounts", "reconnect_reason"):
        with op.batch_alter_table("connected_accounts") as batch:
            batch.add_column(sa.Column("reconnect_reason", sa.Text(), nullable=True))
    _clear_non_expiring_page_tokens()


def downgrade() -> None:
    # Page-token expiries stay cleared: those tokens do not expire.
    if _has_column("connected_accounts", "reconnect_reason"):
        with op.batch_alter_table("connected_accounts") as batch:
            batch.drop_column("reconnect_reason")
    if _has_column("connected_accounts", "needs_reconnect"):
        with op.batch_alter_table("connected_accounts") as batch:
            batch.drop_column("needs_reconnect")
