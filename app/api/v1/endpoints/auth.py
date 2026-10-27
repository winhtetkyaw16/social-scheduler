from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.security import refresh_token_subject
from app.models import User
from app.schemas.auth import RefreshRequest, Token, UserCreate, UserLogin, UserOut
from app.services.auth import authenticate_user, issue_token_pair, register_user

router = APIRouter()


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
@router.post("/signup", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(payload: UserCreate, db: Session = Depends(get_db)) -> User:
    """Register an account while storing only a one-way password hash."""
    return register_user(
        db,
        str(payload.email),
        payload.password,
        payload.full_name,
        payload.workspace_name,
    )


def _authenticate(email: str, password: str, db: Session) -> Token:
    """Authenticate credentials and issue a bearer token or return 401."""
    user = authenticate_user(db, email, password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials, please try again",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return Token(**issue_token_pair(user))


@router.post("/login", response_model=Token)
def login(payload: UserLogin, db: Session = Depends(get_db)) -> Token:
    """Verify credentials and return a signed bearer access token."""
    return _authenticate(str(payload.email), payload.password, db)


@router.post("/token", response_model=Token, include_in_schema=False)
def oauth_token(
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
) -> Token:
    """Keep the OAuth2 password-form endpoint used by OAuth2PasswordBearer docs."""
    return _authenticate(form.username, form.password, db)


@router.post("/refresh", response_model=Token)
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)) -> Token:
    """Exchange a refresh token for a new access token and refresh token."""
    try:
        user_id = UUID(refresh_token_subject(payload.refresh_token))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return Token(**issue_token_pair(user))
