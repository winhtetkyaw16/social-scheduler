"""Shared contracts and HTTP transport for social platform adapters."""

from abc import ABC, abstractmethod
from dataclasses import dataclass

import httpx


@dataclass(frozen=True)
class ProviderPublishResult:
    """Provider identifiers and request metadata returned after publish."""

    post_id: str
    request_id: str | None = None
    status_code: int | None = None


class SocialPlatform(ABC):
    """Interface implemented by each supported social network integration."""

    platform: str

    @abstractmethod
    def publish(self, access_token: str, account_id: str, content: str, media_urls: list[str]) -> ProviderPublishResult:
        """Publish and return the provider-confirmed post identifier."""


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


class ProviderHTTPError(RuntimeError):
    """Provider returned an HTTP error status."""

    def __init__(self, status_code: int):
        self.status_code = status_code
        super().__init__(f"Provider returned HTTP {status_code}")
