"""Authorization-code OAuth for connectable platforms."""

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

from app.core import config
from app.core.security import decrypt_token, encrypt_token
from app.integrations.platform_catalog import (
    connectable_platform_names,
    default_account_type,
    platform_needs_destination_pick,
)
from app.services.accounts import create_pick_session, upsert_oauth_account

_STATE_TTL = timedelta(minutes=15)


def _meta_graph(version: str) -> str:
    return f"https://graph.facebook.com/{version}"


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
    auth_style: str = "form"  # form | basic | tiktok


def _providers() -> dict[str, _ProviderOAuth]:
    return {
        "x": _ProviderOAuth(
            platform="x",
            authorize_url="https://twitter.com/i/oauth2/authorize",
            token_url="https://api.x.com/2/oauth2/token",
            client_id=config.X_CLIENT_ID,
            client_secret=config.X_CLIENT_SECRET,
            redirect_uri=config.X_REDIRECT_URI,
            scopes=("tweet.read", "tweet.write", "users.read", "offline.access"),
            use_pkce=True,
            missing_env=tuple(
                name
                for name, value in (("X_CLIENT_ID", config.X_CLIENT_ID), ("X_CLIENT_SECRET", config.X_CLIENT_SECRET))
                if not value
            ),
            auth_style="basic",
        ),
        "linkedin": _ProviderOAuth(
            platform="linkedin",
            authorize_url="https://www.linkedin.com/oauth/v2/authorization",
            token_url="https://www.linkedin.com/oauth/v2/accessToken",
            client_id=config.LINKEDIN_CLIENT_ID,
            client_secret=config.LINKEDIN_CLIENT_SECRET,
            redirect_uri=config.LINKEDIN_REDIRECT_URI,
            # Organization scopes are optional: keep personal connect working without Marketing Developer Platform approval.
            scopes=("openid", "profile", "email", "w_member_social"),
            use_pkce=False,
            missing_env=tuple(
                name
                for name, value in (
                    ("LINKEDIN_CLIENT_ID", config.LINKEDIN_CLIENT_ID),
                    ("LINKEDIN_CLIENT_SECRET", config.LINKEDIN_CLIENT_SECRET),
                )
                if not value
            ),
        ),
        "instagram": _ProviderOAuth(
            platform="instagram",
            authorize_url="https://www.instagram.com/oauth/authorize",
            token_url="https://api.instagram.com/oauth/access_token",
            client_id=config.INSTAGRAM_CLIENT_ID,
            client_secret=config.INSTAGRAM_CLIENT_SECRET,
            redirect_uri=config.INSTAGRAM_REDIRECT_URI,
            scopes=("instagram_business_basic", "instagram_business_content_publish"),
            use_pkce=False,
            missing_env=tuple(
                name
                for name, value in (
                    ("INSTAGRAM_CLIENT_ID", config.INSTAGRAM_CLIENT_ID),
                    ("INSTAGRAM_CLIENT_SECRET", config.INSTAGRAM_CLIENT_SECRET),
                )
                if not value
            ),
        ),
        "facebook": _ProviderOAuth(
            platform="facebook",
            authorize_url="https://www.facebook.com/dialog/oauth",
            token_url=f"{_meta_graph(config.FACEBOOK_GRAPH_API_VERSION)}/oauth/access_token",
            client_id=config.FACEBOOK_CLIENT_ID,
            client_secret=config.FACEBOOK_CLIENT_SECRET,
            redirect_uri=config.FACEBOOK_REDIRECT_URI,
            scopes=(
                "pages_show_list",
                "pages_manage_posts",
                "pages_read_engagement",
                "business_management",
            ),
            use_pkce=False,
            missing_env=tuple(
                name
                for name, value in (
                    ("FACEBOOK_CLIENT_ID", config.FACEBOOK_CLIENT_ID),
                    ("FACEBOOK_CLIENT_SECRET", config.FACEBOOK_CLIENT_SECRET),
                )
                if not value
            ),
        ),
        "youtube": _ProviderOAuth(
            platform="youtube",
            authorize_url="https://accounts.google.com/o/oauth2/v2/auth",
            token_url="https://oauth2.googleapis.com/token",
            client_id=config.YOUTUBE_CLIENT_ID,
            client_secret=config.YOUTUBE_CLIENT_SECRET,
            redirect_uri=config.YOUTUBE_REDIRECT_URI,
            scopes=(
                "https://www.googleapis.com/auth/youtube.force-ssl",
                "https://www.googleapis.com/auth/youtube.upload",
                "https://www.googleapis.com/auth/youtube.readonly",
            ),
            use_pkce=True,
            missing_env=tuple(
                name
                for name, value in (
                    ("YOUTUBE_CLIENT_ID", config.YOUTUBE_CLIENT_ID),
                    ("YOUTUBE_CLIENT_SECRET", config.YOUTUBE_CLIENT_SECRET),
                )
                if not value
            ),
        ),
        "tiktok": _ProviderOAuth(
            platform="tiktok",
            authorize_url="https://www.tiktok.com/v2/auth/authorize/",
            token_url="https://open.tiktokapis.com/v2/oauth/token/",
            client_id=config.TIKTOK_CLIENT_KEY,
            client_secret=config.TIKTOK_CLIENT_SECRET,
            redirect_uri=config.TIKTOK_REDIRECT_URI,
            scopes=("user.info.basic", "video.publish", "video.upload"),
            use_pkce=False,
            missing_env=tuple(
                name
                for name, value in (
                    ("TIKTOK_CLIENT_KEY", config.TIKTOK_CLIENT_KEY),
                    ("TIKTOK_CLIENT_SECRET", config.TIKTOK_CLIENT_SECRET),
                )
                if not value
            ),
            auth_style="tiktok",
        ),
        "pinterest": _ProviderOAuth(
            platform="pinterest",
            authorize_url="https://www.pinterest.com/oauth/",
            token_url="https://api.pinterest.com/v5/oauth/token",
            client_id=config.PINTEREST_CLIENT_ID,
            client_secret=config.PINTEREST_CLIENT_SECRET,
            redirect_uri=config.PINTEREST_REDIRECT_URI,
            scopes=("boards:read", "boards:write", "pins:read", "pins:write", "user_accounts:read"),
            use_pkce=False,
            missing_env=tuple(
                name
                for name, value in (
                    ("PINTEREST_CLIENT_ID", config.PINTEREST_CLIENT_ID),
                    ("PINTEREST_CLIENT_SECRET", config.PINTEREST_CLIENT_SECRET),
                )
                if not value
            ),
            auth_style="basic",
        ),
        "threads": _ProviderOAuth(
            platform="threads",
            authorize_url="https://threads.net/oauth/authorize",
            token_url="https://graph.threads.net/oauth/access_token",
            client_id=config.THREADS_CLIENT_ID,
            client_secret=config.THREADS_CLIENT_SECRET,
            redirect_uri=config.THREADS_REDIRECT_URI,
            scopes=("threads_basic", "threads_content_publish"),
            use_pkce=False,
            missing_env=tuple(
                name
                for name, value in (
                    ("THREADS_CLIENT_ID", config.THREADS_CLIENT_ID),
                    ("THREADS_CLIENT_SECRET", config.THREADS_CLIENT_SECRET),
                )
                if not value
            ),
        ),
    }


def _require_provider(platform: str) -> _ProviderOAuth:
    normalized = platform.strip().lower()
    if normalized not in connectable_platform_names():
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


def _safe_return_base(candidate: str | None) -> str:
    """Allow OAuth to return to the same browser origin the user started from."""
    fallback = config.PUBLIC_BASE_URL
    if not candidate or not isinstance(candidate, str):
        return fallback
    try:
        from urllib.parse import urlparse

        parsed = urlparse(candidate.strip())
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            return fallback
        if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
            return fallback
        origin = f"{parsed.scheme}://{parsed.netloc}"
    except Exception:
        return fallback
    allowed = {value.rstrip("/") for value in config.ALLOWED_ORIGINS} | {fallback}
    if config.APP_ENV != "production":
        allowed.update(
            {
                "http://localhost:8000",
                "http://127.0.0.1:8000",
                "http://localhost:5173",
                "http://127.0.0.1:5173",
                "http://localhost:3000",
                "http://127.0.0.1:3000",
            }
        )
    return origin if origin in allowed else fallback


def _write_state(
    user_id: UUID,
    platform: str,
    verifier: str | None,
    return_to: str | None = None,
) -> str:
    payload = json.dumps(
        {
            "sub": str(user_id),
            "platform": platform,
            "verifier": verifier,
            "return_to": return_to,
            "exp": int((datetime.now(timezone.utc) + _STATE_TTL).timestamp()),
        },
        separators=(",", ":"),
    )
    return encrypt_token(payload)


def _read_state(state: str, platform: str) -> tuple[UUID, str | None, str | None]:
    try:
        payload = json.loads(decrypt_token(state))
        expires = int(payload["exp"])
        if payload.get("platform") != platform or expires < int(datetime.now(timezone.utc).timestamp()):
            raise ValueError("expired")
        return_to = payload.get("return_to")
        return UUID(str(payload["sub"])), payload.get("verifier"), return_to if isinstance(return_to, str) else None
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This authorization session is invalid or expired. Start the connection again.",
        ) from exc


def _peek_return_base(state: str | None) -> str:
    if not state:
        return config.PUBLIC_BASE_URL
    try:
        payload = json.loads(decrypt_token(state))
        raw = payload.get("return_to")
        return _safe_return_base(raw if isinstance(raw, str) else None)
    except Exception:
        return config.PUBLIC_BASE_URL


def _studio_redirect(return_base: str | None = None, **query: str | None) -> RedirectResponse:
    clean = {key: value for key, value in query.items() if value}
    if "connect_error" in clean:
        clean["connect_error"] = clean["connect_error"][:180]
    suffix = f"?{urlencode(clean)}" if clean else ""
    base = (return_base or config.PUBLIC_BASE_URL).rstrip("/")
    return RedirectResponse(url=f"{base}/{suffix}", status_code=status.HTTP_302_FOUND)


def start_oauth(platform: str, user_id: UUID, return_to: str | None = None) -> dict[str, str]:
    """Build the provider authorization URL for the signed-in user."""
    provider = _require_provider(platform)
    verifier = None
    safe_return = _safe_return_base(return_to) if return_to else None
    params: dict[str, str] = {
        "response_type": "code",
        "redirect_uri": provider.redirect_uri,
        "scope": " ".join(provider.scopes) if provider.platform != "tiktok" else ",".join(provider.scopes),
        "state": "",
    }
    if provider.platform == "tiktok":
        params["client_key"] = provider.client_id
    else:
        params["client_id"] = provider.client_id
    if provider.platform == "youtube":
        params["access_type"] = "offline"
        params["include_granted_scopes"] = "true"
        params["prompt"] = "consent"
    if provider.use_pkce:
        verifier, challenge = _pkce_pair()
        params["code_challenge"] = challenge
        params["code_challenge_method"] = "S256"
    params["state"] = _write_state(user_id, provider.platform, verifier, return_to=safe_return)
    return {"platform": provider.platform, "authorization_url": f"{provider.authorize_url}?{urlencode(params)}"}


def finish_oauth(
    db: Session,
    platform: str,
    *,
    code: str | None,
    state: str | None,
    provider_error: str | None,
) -> RedirectResponse:
    """Exchange an authorization code, then save or open destination pick."""
    return_base = _peek_return_base(state)
    normalized = platform.strip().lower()
    if normalized not in connectable_platform_names():
        return _studio_redirect(return_base, connect_error="That platform cannot be connected.")
    if provider_error:
        return _studio_redirect(return_base, connect_error="Authorization was cancelled or denied.")
    if not code or not state:
        return _studio_redirect(return_base, connect_error="The provider did not return an authorization code.")
    try:
        provider = _require_provider(normalized)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else "OAuth is not configured."
        return _studio_redirect(return_base, connect_error=detail)
    try:
        user_id, verifier, state_return = _read_state(state, provider.platform)
        return_base = _safe_return_base(state_return) if state_return else return_base
        token_payload = _exchange_code(provider, code, verifier)
        identity = _identity(provider, token_payload["access_token"])
        if platform_needs_destination_pick(provider.platform):
            session = create_pick_session(
                db,
                user_id,
                platform=provider.platform,
                access_token=token_payload["access_token"],
                refresh_token=token_payload.get("refresh_token"),
                token_expires_at=token_payload.get("expires_at"),
                scopes=token_payload.get("scopes") or list(provider.scopes),
                identity_json=identity,
            )
            return _studio_redirect(return_base, oauth_pick=provider.platform, pick_session=str(session.id))
        account_type = identity.get("account_type") or default_account_type(provider.platform)
        upsert_oauth_account(
            db,
            user_id,
            platform=provider.platform,
            platform_account_id=identity["id"],
            account_name=identity["name"],
            account_type=account_type,
            access_token=token_payload["access_token"],
            refresh_token=token_payload.get("refresh_token"),
            token_expires_at=token_payload.get("expires_at"),
            scopes=token_payload.get("scopes") or list(provider.scopes),
            extra_metadata={key: value for key, value in identity.items() if key not in {"id", "name", "account_type"}},
        )
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else "Could not connect the account."
        return _studio_redirect(return_base, connect_error=detail)
    except Exception:
        return _studio_redirect(return_base, connect_error="Could not finish connecting the account. Try again.")
    return _studio_redirect(return_base, connected=provider.platform)


def _exchange_code(provider: _ProviderOAuth, code: str, verifier: str | None) -> dict:
    data: dict[str, str] = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": provider.redirect_uri,
    }
    headers: dict[str, str] = {}
    auth = None
    if provider.auth_style == "tiktok":
        data["client_key"] = provider.client_id
        data["client_secret"] = provider.client_secret
    elif provider.auth_style == "basic":
        data["client_id"] = provider.client_id
        if provider.platform == "x":
            if not verifier:
                raise HTTPException(status_code=400, detail="The X authorization session is missing its verifier.")
            data["code_verifier"] = verifier
            auth = (provider.client_id, provider.client_secret)
        elif provider.platform == "pinterest":
            auth = (provider.client_id, provider.client_secret)
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            data["client_secret"] = provider.client_secret
    else:
        data["client_id"] = provider.client_id
        data["client_secret"] = provider.client_secret
        if provider.use_pkce and verifier:
            data["code_verifier"] = verifier
    try:
        response = httpx.post(provider.token_url, data=data, auth=auth, headers=headers or None, timeout=30.0)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach {provider.platform} to exchange the code.") from exc
    if response.is_error:
        raise HTTPException(status_code=502, detail=f"{provider.platform} rejected the authorization code.")
    payload = response.json()
    if provider.platform == "instagram":
        payload = _instagram_token(provider, payload)
    if provider.platform == "tiktok" and isinstance(payload.get("data"), dict):
        payload = payload["data"]
    if provider.platform == "facebook":
        payload = _facebook_long_lived(provider, payload)
    if provider.platform == "threads":
        payload = _threads_long_lived(provider, payload)
    access_token = payload.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise HTTPException(status_code=502, detail=f"{provider.platform} did not return an access token.")
    expires_at = None
    expires_in = payload.get("expires_in")
    if expires_in:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
    scope = payload.get("scope")
    if isinstance(scope, str):
        scopes = scope.replace(",", " ").split()
    elif isinstance(scope, list):
        scopes = [str(item) for item in scope]
    else:
        scopes = list(provider.scopes)
    refresh_token = payload.get("refresh_token")
    return {
        "access_token": access_token,
        "refresh_token": refresh_token if isinstance(refresh_token, str) and refresh_token else None,
        "expires_at": expires_at,
        "scopes": scopes,
    }


def _instagram_token(provider: _ProviderOAuth, payload: dict) -> dict:
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


def _facebook_long_lived(provider: _ProviderOAuth, payload: dict) -> dict:
    access_token = payload.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise HTTPException(status_code=502, detail="Facebook did not return an access token.")
    try:
        response = httpx.get(
            f"{_meta_graph(config.FACEBOOK_GRAPH_API_VERSION)}/oauth/access_token",
            params={
                "grant_type": "fb_exchange_token",
                "client_id": provider.client_id,
                "client_secret": provider.client_secret,
                "fb_exchange_token": access_token,
            },
            timeout=30.0,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Could not reach Facebook to extend the access token.") from exc
    if response.is_error:
        return payload
    body = response.json()
    if isinstance(body.get("access_token"), str):
        return body
    return payload


def _threads_long_lived(provider: _ProviderOAuth, payload: dict) -> dict:
    access_token = payload.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise HTTPException(status_code=502, detail="Threads did not return an access token.")
    try:
        response = httpx.get(
            "https://graph.threads.net/access_token",
            params={
                "grant_type": "th_exchange_token",
                "client_secret": provider.client_secret,
                "access_token": access_token,
            },
            timeout=30.0,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Could not reach Threads to extend the access token.") from exc
    if response.is_error:
        return payload
    body = response.json()
    if isinstance(body.get("access_token"), str):
        body.setdefault("user_id", payload.get("user_id"))
        return body
    return payload



def _normalize_avatar_url(value) -> str | None:
    """Accept a URL string or nested provider picture object."""
    if isinstance(value, str):
        url = value.strip()
        return url if url.startswith(("http://", "https://")) else None
    if isinstance(value, dict):
        nested = value.get("data") if isinstance(value.get("data"), dict) else value
        if isinstance(nested, dict):
            return _normalize_avatar_url(nested.get("url"))
    return None


def _identity(provider: _ProviderOAuth, access_token: str) -> dict:
    if provider.platform == "x":
        return _x_identity(access_token)
    if provider.platform == "linkedin":
        return _linkedin_identity(access_token)
    if provider.platform == "instagram":
        return _instagram_identity(access_token)
    if provider.platform == "facebook":
        return _facebook_identity(access_token)
    if provider.platform == "youtube":
        return _youtube_identity(access_token)
    if provider.platform == "tiktok":
        return _tiktok_identity(access_token)
    if provider.platform == "pinterest":
        return _pinterest_identity(access_token)
    return _threads_identity(access_token)


def _authorized_get(url: str, access_token: str, *, params: dict | None = None, headers: dict | None = None) -> dict:
    request_headers = {"Authorization": f"Bearer {access_token}", **(headers or {})}
    try:
        response = httpx.get(url, params=params, headers=request_headers, timeout=30.0)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Could not reach the provider to read the account profile.") from exc
    if response.is_error:
        raise HTTPException(status_code=502, detail="The provider refused the account profile request.")
    body = response.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=502, detail="The provider returned an unexpected profile response.")
    return body


def _x_identity(access_token: str) -> dict:
    body = _authorized_get(
        "https://api.x.com/2/users/me",
        access_token,
        params={"user.fields": "name,username,profile_image_url"},
    )
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    account_id = data.get("id")
    if not account_id:
        raise HTTPException(status_code=502, detail="X did not return an account id.")
    name = data.get("name") or data.get("username") or "X account"
    identity = {"id": str(account_id), "name": str(name)[:255], "account_type": "user", "username": data.get("username")}
    avatar = _normalize_avatar_url(data.get("profile_image_url"))
    if avatar:
        # Prefer larger X avatar when the API returns the _normal size.
        identity["avatar_url"] = avatar.replace("_normal.", ".")
    return identity


def _linkedin_identity(access_token: str) -> dict:
    body = _authorized_get("https://api.linkedin.com/v2/userinfo", access_token)
    subject = body.get("sub")
    if not subject:
        raise HTTPException(status_code=502, detail="LinkedIn did not return a member id.")
    name = body.get("name") or body.get("email") or "LinkedIn member"
    identity = {
        "id": f"urn:li:person:{subject}",
        "name": str(name)[:255],
        "account_type": "personal",
        "member_id": str(subject),
    }
    avatar = _normalize_avatar_url(body.get("picture"))
    if avatar:
        identity["avatar_url"] = avatar
    return identity


def _instagram_identity(access_token: str) -> dict:
    version = config.INSTAGRAM_GRAPH_API_VERSION or "v24.0"
    body = _authorized_get(
        f"https://graph.instagram.com/{version}/me",
        access_token,
        params={"fields": "user_id,username,name,account_type,profile_picture_url"},
    )
    account_id = body.get("user_id") or body.get("id")
    if not account_id:
        raise HTTPException(status_code=502, detail="Instagram did not return an account id.")
    raw_type = str(body.get("account_type") or "BUSINESS").strip().upper()
    account_type = "creator" if raw_type == "MEDIA_CREATOR" else "business"
    name = body.get("username") or body.get("name") or "Instagram account"
    identity = {
        "id": str(account_id),
        "name": str(name)[:255],
        "account_type": account_type,
        "username": body.get("username"),
    }
    avatar = _normalize_avatar_url(body.get("profile_picture_url"))
    if avatar:
        identity["avatar_url"] = avatar
    return identity


def _facebook_identity(access_token: str) -> dict:
    body = _authorized_get(
        f"{_meta_graph(config.FACEBOOK_GRAPH_API_VERSION)}/me",
        access_token,
        params={"fields": "id,name,picture.type(large)"},
    )
    account_id = body.get("id")
    if not account_id:
        raise HTTPException(status_code=502, detail="Facebook did not return a user id.")
    identity = {
        "id": str(account_id),
        "name": str(body.get("name") or "Facebook login")[:255],
        "account_type": "login",
        "note": "Personal Facebook profiles are not publishable destinations.",
    }
    avatar = _normalize_avatar_url(body.get("picture"))
    if avatar:
        identity["avatar_url"] = avatar
    return identity


def _youtube_identity(access_token: str) -> dict:
    body = _authorized_get("https://www.googleapis.com/oauth2/v3/userinfo", access_token)
    account_id = body.get("sub")
    if not account_id:
        raise HTTPException(status_code=502, detail="Google did not return a user id.")
    identity = {
        "id": str(account_id),
        "name": str(body.get("name") or body.get("email") or "YouTube login")[:255],
        "account_type": "login",
        "email": body.get("email"),
    }
    avatar = _normalize_avatar_url(body.get("picture"))
    if avatar:
        identity["avatar_url"] = avatar
    return identity


def _tiktok_identity(access_token: str) -> dict:
    try:
        response = httpx.get(
            "https://open.tiktokapis.com/v2/user/info/",
            params={"fields": "open_id,display_name,username,avatar_url"},
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=30.0,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Could not reach TikTok to read the account profile.") from exc
    if response.is_error:
        raise HTTPException(status_code=502, detail="TikTok refused the account profile request.")
    body = response.json()
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    user = data.get("user") if isinstance(data.get("user"), dict) else data
    account_id = user.get("open_id") or user.get("union_id")
    if not account_id:
        raise HTTPException(status_code=502, detail="TikTok did not return an account id.")
    name = user.get("display_name") or user.get("username") or "TikTok account"
    identity = {
        "id": str(account_id),
        "name": str(name)[:255],
        "account_type": "creator",
        "username": user.get("username"),
    }
    avatar = _normalize_avatar_url(user.get("avatar_url"))
    if avatar:
        identity["avatar_url"] = avatar
    return identity


def _pinterest_identity(access_token: str) -> dict:
    body = _authorized_get("https://api.pinterest.com/v5/user_account", access_token)
    account_id = body.get("username") or body.get("id")
    if not account_id:
        raise HTTPException(status_code=502, detail="Pinterest did not return a user account.")
    name = body.get("business_name") or body.get("username") or "Pinterest user"
    identity = {
        "id": str(account_id),
        "name": str(name)[:255],
        "account_type": "user",
        "username": body.get("username"),
    }
    avatar = _normalize_avatar_url(body.get("profile_image"))
    if avatar:
        identity["avatar_url"] = avatar
    return identity


def _threads_identity(access_token: str) -> dict:
    body = _authorized_get(
        "https://graph.threads.net/v1.0/me",
        access_token,
        params={"fields": "id,username,name,threads_profile_picture_url"},
    )
    account_id = body.get("id")
    if not account_id:
        raise HTTPException(status_code=502, detail="Threads did not return a profile id.")
    name = body.get("username") or body.get("name") or "Threads profile"
    identity = {
        "id": str(account_id),
        "name": str(name)[:255],
        "account_type": "profile",
        "username": body.get("username"),
    }
    avatar = _normalize_avatar_url(body.get("threads_profile_picture_url"))
    if avatar:
        identity["avatar_url"] = avatar
    return identity
