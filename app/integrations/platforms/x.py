"""X API v2 publisher adapter."""

from app.core.exceptions import ProviderConfigurationError
from app.integrations.base import ProviderPublishResult, SocialPlatform, provider_delete, provider_request


class XPlatform(SocialPlatform):
    """Publish text-only posts to X."""

    platform = "x"
    supports_remote_delete = True

    def publish(self, access_token: str, account_id: str, content: str, media_urls: list[str]) -> ProviderPublishResult:
        """Create a post and return its X status identifier."""
        if media_urls:
            raise ProviderConfigurationError("X media upload is not implemented; schedule text-only posts")
        response = provider_request(
            "POST", "https://api.x.com/2/tweets", access_token=access_token, json={"text": content}
        )
        data = response.json().get("data", {})
        post_id = data.get("id")
        if not post_id:
            raise RuntimeError("X accepted the request without returning a post identifier")
        return ProviderPublishResult(
            post_id=post_id, request_id=response.headers.get("x-transaction-id"), status_code=response.status_code
        )


    def delete(self, access_token: str, provider_post_id: str) -> None:
        """Delete a tweet/post on X."""
        post_id = (provider_post_id or "").strip()
        if not post_id:
            raise ProviderConfigurationError("X delete needs a provider post id.")
        provider_delete(f"https://api.x.com/2/tweets/{post_id}", access_token=access_token)
