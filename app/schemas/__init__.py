"""Public Pydantic schema exports used by API endpoint modules."""

from app.schemas.account import AccountCreate, AccountRead, DestinationList, DestinationSave, OAuthStart
from app.schemas.auth import Token, UserCreate, UserLogin, UserOut
from app.schemas.post import PostCreate, PostRead, PostUpdate
from app.schemas.user import LoginRequest, TokenResponse, UserRead

__all__ = [
    "AccountCreate",
    "AccountRead",
    "DestinationList",
    "DestinationSave",
    "OAuthStart",
    "PostCreate",
    "PostRead",
    "PostUpdate",
    "LoginRequest",
    "Token",
    "TokenResponse",
    "UserCreate",
    "UserLogin",
    "UserOut",
    "UserRead",
]
