"""Translate provider adapter outcomes into retry-aware publishing results."""

from app.core.exceptions import ProviderConfigurationError
from app.integrations.base import ProviderHTTPError, ProviderPublishResult
from app.integrations.registry import get_platform


class PublishingError(Exception):
    """Provider failure with a stable code and retry policy."""

    def __init__(
        self, message: str, *, code: str = "provider_error", retryable: bool = True, status_code: int | None = None
    ):
        super().__init__(message)
        self.code, self.retryable, self.status_code = code, retryable, status_code


PublishResult = ProviderPublishResult


def publish(platform: str, access_token: str, account_id: str, content: str, media_urls: list[str]) -> PublishResult:
    """Publish through the registered platform adapter with normalized errors."""
    try:
        return get_platform(platform).publish(access_token, account_id, content, media_urls)
    except ProviderHTTPError as exc:
        retryable = exc.status_code == 429 or exc.status_code >= 500
        raise PublishingError(
            str(exc), code="provider_http_error", retryable=retryable, status_code=exc.status_code
        ) from exc
    except RuntimeError as exc:
        raise PublishingError(str(exc), code="provider_request_error", retryable=True) from exc
    except ProviderConfigurationError as exc:
        raise PublishingError(str(exc), code="provider_not_configured", retryable=False) from exc
    except Exception as exc:
        raise PublishingError("Provider publishing failed", code="provider_error", retryable=False) from exc
