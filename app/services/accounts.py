"""Database operations and ownership checks for connected accounts."""

import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.security import encrypt_token
from app.integrations.platform_catalog import connectable_platform_names, default_account_type
from app.models import ConnectedAccount
from app.models.connected_account import OAuthPickSession
from app.schemas.account import AccountCreate

logger = logging.getLogger(__name__)
_PICK_TTL = timedelta(minutes=20)


def _as_utc(value: datetime | None) -> datetime | None:
    """Normalize datetimes for AccountCreate / SQLite round-trips (naive => UTC)."""
    if value is None:
        return None
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)



def list_accounts(db: Session, user_id: UUID) -> list[ConnectedAccount]:
    """Return the user's accounts, newest first."""
    return list(
        db.scalars(
            select(ConnectedAccount)
            .where(ConnectedAccount.user_id == user_id)
            .order_by(ConnectedAccount.created_at.desc())
        ).all()
    )


def create_account(db: Session, user_id: UUID, payload: AccountCreate) -> ConnectedAccount:
    """Encrypt provider credentials and persist an account owned by the user."""
    if payload.platform not in connectable_platform_names():
        allowed = ", ".join(sorted(connectable_platform_names()))
        raise HTTPException(status_code=422, detail=f"Unsupported platform. Choose one of: {allowed}")
    expires_at = payload.token_expires_at
    if expires_at is not None:
        if expires_at.tzinfo is None or expires_at.utcoffset() is None:
            raise HTTPException(status_code=422, detail="token_expires_at must include a timezone")
        expires_at = expires_at.astimezone(timezone.utc)

    scopes = [scope.strip() for scope in payload.scopes]
    account = ConnectedAccount(
        user_id=user_id,
        platform=payload.platform,
        platform_account_id=payload.platform_account_id,
        account_name=payload.account_name,
        account_type=payload.account_type or default_account_type(payload.platform),
        parent_account_id=payload.parent_account_id,
        access_token_ciphertext=encrypt_token(payload.access_token),
        refresh_token_ciphertext=encrypt_token(payload.refresh_token) if payload.refresh_token else None,
        token_expires_at=expires_at,
        scopes=scopes,
        extra_metadata=payload.extra_metadata or {},
    )
    db.add(account)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        duplicate = db.scalar(
            select(ConnectedAccount.id).where(
                ConnectedAccount.user_id == user_id,
                ConnectedAccount.platform == payload.platform,
                ConnectedAccount.platform_account_id == payload.platform_account_id,
            )
        )
        if duplicate is not None:
            raise HTTPException(status_code=409, detail="This social account is already connected") from exc
        logger.exception("Database rejected connected account creation", exc_info=exc)
        raise HTTPException(status_code=500, detail="Could not save the connected account") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Failed to save connected account", exc_info=exc)
        raise HTTPException(status_code=500, detail="Could not save the connected account") from exc
    except Exception:
        db.rollback()
        raise
    db.refresh(account)
    return account


def upsert_oauth_account(
    db: Session,
    user_id: UUID,
    *,
    platform: str,
    platform_account_id: str,
    account_name: str,
    access_token: str,
    refresh_token: str | None,
    token_expires_at: datetime | None,
    scopes: list[str],
    account_type: str | None = None,
    parent_account_id: UUID | None = None,
    extra_metadata: dict | None = None,
) -> ConnectedAccount:
    """Store or refresh an OAuth account without returning its tokens."""
    existing = db.scalar(
        select(ConnectedAccount).where(
            ConnectedAccount.user_id == user_id,
            ConnectedAccount.platform == platform,
            ConnectedAccount.platform_account_id == platform_account_id,
        )
    )
    resolved_type = account_type or default_account_type(platform)
    expires_at = _as_utc(token_expires_at)
    connected_at = datetime.now(timezone.utc).isoformat()
    if existing is None:
        extra_metadata = {**(extra_metadata or {}), "connected_at": connected_at}
        return create_account(
            db,
            user_id,
            AccountCreate(
                platform=platform,
                platform_account_id=platform_account_id,
                account_name=account_name,
                account_type=resolved_type,
                parent_account_id=parent_account_id,
                access_token=access_token,
                refresh_token=refresh_token,
                token_expires_at=expires_at,
                scopes=scopes,
                extra_metadata=extra_metadata or {},
            ),
        )
    existing.account_name = account_name
    existing.account_type = resolved_type
    if parent_account_id is not None:
        existing.parent_account_id = parent_account_id
    existing.access_token_ciphertext = encrypt_token(access_token)
    if refresh_token:
        existing.refresh_token_ciphertext = encrypt_token(refresh_token)
    existing.token_expires_at = expires_at
    existing.scopes = [scope.strip() for scope in scopes]
    existing.is_active = True
    base_meta = extra_metadata if extra_metadata is not None else (existing.extra_metadata or {})
    # Record the (re)connect time so channel health ignores failures from before it.
    existing.extra_metadata = {**base_meta, "connected_at": connected_at}
    db.commit()
    db.refresh(existing)
    return existing


def create_pick_session(
    db: Session,
    user_id: UUID,
    *,
    platform: str,
    access_token: str,
    refresh_token: str | None,
    token_expires_at: datetime | None,
    scopes: list[str],
    identity_json: dict,
) -> OAuthPickSession:
    session = OAuthPickSession(
        user_id=user_id,
        platform=platform,
        access_token_ciphertext=encrypt_token(access_token),
        refresh_token_ciphertext=encrypt_token(refresh_token) if refresh_token else None,
        token_expires_at=_as_utc(token_expires_at),
        scopes=[scope.strip() for scope in scopes],
        identity_json=identity_json or {},
        expires_at=datetime.now(timezone.utc) + _PICK_TTL,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_pick_session(db: Session, user_id: UUID, session_id: UUID) -> OAuthPickSession:
    session = db.scalar(
        select(OAuthPickSession).where(OAuthPickSession.id == session_id, OAuthPickSession.user_id == user_id)
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Destination pick session not found or expired.")
    expires = session.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        db.delete(session)
        db.commit()
        raise HTTPException(status_code=410, detail="Destination pick session expired. Connect again.")
    return session


def delete_pick_session(db: Session, session: OAuthPickSession) -> None:
    db.delete(session)
    db.commit()


def get_owned_account(db: Session, user_id: UUID, account_id: UUID) -> ConnectedAccount:
    """Fetch an account within the user's ownership boundary or return 404."""
    account = db.scalar(
        select(ConnectedAccount).where(ConnectedAccount.id == account_id, ConnectedAccount.user_id == user_id)
    )
    if account is None:
        raise HTTPException(status_code=404, detail="Connected account not found")
    return account


def deactivate_account(db: Session, user_id: UUID, account_id: UUID) -> None:
    """Disable new scheduling for an account without deleting credentials."""
    account = get_owned_account(db, user_id, account_id)
    account.is_active = False
    db.commit()


def activate_account(db: Session, user_id: UUID, account_id: UUID) -> ConnectedAccount:
    """Reactivate and return an owned connected account."""
    account = get_owned_account(db, user_id, account_id)
    account.is_active = True
    db.commit()
    db.refresh(account)
    return account


def delete_account(db: Session, user_id: UUID, account_id: UUID) -> None:
    """Delete an account and its dependent posts within one transaction."""
    account = get_owned_account(db, user_id, account_id)
    try:
        for post in list(account.scheduled_posts):
            db.delete(post)
        db.delete(account)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="This account is still linked to posts and cannot be deleted.",
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Failed to delete connected account", exc_info=exc)
        raise HTTPException(status_code=500, detail="Could not delete the connected account") from exc
