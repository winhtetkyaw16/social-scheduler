"""Proactive OAuth token refresh, shared with the publish-time refresh.

One lock per connected account covers both the hourly sweep and the refresh
that runs just before a post goes out. Providers that rotate refresh tokens
(X, TikTok, Pinterest, and LinkedIn when it returns one) must not have a
stale response overwrite the token that was just stored.

Nothing in this module logs access tokens, refresh tokens, or client secrets.
Log lines carry the account id, the network, and an outcome word.
"""

from __future__ import annotations

import logging
import os
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.security import decrypt_token, encrypt_token
from app.models import ScheduledPost
from app.models.connected_account import ConnectedAccount
from app.services.error_messages import network_name

logger = logging.getLogger(__name__)

# Access tokens for these networks are renewed with grant_type=refresh_token.
REFRESH_GRANT_PLATFORMS = frozenset({"x", "linkedin", "youtube", "tiktok", "pinterest"})
# Threads long-lived tokens are refreshed with grant_type=th_refresh_token.
THREADS_PLATFORM = "threads"
RECONNECT_ERROR_CODE = "connection_expired"

# Publish-time refresh still uses a short leeway. The sweep uses a wider window.
PUBLISH_LEEWAY_SECONDS = 5 * 60
_DEFAULT_WINDOW_HOURS = 24
_THREADS_WINDOW_DAYS = 7
_WARNING_DAYS = 7
_LOCK_TTL_SECONDS = 90

_PERMANENT_CODES = frozenset(
    {
        "invalid_grant",
        "invalid_token",
        "invalid_refresh_token",
        "revoked_token",
        "refresh_token_invalid",
        "refresh_token_expired",
        "190",
        "190:463",
        "190:467",
        "102",
    }
)
_PERMANENT_PHRASES = (
    "invalid_grant",
    "revoked",
    "refresh token is invalid",
    "refresh token has expired",
    "token was invalid",
    "token has been expired",
    "token has expired",
    "session has been invalidated",
    "error validating access token",
    "expired or revoked",
)
_TRANSIENT_PHRASES = (
    "not old enough",
    "24 hours",
    "too early",
    "try again later",
)

_local_guard = threading.Lock()
_local_locks: dict[str, threading.Lock] = {}
_redis_client = None
_redis_checked = False


@dataclass(frozen=True)
class RefreshResult:
    """Outcome of one refresh attempt. ``reason`` is plain language, or None."""

    status: str
    reason: str | None = None


class _HeldLock:
    def __init__(
        self, key: str, *, local: threading.Lock | None, redis_token: str | None
    ):
        self.key = key
        self._local = local
        self._redis_token = redis_token
        self._released = False

    def release(self) -> None:
        if self._released:
            return
        self._released = True
        if self._local is not None:
            self._local.release()
            return
        client = _redis()
        if client is None or not self._redis_token:
            return
        try:
            client.eval(
                "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
                1,
                self.key,
                self._redis_token,
            )
        except Exception as exc:
            logger.info(
                "Token refresh lock release failed outcome=lock_release error_type=%s",
                type(exc).__name__,
            )


def _int_env(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except ValueError:
        return default


def refresh_window(platform: str) -> timedelta:
    """How early to refresh this network. Threads uses 7 days; everyone else 24 hours."""
    if (platform or "").strip().lower() == THREADS_PLATFORM:
        return timedelta(
            days=_int_env("THREADS_REFRESH_WINDOW_DAYS", _THREADS_WINDOW_DAYS)
        )
    return timedelta(
        hours=_int_env("TOKEN_REFRESH_WINDOW_HOURS", _DEFAULT_WINDOW_HOURS)
    )


def warning_window() -> timedelta:
    """How early to warn when a network cannot refresh itself (LinkedIn without a refresh token)."""
    return timedelta(days=_int_env("RECONNECT_WARNING_DAYS", _WARNING_DAYS))


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _metadata(account) -> dict:
    meta = getattr(account, "extra_metadata", None) or {}
    return dict(meta) if isinstance(meta, dict) else {}


def token_is_non_expiring(account) -> bool:
    """Page tokens minted from a long-lived user token do not expire."""
    meta = _metadata(account)
    if meta.get("token_lifetime") == "non_expiring":
        return True
    platform = (getattr(account, "platform", "") or "").strip().lower()
    account_type = (getattr(account, "account_type", "") or "").strip().lower()
    if platform == "facebook" and account_type == "page":
        return True
    if platform == "instagram" and meta.get("linked_facebook_page_id"):
        return True
    return False


def _can_auto_refresh(account) -> bool:
    platform = (getattr(account, "platform", "") or "").strip().lower()
    if platform == THREADS_PLATFORM:
        return bool(getattr(account, "access_token_ciphertext", None))
    if platform in REFRESH_GRANT_PLATFORMS:
        return bool(getattr(account, "refresh_token_ciphertext", None))
    return False


def access_token_due(account, window: timedelta, now: datetime | None = None) -> bool:
    """True when the access token expires inside ``window`` (already expired counts)."""
    exp = _utc(getattr(account, "token_expires_at", None))
    if exp is None:
        return False
    current = now or datetime.now(timezone.utc)
    return exp - current <= window


def due_for_refresh(account, now: datetime | None = None) -> bool:
    """True when the hourly sweep should refresh this account."""
    if not getattr(account, "is_active", False):
        return False
    if getattr(account, "needs_reconnect", False):
        return False
    if token_is_non_expiring(account) or not _can_auto_refresh(account):
        return False
    return access_token_due(account, refresh_window(account.platform), now)


def reconnect_copy(platform: str, *, expired: bool = False) -> str:
    """Plain-language reconnect reason. No error codes or provider jargon."""
    name = network_name(platform)
    if expired:
        return f"{name} access has expired. Reconnect it so scheduled posts can keep publishing."
    return f"{name} disconnected this account. Reconnect it so scheduled posts can keep publishing."


def connection_warning(account, now: datetime | None = None) -> str | None:
    """Banner text for an account the user must reconnect, or None when refresh can handle it."""
    if getattr(account, "needs_reconnect", False):
        reason = (getattr(account, "reconnect_reason", None) or "").strip()
        return reason or reconnect_copy(getattr(account, "platform", ""))
    if token_is_non_expiring(account) or _can_auto_refresh(account):
        return None
    if not getattr(account, "is_active", True):
        return None
    exp = _utc(getattr(account, "token_expires_at", None))
    if exp is None:
        return None
    current = now or datetime.now(timezone.utc)
    remaining = exp - current
    if remaining > warning_window():
        return None
    name = network_name(getattr(account, "platform", ""))
    if remaining.total_seconds() <= 0:
        return reconnect_copy(getattr(account, "platform", ""), expired=True)
    days = max(1, int((remaining.total_seconds() + 86399) // 86400))
    unit = "day" if days == 1 else "days"
    return f"{name} access expires in {days} {unit}. Reconnect before then so scheduled posts keep publishing."


def _redis():
    """Return a Redis client when the lock should use Redis, else None."""
    global _redis_client, _redis_checked
    if os.getenv("TOKEN_REFRESH_LOCK", "auto").strip().lower() == "memory":
        return None
    if _redis_checked:
        return _redis_client
    _redis_checked = True
    try:
        import redis

        from app.core.config import REDIS_URL

        client = redis.Redis.from_url(
            REDIS_URL,
            socket_connect_timeout=0.3,
            socket_timeout=0.3,
        )
        client.ping()
        _redis_client = client
    except Exception:
        _redis_client = None
    return _redis_client


def _try_acquire(account_id: str, ttl: int) -> _HeldLock | None:
    key = f"socialcastly:token-refresh:{account_id}"
    client = _redis()
    if client is not None:
        token = secrets.token_hex(16)
        try:
            if client.set(key, token, nx=True, ex=ttl):
                return _HeldLock(key, local=None, redis_token=token)
            return None
        except Exception as exc:
            logger.info(
                "Token refresh lock fell back to memory error_type=%s",
                type(exc).__name__,
            )
    with _local_guard:
        lock = _local_locks.setdefault(account_id, threading.Lock())
    if lock.acquire(blocking=False):
        return _HeldLock(key, local=lock, redis_token=None)
    return None


def acquire_refresh_lock(
    account_id: str, *, wait_seconds: float = 0
) -> _HeldLock | None:
    """Hold the per-account refresh lock, or return None if another refresh has it."""
    deadline = time.monotonic() + max(0.0, wait_seconds)
    while True:
        held = _try_acquire(account_id, _LOCK_TTL_SECONDS)
        if held is not None:
            return held
        if time.monotonic() >= deadline:
            return None
        time.sleep(0.05)


def _log(account_id, platform: str, outcome: str) -> None:
    logger.info(
        "Token refresh account=%s network=%s outcome=%s",
        account_id,
        platform,
        outcome,
    )


def _provider(platform: str):
    from app.services.oauth import _providers

    return _providers().get(platform)


def _error_parts(body: dict) -> tuple[str, str, bool]:
    err = body.get("error")
    description = str(body.get("error_description") or body.get("message") or "")
    transient = False
    code = ""
    if isinstance(err, dict):
        code = str(err.get("code") or err.get("type") or "")
        description = str(err.get("message") or description)
        transient = bool(err.get("is_transient"))
        sub = err.get("error_subcode")
        if sub:
            code = f"{code}:{sub}"
    elif isinstance(err, str):
        code = err
    elif err not in (None, ""):
        code = str(err)
    if not code and body.get("error_code") not in (None, "", 0):
        code = str(body.get("error_code"))
    return code.strip().lower(), description.strip().lower(), transient


def _is_permanent(
    status: int, code: str, description: str, transient_hint: bool
) -> bool:
    if transient_hint or status in {408, 429} or status >= 500:
        return False
    if any(phrase in description for phrase in _TRANSIENT_PHRASES):
        return False
    if code in _PERMANENT_CODES or code.startswith("190"):
        return True
    if "invalid_grant" in code or "revoked" in code:
        return True
    if any(phrase in description for phrase in _PERMANENT_PHRASES):
        return True
    return False


def _read_json(response) -> dict | None:
    try:
        body = response.json()
    except Exception:
        return None
    return body if isinstance(body, dict) else None


def _call_provider(account, provider) -> httpx.Response:
    platform = account.platform
    if platform == THREADS_PLATFORM:
        access_token = decrypt_token(account.access_token_ciphertext)
        # Threads documents GET. The token stays in the query string; httpx URL
        # logging is pinned to WARNING in configure_logging, and we never log it.
        return httpx.get(
            "https://graph.threads.net/refresh_access_token",
            params={"grant_type": "th_refresh_token", "access_token": access_token},
            timeout=30.0,
        )
    refresh_token = decrypt_token(account.refresh_token_ciphertext)
    data: dict[str, str] = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }
    auth = None
    if provider.auth_style == "tiktok":
        data["client_key"] = provider.client_id
        data["client_secret"] = provider.client_secret
    elif platform in {"x", "pinterest"}:
        data["client_id"] = provider.client_id
        auth = (provider.client_id, provider.client_secret)
    else:
        data["client_id"] = provider.client_id
        data["client_secret"] = provider.client_secret
    return httpx.post(
        provider.token_url,
        data=data,
        auth=auth,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30.0,
    )


def _success_payload(platform: str, body: dict) -> dict:
    if platform == "tiktok" and isinstance(body.get("data"), dict):
        nested = body["data"]
        if isinstance(nested.get("access_token"), str):
            return nested
    return body


def _expiry(now: datetime, payload: dict, previous: datetime | None) -> datetime | None:
    expires_in = payload.get("expires_in")
    if expires_in in (None, ""):
        return previous
    try:
        return now + timedelta(seconds=int(expires_in))
    except (TypeError, ValueError):
        return previous


def _remember_refresh_expiry(meta: dict, now: datetime, payload: dict) -> dict:
    updated = dict(meta)
    seconds = payload.get("refresh_expires_in")
    if seconds in (None, ""):
        seconds = payload.get("refresh_token_expires_in")
    stamp = None
    if seconds not in (None, ""):
        try:
            stamp = now + timedelta(seconds=int(seconds))
        except (TypeError, ValueError):
            stamp = None
    if stamp is None and payload.get("refresh_token_expires_at") not in (None, ""):
        try:
            stamp = datetime.fromtimestamp(
                int(payload["refresh_token_expires_at"]), tz=timezone.utc
            )
        except (TypeError, ValueError, OSError):
            stamp = None
    if stamp is not None:
        updated["refresh_expires_at"] = stamp.isoformat()
    return updated


def _credential_unchanged(
    account, *, seen_access: str, seen_refresh: str | None
) -> bool:
    if account.platform == THREADS_PLATFORM:
        return account.access_token_ciphertext == seen_access
    return account.refresh_token_ciphertext == seen_refresh


def mark_needs_reconnect(db: Session, account, reason: str) -> None:
    """Flag the account and fail scheduled posts so they show the reconnect reason."""
    account.needs_reconnect = True
    account.reconnect_reason = reason
    pending = db.scalars(
        select(ScheduledPost).where(
            ScheduledPost.connected_account_id == account.id,
            ScheduledPost.status.in_(("scheduled", "queued")),
        )
    ).all()
    for post in pending:
        post.status = "failed"
        post.last_error_code = RECONNECT_ERROR_CODE
        post.last_error_message = reason
    db.commit()
    _log(account.id, account.platform, "needs_reconnect")


def _apply_tokens(
    db: Session,
    account,
    *,
    seen_access: str,
    seen_refresh: str | None,
    access_token: str,
    new_refresh: str | None,
    expires_at: datetime | None,
    metadata: dict,
) -> bool:
    """Write the new tokens only if the credential we used is still the stored one."""
    values = {
        "access_token_ciphertext": encrypt_token(access_token),
        "token_expires_at": expires_at,
        "needs_reconnect": False,
        "reconnect_reason": None,
        "extra_metadata": metadata,
    }
    if account.platform == THREADS_PLATFORM:
        condition = ConnectedAccount.access_token_ciphertext == seen_access
    else:
        values["refresh_token_ciphertext"] = (
            encrypt_token(new_refresh) if new_refresh else seen_refresh
        )
        condition = ConnectedAccount.refresh_token_ciphertext == seen_refresh
    result = db.execute(
        update(ConnectedAccount)
        .where(ConnectedAccount.id == account.id, condition)
        .values(**values)
    )
    if result.rowcount != 1:
        db.rollback()
        return False
    db.commit()
    db.refresh(account)
    return True


def _refresh_holding_lock(
    db: Session,
    account,
    *,
    force: bool,
    window: timedelta | None,
) -> RefreshResult:
    db.refresh(account)
    platform = account.platform
    if not account.is_active or token_is_non_expiring(account):
        return RefreshResult("skipped")
    if account.needs_reconnect and not force:
        return RefreshResult("skipped")
    if not _can_auto_refresh(account):
        return RefreshResult("skipped")
    limit = window if window is not None else timedelta(seconds=PUBLISH_LEEWAY_SECONDS)
    if not force and not access_token_due(account, limit):
        return RefreshResult("skipped")
    provider = _provider(platform)
    if provider is None or provider.missing_env:
        _log(account.id, platform, "not_configured")
        return RefreshResult("skipped")

    seen_access = account.access_token_ciphertext
    seen_refresh = account.refresh_token_ciphertext
    # End the read transaction before the network call. SQLite keeps a snapshot
    # for the whole transaction, which would let a stale UPDATE miss a refresh
    # token another worker already stored.
    db.commit()
    try:
        response = _call_provider(account, provider)
    except httpx.HTTPError:
        _log(account.id, platform, "transient")
        return RefreshResult("transient")

    body = _read_json(response)
    if body is None:
        _log(account.id, platform, "transient")
        return RefreshResult("transient")
    code, description, transient_hint = _error_parts(body)
    failed = response.is_error or bool(code)
    if failed and _is_permanent(
        response.status_code, code, description, transient_hint
    ):
        db.refresh(account)
        if not _credential_unchanged(
            account, seen_access=seen_access, seen_refresh=seen_refresh
        ):
            _log(account.id, platform, "stale")
            return RefreshResult("stale")
        reason = reconnect_copy(platform)
        mark_needs_reconnect(db, account, reason)
        return RefreshResult("permanent", reason)
    if failed:
        _log(account.id, platform, "transient")
        return RefreshResult("transient")

    payload = _success_payload(platform, body)
    access_token = payload.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        _log(account.id, platform, "transient")
        return RefreshResult("transient")
    new_refresh = payload.get("refresh_token")
    if not isinstance(new_refresh, str) or not new_refresh:
        new_refresh = None
    now = datetime.now(timezone.utc)
    expires_at = _expiry(now, payload, account.token_expires_at)
    metadata = _remember_refresh_expiry(_metadata(account), now, payload)
    stored = _apply_tokens(
        db,
        account,
        seen_access=seen_access,
        seen_refresh=seen_refresh,
        access_token=access_token,
        new_refresh=new_refresh,
        expires_at=expires_at,
        metadata=metadata,
    )
    if not stored:
        _log(account.id, platform, "stale")
        return RefreshResult("stale")
    _log(account.id, platform, "refreshed")
    return RefreshResult("refreshed")


def refresh_connected_account(
    db: Session,
    account,
    *,
    force: bool = False,
    window: timedelta | None = None,
    wait_seconds: float = 20,
) -> RefreshResult:
    """Refresh one account under the shared lock. Never raises for provider errors."""
    if account is None:
        return RefreshResult("skipped")
    held = acquire_refresh_lock(str(account.id), wait_seconds=wait_seconds)
    if held is None:
        _log(account.id, getattr(account, "platform", ""), "locked")
        return RefreshResult("locked")
    try:
        return _refresh_holding_lock(db, account, force=force, window=window)
    except Exception as exc:
        _log(account.id, getattr(account, "platform", ""), "transient")
        logger.info(
            "Token refresh account=%s network=%s outcome=error error_type=%s",
            account.id,
            getattr(account, "platform", ""),
            type(exc).__name__,
        )
        try:
            db.rollback()
        except Exception:
            pass
        return RefreshResult("transient")
    finally:
        held.release()


def _mark_expired_without_refresh(db: Session, account, now: datetime) -> bool:
    """LinkedIn (and any other network) with no refresh token, once the access token is past due."""
    if token_is_non_expiring(account) or _can_auto_refresh(account):
        return False
    if not account.is_active or account.needs_reconnect:
        return False
    exp = _utc(account.token_expires_at)
    if exp is None or exp > now:
        return False
    mark_needs_reconnect(db, account, reconnect_copy(account.platform, expired=True))
    return True


def run_token_refresh_sweep(db: Session, now: datetime | None = None) -> dict[str, int]:
    """Refresh every due account. Returns counts only."""
    current = now or datetime.now(timezone.utc)
    counts = {
        "refreshed": 0,
        "permanent": 0,
        "transient": 0,
        "locked": 0,
        "stale": 0,
        "skipped": 0,
    }
    accounts = list(
        db.scalars(
            select(ConnectedAccount).where(ConnectedAccount.is_active.is_(True))
        ).all()
    )
    for account in accounts:
        try:
            if due_for_refresh(account, current):
                result = refresh_connected_account(
                    db,
                    account,
                    window=refresh_window(account.platform),
                    wait_seconds=0,
                )
                key = result.status if result.status in counts else "skipped"
                counts[key] += 1
                continue
            if _mark_expired_without_refresh(db, account, current):
                counts["permanent"] += 1
                continue
            counts["skipped"] += 1
        except Exception as exc:
            counts["transient"] += 1
            _log(
                getattr(account, "id", ""),
                getattr(account, "platform", ""),
                "transient",
            )
            logger.info(
                "Token refresh account=%s network=%s outcome=error error_type=%s",
                getattr(account, "id", ""),
                getattr(account, "platform", ""),
                type(exc).__name__,
            )
            try:
                db.rollback()
            except Exception:
                pass
    return counts
