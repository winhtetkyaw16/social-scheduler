"""Authorization-code OAuth for the platforms that can publish."""

from __future__ import annotations

import base64
import json
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from urllib.parse import urlencode
from uuid import UUID

import httpx
from fastapi import HTTPException, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.config import (
    INSTAGRAM_CLIENT_ID,
    INSTAGRAM_CLIENT_SECRET,
    INSTAGRAM_GRAPH_API_VERSION,
    INSTAGRAM_REDIRECT_URI,
    LINKEDIN_CLIENT_ID,
    LINKEDIN_CLIENT_SECRET,
    LINKEDIN_REDIRECT_URI,
    PUBLIC_BASE_URL,
    X_CLIENT_ID,
    X_CLIENT_SECRET,
    X_REDIRECT_URI,
)
from app.core.security import decrypt_token, encrypt_token
from app.integrations.registry import supported_platform_names
from app.services.accounts import upsert_oauth_account

_STATE_TTL = timedelta(minutes=15)


@dataclass(frozen=True)
class _ProviderOAuth:
    platform: str
    authorize_url: str
    token_url: str
    client_id: str
    client_secret: str
    redirect_uri: str
    scopes: tuple[str, ...]
    use_pkce: bool
    missing_env: tuple[str, ...]


def _providers() -> dict[str, _ProviderOAuth]:
    return {
        "x": _ProviderOAuth(
            platform="x",
            authorize_url="https://twitter.com/i/oauth2/authorize",
            token_url="https://api.x.com/2/oauth2/token",
            client_id=X_CLIENT_ID,
            client_secret=X_CLIENT_SECRET,
            redirect_uri=X_REDIRECT_URI,
            scopes=("tweet.read", "tweet.write", "users.read", "offline.access"),
            use_pkce=True,
            missing_env=tuple(
                name
                for name, value in (("X_CLIENT_ID", X_CLIENT_ID), ("X_CLIENT_SECRET", X_CLIENT_SECRET))
                if not value
            ),
        ),
        "linkedin": _ProviderOAuth(
            platform="linkedin",
            authorize_url="https://www.linkedin.com/oauth/v2/authorization",
            token_url="https://www.linkedin.com/oauth/v2/accessToken",
            client_id=LINKEDIN_CLIENT_ID,
            client_secret=LINKEDIN_CLIENT_SECRET,
            redirect_uri=LINKEDIN_REDIRECT_URI,
            scopes=("openid", "profile", "email", "w_member_social"),
            use_pkce=False,
            missing_env=tuple(
                name
                for name, value in (
                    ("LINKEDIN_CLIENT_ID", LINKEDIN_CLIENT_ID),
                    ("LINKEDIN_CLIENT_SECRET", LINKEDIN_CLIENT_SECRET),
                )
                if not value
            ),
        ),
        "instagram": _ProviderOAuth(
            platform="instagram",
            authorize_url="https://www.instagram.com/oauth/authorize",
            token_url="https://api.instagram.com/oauth/access_token",
            client_id=INSTAGRAM_CLIENT_ID,
            client_secret=INSTAGRAM_CLIENT_SECRET,
            redirect_uri=INSTAGRAM_REDIRECT_URI,
            scopes=("instagram_business_basic", "instagram_business_content_publish"),
            use_pkce=False,
            missing_env=tuple(
                name
                for name, value in (
                    ("INSTAGRAM_CLIENT_ID", INSTAGRAM_CLIENT_ID),
                    ("INSTAGRAM_CLIENT_SECRET", INSTAGRAM_CLIENT_SECRET),
                )
                if not value
            ),
        ),
    }


def _require_provider(platform: str) -> _ProviderOAuth:
    normalized = platform.strip().lower()
    if normalized not in supported_platform_names():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OAuth is not available for this platform")
    provider = _providers()[normalized]
    if provider.missing_env:
        names = " and ".join(provider.missing_env)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Set {names} before connecting {provider.platform}.",
        )
    return provider


def _pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    digest = sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).decode().rstrip("=")
    return verifier, challenge


def _write_state(user_id: UUID, platform: str, verifier: str | None) -> str:
    payload = json.dumps(
        {
            "sub": str(user_id),
            "platform": platform,
            "verifier": verifier,
            "exp": int((datetime.now(timezone.utc) + _STATE_TTL).timestamp()),
        },
        separators=(",", ":"),
    )
    return encrypt_token(payload)


def _read_state(state: str, platform: str) -> tuple[UUID, str | None]:
    try:
        payload = json.loads(decrypt_token(state))
        expires = int(payload["exp"])
        if payload.get("platform") != platform or expires < int(datetime.now(timezone.utc).timestamp()):
            raise ValueError("expired")
        return UUID(str(payload["sub"])), payload.get("verifier")
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This authorization session is invalid or expired. Start the connection again.",
        ) from exc


def _studio_redirect(connected: str | None = None, error: str | None = None) -> RedirectResponse:
    query: dict[str, str] = {}
    if connected:
        query["connected"] = connected
    if error:
        query["connect_error"] = error[:180]
    suffix = f"?{urlencode(query)}" if query else ""
    return RedirectResponse(url=f"{PUBLIC_BASE_URL}/{suffix}", status_code=status.HTTP_302_FOUND)


def start_oauth(platform: str, user_id: UUID) -> dict[str, str]:
    """Build the provider authorization URL for the signed-in user."""
    provider = _require_provider(platform)
    verifier = None
    params = {
        "response_type": "code",
        "client_id": provider.client_id,
        "redirect_uri": provider.redirect_uri,
        "scope": " ".join(provider.scopes),
    }
    if provider.use_pkce:
        verifier, challenge = _pkce_pair()
        params["code_challenge"] = challenge
        params["code_challenge_method"] = "S256"
    params["state"] = _write_state(user_id, provider.platform, verifier)
    return {"platform": provider.platform, "authorization_url": f"{provider.authorize_url}?{urlencode(params)}"}


def finish_oauth(
    db: Session,
    platform: str,
    *,
    code: str | None,
    state: str | None,
    provider_error: str | None,
) -> RedirectResponse:
    """Exchange an authorization code and store encrypted tokens, then return to the studio."""
    normalized = platform.strip().lower()
    if normalized not in supported_platform_names():
        return _studio_redirect(error="That platform cannot be connected.")
    if provider_error:
        return _studio_redirect(error="Authorization was cancelled or denied.")
    if not code or not state:
        return _studio_redirect(error="The provider did not return an authorization code.")
    try:
        provider = _require_provider(normalized)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else "OAuth is not configured."
        return _studio_redirect(error=detail)
    try:
        user_id, verifier = _read_state(state, provider.platform)
        token_payload = _exchange_code(provider, code, verifier)
        identity = _identity(provider, token_payload["access_token"])
        upsert_oauth_account(
            db,
            user_id,
            platform=provider.platform,
            platform_account_id=identity["id"],
            account_name=identity["name"],
            access_token=token_payload["access_token"],
            refresh_token=token_payload.get("refresh_token"),
            token_expires_at=token_payload.get("expires_at"),
            scopes=token_payload.get("scopes") or list(provider.scopes),
        )
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else "Could not connect the account."
        return _studio_redirect(error=detail)
    except Exception:
        return _studio_redirect(error="Could not finish connecting the account. Try again.")
    return _studio_redirect(connected=provider.platform)


def _exchange_code(provider: _ProviderOAuth, code: str, verifier: str | None) -> dict:
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": provider.redirect_uri,
        "client_id": provider.client_id,
        "client_secret": provider.client_secret,
    }
    auth = None
    if provider.platform == "x":
        if not verifier:
            raise HTTPException(status_code=400, detail="The X authorization session is missing its verifier.")
        data["code_verifier"] = verifier
        auth = (provider.client_id, provider.client_secret)
    try:
        response = httpx.post(provider.token_url, data=data, auth=auth, timeout=30.0)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach {provider.platform} to exchange the code.") from exc
    if response.is_error:
        raise HTTPException(status_code=502, detail=f"{provider.platform} rejected the authorization code.")
    payload = response.json()
    if provider.platform == "instagram":
        payload = _instagram_token(provider, payload)
    access_token = payload.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise HTTPException(status_code=502, detail=f"{provider.platform} did not return an access token.")
    expires_at = None
    expires_in = payload.get("expires_in")
    if expires_in:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
    scope = payload.get("scope")
    scopes = scope.split() if isinstance(scope, str) else list(provider.scopes)
    refresh_token = payload.get("refresh_token")
    return {
        "access_token": access_token,
        "refresh_token": refresh_token if isinstance(refresh_token, str) and refresh_token else None,
        "expires_at": expires_at,
        "scopes": scopes,
    }


def _instagram_token(provider: _ProviderOAuth, payload: dict) -> dict:
    """Normalize Instagram's short-lived token response and exchange it for a long-lived token."""
    if isinstance(payload.get("data"), list) and payload["data"]:
        payload = payload["data"][0]
    access_token = payload.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise HTTPException(status_code=502, detail="Instagram did not return an access token.")
    try:
        long_lived = httpx.get(
            "https://graph.instagram.com/access_token",
            params={
                "grant_type": "ig_exchange_token",
                "client_secret": provider.client_secret,
                "access_token": access_token,
            },
            timeout=30.0,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Could not reach Instagram to extend the access token.") from exc
    if long_lived.is_error:
        raise HTTPException(status_code=502, detail="Instagram rejected the long-lived token exchange.")
    extended = long_lived.json()
    extended.setdefault("user_id", payload.get("user_id"))
    return extended


def _identity(provider: _ProviderOAuth, access_token: str) -> dict[str, str]:
    if provider.platform == "x":
        return _x_identity(access_token)
    if provider.platform == "linkedin":
        return _linkedin_identity(access_token)
    return _instagram_identity(access_token)


def _authorized_get(url: str, access_token: str, *, params: dict | None = None) -> dict:
    try:
        response = httpx.get(
            url,
            params=params,
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=30.0,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Could not reach the provider to read the account profile.") from exc
    if response.is_error:
        raise HTTPException(status_code=502, detail="The provider refused the account profile request.")
    body = response.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=502, detail="The provider returned an unexpected profile response.")
    return body


def _x_identity(access_token: str) -> dict[str, str]:
    body = _authorized_get("https://api.x.com/2/users/me", access_token, params={"user.fields": "name,username"})
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    account_id = data.get("id")
    if not account_id:
        raise HTTPException(status_code=502, detail="X did not return an account id.")
    name = data.get("name") or data.get("username") or "X account"
    return {"id": str(account_id), "name": str(name)[:255]}


def _linkedin_identity(access_token: str) -> dict[str, str]:
    body = _authorized_get("https://api.linkedin.com/v2/userinfo", access_token)
    subject = body.get("sub")
    if not subject:
        raise HTTPException(status_code=502, detail="LinkedIn did not return a member id.")
    name = body.get("name") or body.get("email") or "LinkedIn member"
    return {"id": f"urn:li:person:{subject}", "name": str(name)[:255]}


def _instagram_identity(access_token: str) -> dict[str, str]:
    version = INSTAGRAM_GRAPH_API_VERSION or "v24.0"
    body = _authorized_get(
        f"https://graph.instagram.com/{version}/me",
        access_token,
        params={"fields": "user_id,username,name"},
    )
    account_id = body.get("user_id") or body.get("id")
    if not account_id:
        raise HTTPException(status_code=502, detail="Instagram did not return an account id.")
    name = body.get("username") or body.get("name") or "Instagram account"
    return {"id": str(account_id), "name": str(name)[:255]}
