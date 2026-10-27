"""Authentication use cases shared by the HTTP endpoints."""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.security import create_access_token, hash_password, verify_password
from app.models import User, Workspace


def register_user(
    db: Session,
    email: str,
    password: str,
    full_name: str,
    workspace_name: str,
) -> User:
    """Create a user profile with a normalized email and password hash."""
    normalized = email.strip().lower()
    if db.scalar(select(User).where(User.email == normalized)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")
    cleaned_workspace = workspace_name.strip() or "My Workspace"
    user = User(
        email=normalized,
        full_name=full_name.strip(),
        workspace_name=cleaned_workspace,
        password_hash=hash_password(password),
    )
    db.add(user)
    try:
        db.flush()
        db.add(Workspace(name=cleaned_workspace, owner_id=user.id))
        db.commit()
    except IntegrityError as exc:
        # The unique email constraint also protects concurrent signups.
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="We couldn't save your account right now. Please try again in a moment.",
        ) from exc
    db.refresh(user)
    return user


def authenticate_user(db: Session, email: str, password: str) -> User | None:
    """Return an active matching user, or ``None`` for invalid credentials."""
    user = db.scalar(select(User).where(User.email == email.strip().lower()))
    if user is None or not user.is_active or not verify_password(password, user.password_hash):
        return None
    return user


def issue_access_token(user: User) -> str:
    """Create a signed bearer token for a user."""
    return create_access_token(str(user.id))
