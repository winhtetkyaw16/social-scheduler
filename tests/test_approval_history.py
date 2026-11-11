"""Approved/Rejected history: every decision is kept and listed newest first."""

import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

from sqlalchemy import create_engine, inspect, text

ROOT = Path(__file__).resolve().parents[1]


def _connect(client, headers, platform="facebook", name="History brand"):
    response = client.post(
        "/api/v1/accounts",
        headers=headers,
        json={
            "platform": platform,
            "platform_account_id": f"acct-{uuid4().hex[:8]}",
            "account_name": name,
            "access_token": "token-value",
            "scopes": [],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _pending_item(client, headers, account_id, caption):
    draft = client.post(
        "/api/v1/publish/drafts",
        headers=headers,
        json={
            "content": caption,
            "media_urls": [],
            "post_format": "Post",
            "metadata": {
                "caption": caption,
                "selectedIds": [account_id],
                "scheduleMode": "schedule",
            },
        },
    )
    assert draft.status_code == 201, draft.text
    item_id = draft.json()["id"]
    submitted = client.post(f"/api/v1/publish/drafts/{item_id}/submit", headers=headers)
    assert submitted.status_code == 200, submitted.text
    return item_id


def _decide(client, headers, item_id, decision, comment=None):
    response = client.post(
        f"/api/v1/publish/approvals/{item_id}/decision",
        headers=headers,
        json={"decision": decision, "comment": comment},
    )
    assert response.status_code == 200, response.text


def test_history_lists_decisions_by_status_newest_first(
    client, auth_headers, monkeypatch
):
    headers, _ = auth_headers
    monkeypatch.setattr(
        "app.tasks.publish_post.publish_post_task.apply_async", lambda *a, **k: None
    )
    monkeypatch.setattr(
        "app.api.v1.endpoints.posts.enqueue_immediate_publish", lambda *a, **k: None
    )
    account = _connect(client, headers)
    rejected = _pending_item(client, headers, account["id"], "Rejected caption")
    changes = _pending_item(client, headers, account["id"], "Needs work caption")
    _decide(client, headers, rejected, "rejected", "Off brand")
    _decide(client, headers, changes, "changes_requested", "Shorter please")

    listed = client.get(
        "/api/v1/publish/approvals/history?status=rejected", headers=headers
    )
    assert listed.status_code == 200, listed.text
    rows = listed.json()
    assert [row["content"] for row in rows] == [
        "Needs work caption",
        "Rejected caption",
    ]
    assert rows[1]["decision"] == "rejected"
    assert rows[1]["comment"] == "Off brand"
    assert rows[1]["reviewer_name"] == "Owner Example"
    assert rows[0]["decided_at"] >= rows[1]["decided_at"]

    approved = client.get(
        "/api/v1/publish/approvals/history?status=approved", headers=headers
    )
    assert approved.status_code == 200
    assert approved.json() == []

    everything = client.get("/api/v1/publish/approvals/history", headers=headers)
    assert len(everything.json()) == 2


def test_history_survives_resubmit_and_keeps_snapshot(
    client, auth_headers, monkeypatch
):
    headers, _ = auth_headers
    monkeypatch.setattr(
        "app.tasks.publish_post.publish_post_task.apply_async", lambda *a, **k: None
    )
    account = _connect(client, headers, name="Resubmit brand")
    item_id = _pending_item(client, headers, account["id"], "First version")
    _decide(client, headers, item_id, "changes_requested", "Add a link")
    edited = client.patch(
        f"/api/v1/publish/drafts/{item_id}",
        headers=headers,
        json={"content": "Second version"},
    )
    assert edited.status_code == 200, edited.text
    resubmitted = client.post(
        f"/api/v1/publish/drafts/{item_id}/submit", headers=headers
    )
    assert resubmitted.status_code == 200, resubmitted.text
    _decide(client, headers, item_id, "approved")

    rows = client.get("/api/v1/publish/approvals/history", headers=headers).json()
    assert [(row["decision"], row["content"]) for row in rows] == [
        ("approved", "Second version"),
        ("changes_requested", "First version"),
    ]


def test_history_is_private_and_rejects_unknown_status(client, auth_headers):
    headers, _ = auth_headers
    bad = client.get("/api/v1/publish/approvals/history?status=maybe", headers=headers)
    assert bad.status_code == 422
    assert "approved" in bad.json()["detail"]
    other = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Other",
            "workspace_name": "Other",
            "email": f"other-{uuid4().hex[:6]}@example.com",
            "password": "super-secret-password",
        },
    )
    assert other.status_code == 201
    assert client.get("/api/v1/publish/approvals/history").status_code == 401


def _alembic(url, *args):
    env = os.environ.copy()
    env["DATABASE_URL"] = url
    subprocess.run(
        [sys.executable, "-m", "alembic", *args], cwd=ROOT, env=env, check=True
    )


def test_migration_upgrades_existing_database_and_copies_decisions(tmp_path):
    url = f"sqlite:///{tmp_path / 'existing.db'}"
    _alembic(url, "upgrade", "20261028_queue_slots")
    engine = create_engine(url)
    user_id, item_id, workflow_id = uuid4().hex, uuid4().hex, uuid4().hex
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (id, email, full_name, workspace_name, password_hash, "
                "is_active, is_verified, created_at, updated_at) VALUES "
                "(:id, 'win@example.com', 'Win', 'Studio', 'x', 1, 1, "
                "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": user_id},
        )
        connection.execute(
            text(
                "INSERT INTO publish_items (id, owner_id, content, status, media_urls, "
                "post_format, metadata, created_at, updated_at) VALUES "
                "(:id, :owner, 'Old approved post', 'approved', '[]', 'Post', '{}', "
                "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": item_id, "owner": user_id},
        )
        connection.execute(
            text(
                "INSERT INTO approval_workflows (id, item_id, requested_by_id, reviewer_id, "
                "state, comment, decided_at, created_at, updated_at) VALUES "
                "(:id, :item, :user, :user, 'approved', 'Looks good', "
                "'2026-11-01 10:00:00', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": workflow_id, "item": item_id, "user": user_id},
        )
    _alembic(url, "upgrade", "head")
    assert "approval_decisions" in inspect(engine).get_table_names()
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT decision, comment, reviewer_name, content FROM approval_decisions"
            )
        ).all()
    assert rows == [("approved", "Looks good", "Win", "Old approved post")]

    # The copied row reads back through the ORM like a new one.
    from sqlalchemy.orm import Session

    from app.models import ApprovalDecisionRecord

    with Session(engine) as session:
        record = session.query(ApprovalDecisionRecord).one()
        assert record.owner_id.hex == user_id
        assert record.decided_at.year == 2026

    _alembic(url, "downgrade", "20261028_queue_slots")
    assert "approval_decisions" not in inspect(create_engine(url)).get_table_names()


def test_startup_bootstrap_creates_history_and_copies_old_decisions(tmp_path):
    """Databases created by the app at startup (no Alembic) get the table and backfill."""
    from sqlalchemy.orm import Session

    from app.db.bootstrap import ensure_database_schema
    from app.models import ApprovalDecisionRecord, ApprovalWorkflow, PublishItem, User

    engine = create_engine(f"sqlite:///{tmp_path / 'startup.db'}")
    ensure_database_schema(engine)
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE approval_decisions"))
    with Session(engine) as session:
        user = User(email="w@example.com", full_name="Win", password_hash="x")
        session.add(user)
        session.flush()
        item = PublishItem(
            owner_id=user.id, content="Rejected earlier", status="rejected"
        )
        session.add(item)
        session.flush()
        from datetime import datetime, timezone

        session.add(
            ApprovalWorkflow(
                item_id=item.id,
                requested_by_id=user.id,
                reviewer_id=user.id,
                state="rejected",
                comment="No",
                decided_at=datetime(2026, 11, 2, tzinfo=timezone.utc),
            )
        )
        session.commit()
    ensure_database_schema(engine)
    ensure_database_schema(engine)  # second start: no duplicates
    with Session(engine) as session:
        records = session.query(ApprovalDecisionRecord).all()
        assert [(r.decision, r.content, r.comment) for r in records] == [
            ("rejected", "Rejected earlier", "No")
        ]
