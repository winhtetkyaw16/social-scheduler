"""Shared contracts and HTTP transport for social platform adapters."""

from abc import ABC, abstractmethod
from dataclasses import dataclass

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
        # Do not persist provider response bodies: they may include private diagnostics.
        raise ProviderHTTPError(response.status_code)
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

    def __init__(self, status_code: int):
        self.status_code = status_code
        super().__init__(f"Provider returned HTTP {status_code}")
