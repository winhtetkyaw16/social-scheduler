"""LinkedIn REST Posts API publisher adapter."""

import os

from app.core.exceptions import ProviderConfigurationError
from app.integrations.base import ProviderPublishResult, SocialPlatform, provider_request


class LinkedInPlatform(SocialPlatform):
    """Publish text-only posts to LinkedIn's member feed."""

    platform = "linkedin"

    def publish(self, access_token: str, account_id: str, content: str, media_urls: list[str]) -> ProviderPublishResult:
        """Publish a text post and return the REST API post identifier."""
        if media_urls:
            raise ProviderConfigurationError("LinkedIn media upload is not implemented; schedule text-only posts")
        version = os.getenv("LINKEDIN_VERSION", "202610")
        if len(version) != 6 or not version.isdigit():
            raise ProviderConfigurationError("LINKEDIN_VERSION must use YYYYMM format")
        response = provider_request(
            "POST",
            "https://api.linkedin.com/rest/posts",
            access_token=access_token,
            headers={"Linkedin-Version": version, "X-Restli-Protocol-Version": "2.0.0"},
            json={
                "author": account_id,
                "commentary": content,
                "visibility": "PUBLIC",
                "distribution": {
                    "feedDistribution": "MAIN_FEED",
                    "targetEntities": [],
                    "thirdPartyDistributionChannels": [],
                },
                "lifecycleState": "PUBLISHED",
                "isReshareDisabledByAuthor": False,
            },
        )
        post_id = response.headers.get("x-restli-id")
        if not post_id:
            raise RuntimeError("LinkedIn accepted the request without returning a post identifier")
        return ProviderPublishResult(
            post_id=post_id, request_id=response.headers.get("x-li-uuid"), status_code=response.status_code
        )
