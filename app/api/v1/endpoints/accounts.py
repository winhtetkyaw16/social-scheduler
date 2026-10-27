from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models import ConnectedAccount, User
from app.schemas import AccountCreate, AccountRead
from app.schemas.account import OAuthStart
from app.services.accounts import activate_account, create_account, deactivate_account, delete_account, list_accounts
from app.services.oauth import finish_oauth, start_oauth

router = APIRouter()


@router.get("/{platform}/connect", response_model=OAuthStart)
def begin_oauth(
    platform: str,
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    """Return the provider authorization URL for X, LinkedIn, or Instagram."""
    return start_oauth(platform, user.id)


@router.get("/{platform}/callback", include_in_schema=True)
def oauth_callback(
    platform: str,
    db: Session = Depends(get_db),
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    """Finish OAuth and redirect back to the studio without exposing tokens."""
    return finish_oauth(db, platform, code=code, state=state, provider_error=error)


@router.get("", response_model=list[AccountRead])
def get_accounts(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ConnectedAccount]:
    """List accounts owned by the authenticated user."""
    return list_accounts(db, user.id)


@router.post("", response_model=AccountRead, status_code=status.HTTP_201_CREATED)
def add_account(
    payload: AccountCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ConnectedAccount:
    """Encrypt and persist a connected social account."""
    return create_account(db, user.id, payload)


@router.patch("/{account_id}/activate", response_model=AccountRead)
def restore_account(
    account_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ConnectedAccount:
    """Reactivate an owned connected account."""
    return activate_account(db, user.id, account_id)


@router.patch("/{account_id}/deactivate", status_code=status.HTTP_204_NO_CONTENT)
def disconnect_account(
    account_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> Response:
    """Mark a connected account inactive without deleting its stored tokens."""
    deactivate_account(db, user.id, account_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_account(
    account_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """Delete an owned account and its associated posts."""
    delete_account(db, user.id, account_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
