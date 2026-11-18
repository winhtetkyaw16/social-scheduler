"""Small parsers shared by the network providers. No network calls."""

from __future__ import annotations

from datetime import datetime, timezone


def as_int(value) -> int | None:
    """Parse a count. Bools and blanks stay None."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        text = value.strip()
        if text.lstrip("-").isdigit():
            return int(text)
    return None


def parse_time(value) -> datetime | None:
    """Parse an ISO timestamp from a provider. Naive values are treated as UTC."""
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def identity_values(account) -> set[str]:
    """Ids and names we can compare to a comment author. Lower-cased."""
    found = {
        str(getattr(account, "platform_account_id", "") or "").strip().lower(),
        str(getattr(account, "account_name", "") or "").strip().lower(),
    }
    meta = getattr(account, "extra_metadata", None) or {}
    if isinstance(meta, dict):
        for key in ("username", "name", "handle", "ig_username"):
            value = meta.get(key)
            if isinstance(value, str):
                found.add(value.strip().lower().lstrip("@"))
    found.discard("")
    return found


def is_own_author(account, *candidates: str | None) -> bool:
    """True when any candidate matches this connected account."""
    known = identity_values(account)
    for candidate in candidates:
        text = str(candidate or "").strip().lower().lstrip("@")
        if text and text in known:
            return True
    return False


def granted_scopes(account) -> set[str]:
    """Scopes stored on the account when it was connected."""
    return {str(item) for item in (getattr(account, "scopes", None) or []) if item}


def insight_number(entry: dict) -> int | None:
    """Read a Graph insight value from ``values`` or ``total_value``."""
    if not isinstance(entry, dict):
        return None
    values = entry.get("values")
    if isinstance(values, list) and values:
        last = values[-1]
        if isinstance(last, dict):
            number = as_int(last.get("value"))
            if number is not None:
                return number
    total = entry.get("total_value")
    if isinstance(total, dict):
        number = as_int(total.get("value"))
        if number is not None:
            return number
    return as_int(entry.get("value"))
