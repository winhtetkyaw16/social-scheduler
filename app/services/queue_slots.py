"""CRUD and next-slot allocation for Buffer-style posting queues."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import ConnectedAccount, QueueSlot, ScheduledPost
from app.schemas.queue import QueueAllocateResponse, QueueNextRead, QueueSlotInput, QueueSlotsReplace, QueueUpcomingItem

# Buffer-like weekday defaults (Mon–Fri mornings / midday / evenings).
DEFAULT_WEEKDAY_TIMES = ("09:00", "12:30", "17:00")
DEFAULT_WEEKENDS: tuple[str, ...] = ("10:00", "16:00")
OCCUPY_STATUSES = {"scheduled", "queued", "publishing"}


def default_slot_plan(timezone_name: str = "UTC") -> list[tuple[int, str, str]]:
    rows: list[tuple[int, str, str]] = []
    for weekday in range(0, 5):
        for clock in DEFAULT_WEEKDAY_TIMES:
            rows.append((weekday, clock, timezone_name))
    for weekday in (5, 6):
        for clock in DEFAULT_WEEKENDS:
            rows.append((weekday, clock, timezone_name))
    return rows


def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError as exc:
        raise HTTPException(status_code=422, detail=f"Unknown timezone: {name}") from exc


def list_slots(db: Session, user_id: UUID, platform: str | None = None) -> list[QueueSlot]:
    stmt = select(QueueSlot).where(QueueSlot.user_id == user_id)
    if platform:
        stmt = stmt.where(QueueSlot.platform == platform)
    stmt = stmt.order_by(QueueSlot.platform, QueueSlot.weekday, QueueSlot.time_local)
    return list(db.scalars(stmt).all())


def replace_platform_slots(db: Session, user_id: UUID, payload: QueueSlotsReplace) -> list[QueueSlot]:
    platform = payload.platform.strip().lower()
    if not platform:
        raise HTTPException(status_code=422, detail="platform is required")
    _zone(payload.timezone)
    # Dedupe inputs
    seen: set[tuple[int, str]] = set()
    clean: list[QueueSlotInput] = []
    for item in payload.slots:
        key = (item.weekday, item.time_local)
        if key in seen:
            continue
        seen.add(key)
        clean.append(item)
    db.execute(delete(QueueSlot).where(QueueSlot.user_id == user_id, QueueSlot.platform == platform))
    rows = [
        QueueSlot(
            user_id=user_id,
            platform=platform,
            weekday=item.weekday,
            time_local=item.time_local,
            timezone=payload.timezone,
        )
        for item in clean
    ]
    db.add_all(rows)
    db.commit()
    return list_slots(db, user_id, platform)


def _slots_for_platform(db: Session, user_id: UUID, platform: str, timezone_name: str) -> tuple[list[tuple[int, str, str]], bool]:
    rows = list_slots(db, user_id, platform)
    if rows:
        return [(row.weekday, row.time_local, row.timezone) for row in rows], False
    return default_slot_plan(timezone_name), True


def _occupied_keys(db: Session, account_id: UUID) -> set[str]:
    posts = db.scalars(
        select(ScheduledPost).where(
            ScheduledPost.connected_account_id == account_id,
            ScheduledPost.status.in_(OCCUPY_STATUSES),
        )
    ).all()
    keys: set[str] = set()
    for post in posts:
        when = post.scheduled_at
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        keys.add(when.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M"))
    return keys


def _iter_candidate_datetimes(
    slot_plan: list[tuple[int, str, str]],
    start: datetime,
    horizon_days: int = 60,
):
    """Yield (aware_utc_dt, weekday, time_local, tz_name) from start forward."""
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    # Group times by weekday
    by_day: dict[int, list[tuple[str, str]]] = {}
    for weekday, clock, tz_name in slot_plan:
        by_day.setdefault(weekday, []).append((clock, tz_name))
    for weekday in by_day:
        by_day[weekday].sort(key=lambda item: item[0])

    day = start.astimezone(timezone.utc).date()
    for _ in range(horizon_days + 1):
        # Python weekday: Mon=0 … Sun=6 — matches our schema
        weekday = day.weekday()
        for clock, tz_name in by_day.get(weekday, []):
            hour, minute = map(int, clock.split(":"))
            local = datetime(day.year, day.month, day.day, hour, minute, tzinfo=_zone(tz_name))
            aware = local.astimezone(timezone.utc)
            if aware <= start:
                continue
            yield aware, weekday, clock, tz_name
        day = day + timedelta(days=1)


def next_slot_for_account(
    db: Session,
    user_id: UUID,
    account: ConnectedAccount,
    *,
    reserved: set[str] | None = None,
    timezone_fallback: str = "UTC",
) -> QueueNextRead:
    occupied = _occupied_keys(db, account.id)
    if reserved:
        occupied |= reserved
    plan, using_defaults = _slots_for_platform(db, user_id, account.platform, timezone_fallback)
    now = datetime.now(timezone.utc)
    for aware, weekday, clock, tz_name in _iter_candidate_datetimes(plan, now):
        key = aware.strftime("%Y-%m-%dT%H:%M")
        if key in occupied:
            continue
        return QueueNextRead(
            connected_account_id=account.id,
            platform=account.platform,
            scheduled_at=aware,
            weekday=weekday,
            time_local=clock,
            timezone=tz_name,
            using_defaults=using_defaults,
        )
    raise HTTPException(status_code=409, detail="No free queue slot found in the next 60 days. Add more times or free a slot.")


def allocate_slots(
    db: Session,
    user_id: UUID,
    account_ids: list[UUID],
    timezone_fallback: str = "UTC",
) -> QueueAllocateResponse:
    accounts = list(
        db.scalars(
            select(ConnectedAccount).where(
                ConnectedAccount.user_id == user_id,
                ConnectedAccount.id.in_(account_ids),
                ConnectedAccount.is_active.is_(True),
            )
        ).all()
    )
    by_id = {account.id: account for account in accounts}
    missing = [str(item) for item in account_ids if item not in by_id]
    if missing:
        raise HTTPException(status_code=404, detail=f"Active account not found: {', '.join(missing)}")
    reserved: set[str] = set()
    # Per-account reserved (allocation only blocks that account's own queue)
    reserved_by_account: dict[UUID, set[str]] = {account_id: set() for account_id in account_ids}
    allocations: list[QueueNextRead] = []
    for account_id in account_ids:
        account = by_id[account_id]
        local_reserved = reserved_by_account[account_id]
        choice = next_slot_for_account(
            db, user_id, account, reserved=local_reserved, timezone_fallback=timezone_fallback
        )
        key = choice.scheduled_at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M")
        local_reserved.add(key)
        allocations.append(choice)
    return QueueAllocateResponse(allocations=allocations)


def upcoming_queue(
    db: Session,
    user_id: UUID,
    *,
    days: int = 14,
    timezone_fallback: str = "UTC",
) -> list[QueueUpcomingItem]:
    days = max(1, min(int(days or 14), 60))
    accounts = list(
        db.scalars(
            select(ConnectedAccount).where(
                ConnectedAccount.user_id == user_id,
                ConnectedAccount.is_active.is_(True),
            )
        ).all()
    )
    if not accounts:
        return []

    posts = list(
        db.scalars(
            select(ScheduledPost).where(
                ScheduledPost.user_id == user_id,
                ScheduledPost.status.in_(OCCUPY_STATUSES),
            )
        ).all()
    )
    posts_by_account: dict[UUID, list[ScheduledPost]] = {}
    for post in posts:
        posts_by_account.setdefault(post.connected_account_id, []).append(post)

    now = datetime.now(timezone.utc)
    end = now + timedelta(days=days)
    items: list[QueueUpcomingItem] = []

    platforms = sorted({account.platform for account in accounts})
    plans: dict[str, tuple[list[tuple[int, str, str]], bool]] = {
        platform: _slots_for_platform(db, user_id, platform, timezone_fallback) for platform in platforms
    }

    for account in accounts:
        plan, _ = plans[account.platform]
        account_posts = posts_by_account.get(account.id, [])
        used_post_ids: set[UUID] = set()
        for aware, weekday, clock, tz_name in _iter_candidate_datetimes(plan, now, horizon_days=days + 1):
            if aware > end:
                break
            match = None
            for post in account_posts:
                if post.id in used_post_ids:
                    continue
                when = post.scheduled_at
                if when.tzinfo is None:
                    when = when.replace(tzinfo=timezone.utc)
                if when.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M") == aware.strftime("%Y-%m-%dT%H:%M"):
                    match = post
                    break
            if match:
                used_post_ids.add(match.id)
            items.append(
                QueueUpcomingItem(
                    scheduled_at=aware,
                    platform=account.platform,
                    weekday=weekday,
                    time_local=clock,
                    timezone=tz_name,
                    connected_account_id=account.id,
                    account_name=account.account_name,
                    post_id=match.id if match else None,
                    post_status=match.status if match else None,
                    post_excerpt=(match.content[:120] if match and match.content else None),
                    filled=bool(match),
                )
            )

    items.sort(key=lambda item: (item.scheduled_at, item.platform, item.account_name or ""))
    return items
