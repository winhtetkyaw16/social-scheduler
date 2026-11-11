"""Bulk CSV upload: template, plain-language row errors, all-or-nothing, user timezone."""

import csv
import io
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Image links must never be fetched while importing."""

    def refuse(*args, **kwargs):
        raise AssertionError("bulk upload tried to download an image")

    # Real network transports only; the in-process TestClient transport still works.
    monkeypatch.setattr("httpx.HTTPTransport.handle_request", refuse)
    monkeypatch.setattr("httpx.AsyncHTTPTransport.handle_async_request", refuse)
    monkeypatch.setattr("urllib.request.urlopen", refuse)


def _connect(client, headers, platform, name):
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


def _csv(rows, header=("date", "time", "channel", "caption", "image_url")):
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(header)
    writer.writerows(rows)
    return out.getvalue().encode("utf-8")


def _upload(client, headers, data, tz="Asia/Bangkok", dry_run=False):
    return client.post(
        "/api/v1/publish/bulk",
        headers=headers,
        files={"file": ("posts.csv", data, "text/csv")},
        data={"timezone": tz, "dry_run": "true" if dry_run else "false"},
    )


def _future(days=3):
    return (datetime.now(timezone.utc) + timedelta(days=days)).date().isoformat()


def _mine(client, headers):
    return [
        post
        for post in client.get("/api/v1/posts", headers=headers).json()
        if post["post_metadata"].get("source") == "csv"
    ]


def test_template_has_header_and_one_example_row(client, auth_headers):
    headers, _ = auth_headers
    _connect(client, headers, "facebook", "Template Page")
    response = client.get("/api/v1/publish/bulk/template", headers=headers)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment" in response.headers["content-disposition"]
    rows = list(csv.reader(io.StringIO(response.text)))
    assert rows[0] == ["date", "time", "channel", "caption", "image_url"]
    assert len(rows) == 2
    assert rows[1][2] == "facebook"
    datetime.strptime(rows[1][0], "%Y-%m-%d")


def test_valid_file_schedules_every_row_in_the_users_timezone(client, auth_headers):
    headers, _ = auth_headers
    _connect(client, headers, "facebook", "Bulk Page")
    _connect(client, headers, "x", "Bulk X (@bulkx)")
    day = _future()
    data = _csv(
        [
            [day, "09:30", "facebook", "Morning post", "https://cdn.example.com/a.jpg"],
            [day, "2:15 PM", "@bulkx", "Afternoon post", ""],
            ["", "", "", "", ""],  # blank rows are ignored
        ]
    )
    preview = _upload(client, headers, data, dry_run=True)
    assert preview.status_code == 200, preview.text
    assert preview.json()["valid_rows"] == 2 and preview.json()["created"] == 0
    assert _mine(client, headers) == []

    result = _upload(client, headers, data)
    body = result.json()
    assert body["errors"] == [] and body["created"] == 2 and body["rows"] == 2
    posts = sorted(_mine(client, headers), key=lambda post: post["scheduled_at"])
    assert [post["content"] for post in posts] == ["Morning post", "Afternoon post"]
    assert all(post["status"] == "scheduled" for post in posts)
    assert posts[0]["media_urls"] == ["https://cdn.example.com/a.jpg"]
    bangkok = ZoneInfo("Asia/Bangkok")
    first = datetime.fromisoformat(posts[0]["scheduled_at"]).astimezone(bangkok)
    second = datetime.fromisoformat(posts[1]["scheduled_at"]).astimezone(bangkok)
    assert (first.hour, first.minute) == (9, 30)
    assert (second.hour, second.minute) == (14, 15)
    assert posts[0]["post_metadata"]["format"] == "Post"

    again = _upload(client, headers, data)
    assert again.json()["errors"] == []
    assert len(_mine(client, headers)) == 2, (
        "uploading the same file twice adds nothing"
    )


def test_bad_rows_return_plain_language_errors_and_create_nothing(client, auth_headers):
    headers, _ = auth_headers
    _connect(client, headers, "facebook", "Errors Page")
    _connect(client, headers, "instagram", "Errors IG")
    day = _future()
    data = _csv(
        [
            [day, "10:00", "facebook", "Fine row", ""],
            ["2026-13-01", "10:00", "facebook", "Bad date", ""],
            [day, "25:00", "facebook", "Bad time", ""],
            [day, "10:00", "tiktok", "Unknown channel", ""],
            [day, "10:00", "facebook", "", ""],
            [day, "10:00", "facebook", "Bad link", "not-a-link"],
            ["2020-01-01", "10:00", "facebook", "Past", ""],
            [day, "10:00", "instagram", "Instagram without a photo", ""],
            ["20/11/2026", "10:00", "facebook", "Wrong date shape", ""],
        ]
    )
    response = _upload(client, headers, data)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created"] == 0
    messages = [error["message"] for error in body["errors"]]
    assert 'Row 3: the date "2026-13-01" isn\'t a real date.' in messages
    assert any(
        m.startswith('Row 4: the time "25:00" isn\'t a real time') for m in messages
    )
    assert 'Row 5: no connected channel called "tiktok".' in messages
    assert "Row 6: the caption is empty." in messages
    assert any(m.startswith('Row 7: the image link "not-a-link"') for m in messages)
    assert any(m.startswith("Row 8: 2020-01-01 10:00 is in the past") for m in messages)
    assert any(m.startswith("Row 9:") and "Instagram" in m for m in messages)
    assert any(
        m.startswith('Row 10: the date "20/11/2026" should look like') for m in messages
    )
    assert not any(m.startswith("Row 2:") for m in messages)
    for message in messages:
        assert "_" not in message.split(":", 1)[1].replace("image_url", ""), message
    assert _mine(client, headers) == [], (
        "all or nothing: the good row was not scheduled"
    )


def test_ambiguous_channel_and_missing_column(client, auth_headers):
    headers, _ = auth_headers
    _connect(client, headers, "facebook", "Cafe One")
    _connect(client, headers, "facebook", "Cafe Two")
    day = _future()
    ambiguous = _upload(client, headers, _csv([[day, "10:00", "facebook", "Hi", ""]]))
    (error,) = ambiguous.json()["errors"]
    assert error["row"] == 2
    assert "2 Facebook channels" in error["message"] and "Cafe One" in error["message"]

    by_name = _upload(client, headers, _csv([[day, "10:00", "cafe two", "Hi", ""]]))
    assert by_name.json()["created"] == 1

    missing = _upload(client, headers, _csv([[day, "Hi"]], header=("date", "caption")))
    (error,) = missing.json()["errors"]
    assert error["message"].startswith(
        'Row 1: the file is missing the "time", "channel" columns'
    )


def test_unreadable_or_empty_files_and_bad_timezone(client, auth_headers):
    headers, _ = auth_headers
    empty = _upload(client, headers, b"")
    assert empty.json()["errors"][0]["message"] == "This file is empty."
    header_only = _upload(client, headers, _csv([]))
    assert "no posts" in header_only.json()["errors"][0]["message"]
    binary = _upload(client, headers, b"\x00\x01\x02")
    assert "couldn't read" in binary.json()["errors"][0]["message"]
    bad_tz = _upload(client, headers, _csv([]), tz="Mars/Base")
    assert "timezone" in bad_tz.json()["errors"][0]["message"]


def test_bulk_upload_requires_sign_in(client):
    assert client.get("/api/v1/publish/bulk/template").status_code == 401
    assert (
        client.post(
            "/api/v1/publish/bulk", files={"file": ("a.csv", b"date\n", "text/csv")}
        ).status_code
        == 401
    )
