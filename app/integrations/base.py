"""Shared contracts and HTTP transport for social platform adapters."""

from abc import ABC, abstractmethod
from dataclasses import dataclass

import re

import httpx

from app.core.exceptions import ProviderConfigurationError


@dataclass(frozen=True)
class ProviderPublishResult:
    """Provider identifiers and request metadata returned after publish."""

    post_id: str
    request_id: str | None = None
    status_code: int | None = None


class SocialPlatform(ABC):
    """Interface implemented by each supported social network integration."""

    platform: str
    # When False, delete() must raise ProviderConfigurationError (fail closed).
    supports_remote_delete: bool = False

    @abstractmethod
    def publish(self, access_token: str, account_id: str, content: str, media_urls: list[str]) -> ProviderPublishResult:
        """Publish and return the provider-confirmed post identifier."""

    def delete(self, access_token: str, provider_post_id: str) -> None:
        """Delete a previously published post on the social network.

        Platforms that set supports_remote_delete=True must override this.
        """
        raise ProviderConfigurationError(
            f"Remote delete is not supported for {self.platform}. "
            "Remove the post on the platform manually, or keep it in SocialStudio."
        )


def provider_request(
    method: str, url: str, *, access_token: str, json: dict | None = None, headers: dict[str, str] | None = None
) -> httpx.Response:
    """Send an authenticated provider request with timeout and safe errors."""
    request_headers = {"Authorization": f"Bearer {access_token}", **(headers or {})}
    try:
        response = httpx.request(method, url, json=json, headers=request_headers, timeout=30.0)
    except httpx.TimeoutException as exc:
        raise RuntimeError("Provider request timed out") from exc
    except httpx.RequestError as exc:
        raise RuntimeError("Could not connect to the social platform") from exc
    if response.is_error:
        # Keep only a short, redacted summary of the provider's error (title/detail/type).
        raise ProviderHTTPError(response.status_code, provider_error_summary(response))
    return response


def provider_delete(
    url: str, *, access_token: str, headers: dict[str, str] | None = None
) -> None:
    """DELETE a remote post. Treat 404 as already-deleted success (idempotent)."""
    request_headers = {"Authorization": f"Bearer {access_token}", **(headers or {})}
    try:
        response = httpx.request("DELETE", url, headers=request_headers, timeout=30.0)
    except httpx.TimeoutException as exc:
        raise RuntimeError("Provider delete timed out") from exc
    except httpx.RequestError as exc:
        raise RuntimeError("Could not connect to the social platform to delete") from exc
    if response.status_code == 404:
        return
    if response.is_error:
        raise ProviderHTTPError(response.status_code)


class ProviderHTTPError(RuntimeError):
    """Provider returned an HTTP error status."""

    def __init__(self, status_code: int, detail: str | None = None):
        self.status_code = status_code
        self.detail = detail or None
        message = f"Provider returned HTTP {status_code}"
        super().__init__(f"{message}: {detail}" if detail else message)


_SECRET_PATTERNS = (
    re.compile(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]+"),
    re.compile(r"(?i)(access_token|refresh_token|client_secret|token|code)=[^&\s\"']+"),
    re.compile(r"[A-Za-z0-9_-]{40,}"),
)


def _redact(text: str) -> str:
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub("[redacted]", text)
    return text


def provider_error_summary(response: httpx.Response, limit: int = 400) -> str | None:
    """Summarize a provider error body (X: title/detail/type/errors) without secrets."""
    parts: list[str] = []
    try:
        body = response.json()
    except Exception:
        body = None
    if isinstance(body, dict):
        for key in ("title", "detail", "reason", "error", "error_description", "message"):
            value = body.get(key)
            if isinstance(value, dict):
                value = value.get("message") or value.get("code")
            if isinstance(value, (str, int)) and str(value) and str(value) not in parts:
                parts.append(str(value))
        problem_type = body.get("type")
        if isinstance(problem_type, str) and problem_type:
            parts.append(f"type={problem_type.rsplit('/', 1)[-1]}")
        errors = body.get("errors")
        if isinstance(errors, list):
            for item in errors[:3]:
                if isinstance(item, dict):
                    msg = item.get("message") or item.get("detail") or item.get("title")
                    if msg and str(msg) not in parts:
                        parts.append(str(msg))
    elif response.text:
        parts.append(response.text.strip()[:200])
    if not parts:
        return None
    return _redact(" | ".join(parts))[:limit]
