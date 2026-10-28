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


def delete_remote(platform: str, access_token: str, provider_post_id: str) -> None:
    """Delete a provider-confirmed post. Fail closed on errors or unsupported platforms."""
    post_id = (provider_post_id or "").strip()
    if not post_id:
        raise PublishingError("Missing provider post id for remote delete", code="remote_delete_missing_id", retryable=False)
    if post_id.startswith("inbox:"):
        # TikTok inbox drafts are not live network posts.
        return
    try:
        adapter = get_platform(platform)
        if not getattr(adapter, "supports_remote_delete", False):
            raise ProviderConfigurationError(
                f"Remote delete is not supported for {platform}. "
                "Remove the post on the platform manually, then delete it here."
            )
        adapter.delete(access_token, post_id)
    except ProviderHTTPError as exc:
        retryable = exc.status_code == 429 or exc.status_code >= 500
        raise PublishingError(
            f"Remote delete failed (HTTP {exc.status_code}). The post was kept in SocialStudio.",
            code="remote_delete_http_error",
            retryable=retryable,
            status_code=exc.status_code,
        ) from exc
    except RuntimeError as exc:
        raise PublishingError(
            f"Remote delete failed: {exc}. The post was kept in SocialStudio.",
            code="remote_delete_request_error",
            retryable=True,
        ) from exc
    except ProviderConfigurationError as exc:
        raise PublishingError(str(exc), code="remote_delete_unsupported", retryable=False) from exc
    except Exception as exc:
        raise PublishingError(
            "Remote delete failed. The post was kept in SocialStudio.",
            code="remote_delete_error",
            retryable=False,
        ) from exc

