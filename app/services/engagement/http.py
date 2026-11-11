"""HTTP for engagement providers. Tokens stay in the Authorization header.

Errors that mean the token is dead or a permission is missing become
``ProviderAuthError`` so the sweep can set ``needs_reconnect``. X credit
failures become ``CreditsRequired`` and do not flag the account.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.integrations.base import ProviderHTTPError, provider_error_summary
from app.services.engagement.base import CreditsRequired, ProviderAuthError
from app.services.error_messages import network_name
from app.services.token_refresh import reconnect_copy

logger = logging.getLogger(__name__)

_CREDIT_PHRASES = (
    "creditsdepleted",
    "credits depleted",
    "payment required",
)
_PERMISSION_PHRASES = (
    "permission",
    "insufficient",
    "scope",
    "not authorized",
    "(#10)",
    "(#200)",
    "oauth",
)
_AUTH_REASONS = {
    "autherror",
    "invalidcredentials",
    "invalid_grant",
    "insufficientpermissions",
    "insufficientpermission",
}
_GRAPH_AUTH_CODES = {190, 102, 463, 467}
_GRAPH_PERMISSION_CODES = {10, 200}


def auth_message(account, kind: str) -> str:
    """Plain-language reconnect copy. No provider error body."""
    platform = getattr(account, "platform", None)
    if kind == "permission":
        name = network_name(platform)
        return f"Reconnect {name} and allow the new comment and insights permissions."
    return reconnect_copy(platform, expired=True)


def request_json(
    method: str,
    url: str,
    *,
    access_token: str,
    params: dict | None = None,
    json_body: dict | None = None,
    data: dict | None = None,
) -> dict[str, Any]:
    """Send one authenticated request and return a JSON object."""
    headers = {"Authorization": f"Bearer {access_token}"}
    try:
        response = httpx.request(
            method,
            url,
            params=params,
            json=json_body,
            data=data,
            headers=headers,
            timeout=30.0,
        )
    except httpx.TimeoutException as exc:
        raise RuntimeError("The network timed out") from exc
    except httpx.RequestError as exc:
        raise RuntimeError("Could not connect to the social network") from exc
    if response.is_error:
        raise _classified(response)
    if not response.content:
        return {}
    try:
        body = response.json()
    except ValueError as exc:
        raise RuntimeError("The network returned a response that was not JSON") from exc
    if isinstance(body, dict):
        _raise_for_tiktok_error(body)
        return body
    return {"data": body}


def collect_graph(
    url: str,
    access_token: str,
    params: dict,
    *,
    max_pages: int = 5,
) -> list:
    """Follow Graph ``paging.cursors.after``. The cursor is not a full URL, so the token stays in the header."""
    rows: list = []
    query = dict(params)
    seen: set[str] = set()
    for _ in range(max_pages):
        body = request_json("GET", url, access_token=access_token, params=query)
        page = body.get("data") or []
        if isinstance(page, list):
            rows.extend(item for item in page if isinstance(item, dict))
        cursors = (body.get("paging") or {}).get("cursors") or {}
        after = cursors.get("after") if isinstance(cursors, dict) else None
        if not after or not page or after in seen:
            break
        seen.add(str(after))
        query["after"] = after
    return rows


def _blob(response: httpx.Response) -> str:
    summary = provider_error_summary(response) or ""
    try:
        body = response.json()
    except Exception:
        body = None
    extra = ""
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict):
            extra = " ".join(
                str(error.get(key) or "")
                for key in ("message", "type", "code", "error_subcode", "reason")
            )
        errors = body.get("errors")
        if isinstance(errors, list):
            for item in errors[:3]:
                if isinstance(item, dict):
                    extra += " " + str(item.get("reason") or "")
    return f"{summary} {extra}".lower()


def _graph_code(response: httpx.Response) -> int | None:
    try:
        body = response.json()
    except Exception:
        return None
    if not isinstance(body, dict):
        return None
    error = body.get("error")
    if isinstance(error, dict) and error.get("code") is not None:
        try:
            return int(error["code"])
        except (TypeError, ValueError):
            return None
    return None


def _is_credits(response: httpx.Response, blob: str) -> bool:
    if response.status_code == 402:
        return True
    return any(phrase in blob for phrase in _CREDIT_PHRASES)


def _classified(response: httpx.Response) -> Exception:
    blob = _blob(response)
    if _is_credits(response, blob):
        return CreditsRequired(
            "This network needs API credits before SocialCastly can read or reply. "
            "Add credits, then try again."
        )
    code = _graph_code(response)
    if response.status_code == 401 or code in _GRAPH_AUTH_CODES:
        return ProviderAuthError("expired", kind="expired")
    if code in _GRAPH_PERMISSION_CODES or (
        response.status_code == 403 and any(phrase in blob for phrase in _PERMISSION_PHRASES)
    ):
        return ProviderAuthError("permission", kind="permission")
    if any(reason in blob for reason in _AUTH_REASONS):
        if "quota" in blob or "ratelimit" in blob:
            return ProviderHTTPError(response.status_code, provider_error_summary(response))
        kind = "permission" if "permission" in blob or "scope" in blob else "expired"
        return ProviderAuthError(kind, kind=kind)
    logger.info(
        "Engagement provider HTTP %s outcome=error",
        response.status_code,
    )
    return ProviderHTTPError(response.status_code, provider_error_summary(response))


def _raise_for_tiktok_error(body: dict) -> None:
    error = body.get("error")
    if not isinstance(error, dict):
        return
    code = str(error.get("code") or "").strip().lower()
    if code in {"", "ok", "0"}:
        return
    message = str(error.get("message") or code)
    lowered = f"{code} {message}".lower()
    if "scope" in lowered or "permission" in lowered:
        raise ProviderAuthError("permission", kind="permission")
    if "token" in lowered or "auth" in lowered:
        raise ProviderAuthError("expired", kind="expired")
    raise ProviderHTTPError(400, message[:200])
