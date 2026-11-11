"""HttpOnly refresh cookie. Secure when the public site is https."""

from fastapi import Request, Response

from app.core.config import PUBLIC_BASE_URL, REFRESH_TOKEN_EXPIRE_DAYS

REFRESH_COOKIE = "sc_refresh"


def cookie_secure(request: Request | None = None) -> bool:
    """Secure cookies on https, including requests whose scheme the tunnel forwarded."""
    if request is not None and request.url.scheme == "https":
        return True
    base = (PUBLIC_BASE_URL or "").lower()
    return base.startswith("https://")


def set_refresh_cookie(response: Response, token: str, request: Request) -> None:
    """Store the refresh token in an HttpOnly cookie. The JSON body is unchanged."""
    response.set_cookie(
        REFRESH_COOKIE,
        token,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=cookie_secure(request),
        samesite="lax",
        path="/",
    )
