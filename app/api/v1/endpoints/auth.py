from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models import User
from app.schemas.auth import Token, UserCreate, UserLogin, UserOut
from app.services.auth import authenticate_user, issue_access_token, register_user

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

    return Token(
        access_token=issue_access_token(user),
        full_name=user.full_name,
        workspace_name=user.workspace_name,
    )


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
