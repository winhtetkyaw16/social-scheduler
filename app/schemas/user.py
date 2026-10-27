"""Compatibility aliases for the canonical authentication schemas.

New code should import user request and response models from
``app.schemas.auth``. These aliases keep older integrations working without
maintaining a second set of duplicate Pydantic models.
"""

from app.schemas.auth import Token, UserCreate, UserLogin, UserOut

LoginRequest = UserLogin
UserRead = UserOut
TokenResponse = Token

__all__ = ["LoginRequest", "TokenResponse", "UserCreate", "UserRead"]
