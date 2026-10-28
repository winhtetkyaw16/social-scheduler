from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.integrations.platform_catalog import catalog_public
from app.models import User
from app.schemas import AccountCreate, AccountRead
from app.schemas.account import DestinationList, DestinationSave, OAuthStart
from app.services.accounts import activate_account, create_account, deactivate_account, delete_account, list_accounts
from app.services.destinations import list_destinations, save_destinations
from app.services.oauth import finish_oauth, start_oauth

router = APIRouter()


@router.get("/catalog")
def get_platform_catalog(user: User = Depends(get_current_user)) -> list[dict]:
    """Return connectable networks, account types, and publish readiness."""
    _ = user
    return catalog_public()


@router.get("/oauth/pick/{session_id}", response_model=DestinationList)
def get_oauth_destinations(
    session_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """List Pages/orgs/channels/boards for a pending OAuth pick session."""
    return list_destinations(db, user.id, session_id)


@router.post("/oauth/pick", response_model=list[AccountRead], status_code=status.HTTP_201_CREATED)
def save_oauth_destinations(
    payload: DestinationSave,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AccountRead]:
    """Persist the destinations the user selected after OAuth discovery."""
    accounts = save_destinations(db, user.id, payload.pick_session_id, payload.destination_ids)
    return [AccountRead.from_account(account) for account in accounts]


@router.get("/{platform}/connect", response_model=OAuthStart)
def begin_oauth(
    platform: str,
    return_to: str | None = None,
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    """Return the provider authorization URL for a connectable platform."""
    return start_oauth(platform, user.id, return_to=return_to)


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
) -> list[AccountRead]:
    """List accounts owned by the authenticated user."""
    return [AccountRead.from_account(account) for account in list_accounts(db, user.id)]


@router.post("", response_model=AccountRead, status_code=status.HTTP_201_CREATED)
def add_account(
    payload: AccountCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AccountRead:
    """Encrypt and persist a connected social account."""
    return AccountRead.from_account(create_account(db, user.id, payload))


@router.patch("/{account_id}/activate", response_model=AccountRead)
def restore_account(
    account_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AccountRead:
    """Reactivate an owned connected account."""
    return AccountRead.from_account(activate_account(db, user.id, account_id))


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
