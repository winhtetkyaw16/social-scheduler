"""Bulk CSV scheduling: validate every row, then create all posts or none.

Columns: date, time, channel, caption, image_url (image_url is optional).
Dates and times are read in the user's timezone (sent by the app from Settings).
Row numbers in messages match the spreadsheet: the header is row 1.

Image links are stored as given and are not downloaded here; the publisher fetches
them at publish time, the same as links added in the composer.
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from urllib.parse import urlparse
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ConnectedAccount, ScheduledPost

COLUMNS = ("date", "time", "channel", "caption", "image_url")
REQUIRED = ("date", "time", "channel", "caption")
MAX_ROWS = 500
MAX_BYTES = 1_000_000
MAX_CAPTION = 10000

_ISO_DATE = re.compile(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$")
_TIME_24 = re.compile(r"^(\d{1,2}):(\d{2})$")
_TIME_12 = re.compile(r"^(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]\.?$")
_HANDLE_SUFFIX = re.compile(r"\s*\(@[^)]*\)\s*$")


@dataclass
class RowError:
    row: int | None
    message: str


@dataclass
class ParsedRow:
    row: int
    account: ConnectedAccount
    scheduled_at: datetime
    caption: str
    media_urls: list[str]
    post_format: str


@dataclass
class BulkResult:
    rows: int = 0
    created_ids: list[UUID] = field(default_factory=list)
    errors: list[RowError] = field(default_factory=list)
    valid: list[ParsedRow] = field(default_factory=list)

    def as_dict(self, dry_run: bool) -> dict[str, Any]:
        return {
            "rows": self.rows,
            "valid_rows": len(self.valid),
            "created": len(self.created_ids),
            "post_ids": [str(item) for item in self.created_ids],
            "errors": [
                {
                    "row": err.row,
                    "message": (
                        f"Row {err.row}: {err.message}." if err.row else err.message
                    ),
                }
                for err in self.errors
            ],
            "dry_run": dry_run,
        }


def template_csv(example_channel: str = "facebook", today: date | None = None) -> str:
    """Header row plus one example row dated a week from today."""
    when = (today or datetime.now(timezone.utc).date()) + timedelta(days=7)
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(COLUMNS)
    writer.writerow(
        [
            when.isoformat(),
            "09:30",
            example_channel,
            "Replace this example with your first post.",
            "",
        ]
    )
    return out.getvalue()


def _plain(value: object) -> str:
    return str(value or "").strip()


def _parse_date(text: str) -> tuple[date | None, str | None]:
    match = _ISO_DATE.match(text)
    if not match:
        return None, f'the date "{text}" should look like 2026-11-20 (year-month-day)'
    try:
        return date(int(match[1]), int(match[2]), int(match[3])), None
    except ValueError:
        return None, f'the date "{text}" isn\'t a real date'


def _parse_time(text: str) -> tuple[time | None, str | None]:
    bad = (
        f'the time "{text}" isn\'t a real time. Use 24-hour time like 14:30, or 2:30 PM'
    )
    match = _TIME_24.match(text)
    if match:
        hour, minute = int(match[1]), int(match[2])
        if hour > 23 or minute > 59:
            return None, bad
        return time(hour, minute), None
    match = _TIME_12.match(text)
    if match:
        hour, minute = int(match[1]), int(match[2] or 0)
        if not 1 <= hour <= 12 or minute > 59:
            return None, bad
        hour = hour % 12 + (12 if match[3].lower() == "p" else 0)
        return time(hour, minute), None
    return None, bad


def _names_for(account: ConnectedAccount) -> set[str]:
    """Lower-case names a CSV may use for this channel: name, name without (@x), @handle."""
    names = set()
    name = _plain(account.account_name)
    if name:
        names.add(name.lower())
        names.add(_HANDLE_SUFFIX.sub("", name).lower())
        handle = re.search(r"\(@([^)]*)\)\s*$", name)
        if handle:
            names.update({handle[1].lower(), f"@{handle[1].lower()}"})
    extra = account.extra_metadata if isinstance(account.extra_metadata, dict) else {}
    for key in ("username", "screen_name", "handle"):
        value = _plain(extra.get(key)).lstrip("@").lower()
        if value:
            names.update({value, f"@{value}"})
    names.discard("")
    return names


def _resolve_channel(
    text: str, accounts: list[ConnectedAccount]
) -> tuple[ConnectedAccount | None, str | None]:
    from app.services.error_messages import network_name

    wanted = text.strip().lower()
    by_name = [account for account in accounts if wanted in _names_for(account)]
    if len(by_name) == 1:
        return by_name[0], None
    platform = "x" if wanted == "twitter" else wanted
    by_platform = [account for account in accounts if account.platform == platform]
    matches = by_name or by_platform
    if len(matches) == 1:
        return matches[0], None
    if len(matches) > 1:
        names = ", ".join(_HANDLE_SUFFIX.sub("", a.account_name) for a in matches[:3])
        label = network_name(platform) if by_platform and not by_name else f'"{text}"'
        return None, (
            f"you have {len(matches)} {label} channels ({names}). "
            "Use the channel's name instead"
        )
    return None, f'no connected channel called "{text}"'


def _check_image(text: str) -> str | None:
    parsed = urlparse(text)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return (
            f'the image link "{text[:80]}" isn\'t a web address starting with https://'
        )
    return None


def _format_for(platform: str, media: list[str]) -> str:
    from app.services.error_messages import is_video_url
    from app.services.post_formats import POST, REEL

    if platform == "youtube" or any(is_video_url(url) for url in media):
        return REEL
    return POST


def _decode(data: bytes) -> str | None:
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return None


def validate_csv(
    db: Session,
    user_id: UUID,
    data: bytes,
    timezone_name: str,
    now: datetime | None = None,
) -> BulkResult:
    """Check every row. Nothing is written to the database here."""
    from app.integrations.registry import supported_platform_names
    from app.services.error_messages import network_name
    from app.services.posts import publish_problem

    result = BulkResult()
    now = now or datetime.now(timezone.utc)
    try:
        zone = ZoneInfo(timezone_name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        result.errors.append(
            RowError(
                None,
                "We couldn't use your timezone setting. Check Settings and try again.",
            )
        )
        return result
    if len(data) > MAX_BYTES:
        result.errors.append(
            RowError(
                None, "This file is too big. Split it into files of up to 500 rows."
            )
        )
        return result
    text = _decode(data)
    if text is None or "\x00" in text:
        result.errors.append(
            RowError(
                None, "We couldn't read this file. Save it as a CSV file and try again."
            )
        )
        return result
    reader = csv.reader(io.StringIO(text))
    try:
        header = next(reader)
    except StopIteration:
        result.errors.append(RowError(None, "This file is empty."))
        return result
    except csv.Error:
        result.errors.append(
            RowError(
                None, "We couldn't read this file. Save it as a CSV file and try again."
            )
        )
        return result
    columns = [_plain(name).lower().replace(" ", "_") for name in header]
    missing = [name for name in REQUIRED if name not in columns]
    if missing:
        listed = ", ".join(f'"{name}"' for name in missing)
        result.errors.append(
            RowError(
                1,
                f"the file is missing the {listed} column{'s' if len(missing) > 1 else ''}. "
                "Download the template to see the columns",
            )
        )
        return result
    index = {name: columns.index(name) for name in COLUMNS if name in columns}

    accounts = list(
        db.scalars(
            select(ConnectedAccount).where(
                ConnectedAccount.user_id == user_id,
                ConnectedAccount.is_active.is_(True),
            )
        ).all()
    )
    supported = supported_platform_names()

    def cell(values: list[str], name: str) -> str:
        position = index.get(name)
        if position is None or position >= len(values):
            return ""
        return _plain(values[position])

    row_number = 1
    try:
        for values in reader:
            row_number += 1
            if not any(_plain(value) for value in values):
                continue
            result.rows += 1
            if result.rows > MAX_ROWS:
                result.errors.append(
                    RowError(
                        None,
                        f"This file has more than {MAX_ROWS} posts. Split it into smaller files.",
                    )
                )
                return result
            problems: list[str] = []
            date_text, time_text = cell(values, "date"), cell(values, "time")
            channel_text, caption = cell(values, "channel"), cell(values, "caption")
            image_text = cell(values, "image_url")
            day = clock = None
            if not date_text:
                problems.append("the date is empty")
            else:
                day, problem = _parse_date(date_text)
                if problem:
                    problems.append(problem)
            if not time_text:
                problems.append("the time is empty")
            else:
                clock, problem = _parse_time(time_text)
                if problem:
                    problems.append(problem)
            account = None
            if not channel_text:
                problems.append("the channel is empty")
            else:
                account, problem = _resolve_channel(channel_text, accounts)
                if problem:
                    problems.append(problem)
                elif account.platform not in supported:
                    problems.append(
                        f"you can't post to {network_name(account.platform)} from here yet"
                    )
                    account = None
            if not caption:
                problems.append("the caption is empty")
            elif len(caption) > MAX_CAPTION:
                problems.append(
                    f"the caption is longer than {MAX_CAPTION:,} characters"
                )
            media: list[str] = []
            if image_text:
                problem = _check_image(image_text)
                if problem:
                    problems.append(problem)
                else:
                    media = [image_text]
            scheduled_at = None
            if day and clock:
                scheduled_at = datetime.combine(day, clock, tzinfo=zone)
                if scheduled_at <= now:
                    problems.append(
                        f"{date_text} {time_text} is in the past. Choose a future date and time"
                    )
            if account is not None and caption and not problems:
                post_format = _format_for(account.platform, media)
                problem = publish_problem(account.platform, media, caption, post_format)
                if problem:
                    problems.append(
                        problem.rstrip(". ").replace(" Nothing was published", "")
                    )
            if problems:
                for problem in problems:
                    result.errors.append(RowError(row_number, problem))
                continue
            result.valid.append(
                ParsedRow(
                    row=row_number,
                    account=account,
                    scheduled_at=scheduled_at.astimezone(timezone.utc),
                    caption=caption,
                    media_urls=media,
                    post_format=_format_for(account.platform, media),
                )
            )
    except csv.Error:
        result.errors.append(
            RowError(
                row_number, "this row couldn't be read. Check for a stray quote mark"
            )
        )
    if result.rows == 0 and not result.errors:
        result.errors.append(
            RowError(None, "This file has no posts in it. Add a row under the header.")
        )
    return result


def _key(user_id: UUID, row: ParsedRow) -> str:
    digest = hashlib.sha256(
        "|".join(
            [
                str(user_id),
                str(row.account.id),
                row.scheduled_at.strftime("%Y-%m-%dT%H:%M"),
                row.caption,
                *row.media_urls,
            ]
        ).encode("utf-8")
    ).hexdigest()
    return f"csv:{digest[:48]}"


def import_csv(
    db: Session,
    user_id: UUID,
    data: bytes,
    timezone_name: str,
    *,
    dry_run: bool = False,
    now: datetime | None = None,
) -> BulkResult:
    """Validate, then (unless dry_run or any row has a problem) create every post at once.

    All or nothing: one bad row means nothing is scheduled, so a fixed file can be
    uploaded again without leaving half of the posts behind. Uploading the same row
    twice does not create a second post (idempotency key per row).
    """
    result = validate_csv(db, user_id, data, timezone_name, now=now)
    if dry_run or result.errors or not result.valid:
        return result
    posts: list[ScheduledPost] = []
    seen: set[str] = set()
    for row in result.valid:
        key = _key(user_id, row)
        if key in seen:
            continue
        seen.add(key)
        existing = db.scalar(
            select(ScheduledPost).where(ScheduledPost.idempotency_key == key)
        )
        if existing is not None:
            posts.append(existing)
            continue
        post = ScheduledPost(
            user_id=user_id,
            connected_account_id=row.account.id,
            content=row.caption,
            media_urls=row.media_urls,
            scheduled_at=row.scheduled_at,
            status="scheduled",
            idempotency_key=key,
            post_metadata={
                "format": row.post_format,
                "settings": {},
                "source": "csv",
                "scheduleMode": "schedule",
                "csv_row": row.row,
            },
        )
        db.add(post)
        posts.append(post)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    result.created_ids = [post.id for post in posts]
    return result
