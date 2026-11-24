"""Check a Meta post directly, then corroborate a missing object with its owner."""

from app.integrations.base import ProviderHTTPError
from app.services.engagement.base import EngagementRetryableError, ProviderAuthError, RemotePostDeleted
from app.services.engagement.http import request_json


def verify_meta_post(network, graph, account, post, token):
    post_id = str(post.provider_post_id)
    owner = str(account.platform_account_id)
    try:
        result = request_json("GET", graph(post_id), access_token=token, params={"fields": "id"})
    except ProviderAuthError as exc:
        # Facebook also returns permission code 10 for a removed Page post.
        # The authenticated Page listing must independently confirm absence.
        if network != "facebook" or exc.kind != "permission":
            raise
    except ProviderHTTPError as exc:
        if not (exc.status_code == 404 or
                (str(exc.provider_code) == "100" and str(exc.provider_subcode) == "33")):
            raise
    else:
        if result.get("id"):
            return
        raise EngagementRetryableError("Meta did not return a post identifier.")

    metadata = post.post_metadata or {}
    if "story" in str(metadata.get("format", "")).lower():
        raise EngagementRetryableError("The story is no longer accessible. It may have expired.")
    if network == "instagram":
        page = (account.extra_metadata or {}).get("linked_facebook_page_id") or "me"
        identity = request_json("GET", graph(page), access_token=token,
                                params={"fields": "instagram_business_account"})
        profile = identity.get("instagram_business_account") or {}
        edge = "media"
    else:
        profile = request_json("GET", graph("me"), access_token=token, params={"fields": "id"})
        edge = "published_posts"
    if str(profile.get("id", "")) != owner:
        raise EngagementRetryableError("Could not verify the post's connected profile.")

    params = {"fields": "id", "limit": "100"}
    if network == "facebook":
        params["fields"] = "id,attachments{target,subattachments{target}}"
    seen = set()
    for _ in range(10):
        body = request_json("GET", graph(f"{owner}/{edge}"), access_token=token, params=params)
        rows = body.get("data")
        if not isinstance(rows, list) or any(not isinstance(row, dict) or not row.get("id") for row in rows):
            break
        for row in rows:
            ids = {str(row["id"])}
            if network == "facebook":
                ids.add(str(row["id"]).split("_")[-1])
                for attachment in (row.get("attachments") or {}).get("data", []):
                    for item in [attachment, *(attachment.get("subattachments") or {}).get("data", [])]:
                        ids.add(str((item.get("target") or {}).get("id", "")))
            if post_id in ids:
                raise EngagementRetryableError("The post is listed but its details are unavailable.")
        paging = body.get("paging") or {}
        if not paging.get("next"):
            raise RemotePostDeleted(network)
        cursor = (paging.get("cursors") or {}).get("after")
        if not cursor or cursor in seen:
            break
        params["after"] = cursor
        seen.add(cursor)
    raise EngagementRetryableError("Could not finish checking the profile's posts.")
