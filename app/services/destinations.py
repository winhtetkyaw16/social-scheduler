"""Discover Pages / orgs / channels / boards after OAuth for destination pick."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

import httpx
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core import config
from app.core.security import decrypt_token
from app.integrations.platform_catalog import default_account_type
from app.models.connected_account import OAuthPickSession
from app.services.accounts import delete_pick_session, get_pick_session, upsert_oauth_account


def list_destinations(db: Session, user_id: UUID, session_id: UUID) -> dict:
    session = get_pick_session(db, user_id, session_id)
    access_token = decrypt_token(session.access_token_ciphertext)
    platform = session.platform
    if platform == "facebook":
        destinations = _facebook_destinations(access_token)
    elif platform == "instagram":
        destinations = _instagram_destinations(access_token)
        if not destinations:
            raise HTTPException(
                status_code=404,
                detail="No Instagram business account linked to a Facebook Page you manage.",
            )
    elif platform == "linkedin":
        destinations = _linkedin_destinations(access_token, session.identity_json or {})
    elif platform == "youtube":
        destinations = _youtube_destinations(access_token)
    elif platform == "pinterest":
        destinations = _pinterest_destinations(access_token, session.identity_json or {})
    else:
        raise HTTPException(status_code=400, detail=f"{platform} does not use destination picking.")
    return {
        "platform": platform,
        "pick_session_id": str(session.id),
        "identity": session.identity_json or {},
        "destinations": destinations,
        "notes": _notes_for(platform),
    }


def save_destinations(db: Session, user_id: UUID, session_id: UUID, destination_ids: list[str]) -> list:
    if not destination_ids:
        raise HTTPException(status_code=422, detail="Select at least one destination to save.")
    session = get_pick_session(db, user_id, session_id)
    listed = list_destinations(db, user_id, session_id)
    by_id = {item["id"]: item for item in listed["destinations"]}
    missing = [item for item in destination_ids if item not in by_id]
    if missing:
        raise HTTPException(status_code=422, detail="One or more selected destinations are no longer available.")
    access_token = decrypt_token(session.access_token_ciphertext)
    refresh = decrypt_token(session.refresh_token_ciphertext) if session.refresh_token_ciphertext else None
    saved = []
    parent_id = None
    # For Pinterest, also keep the user parent so boards can reference it.
    if session.platform == "pinterest":
        identity = session.identity_json or {}
        parent_meta = {"role": "login_parent"}
        if identity.get("avatar_url"):
            parent_meta["avatar_url"] = identity["avatar_url"]
        parent = upsert_oauth_account(
            db,
            user_id,
            platform="pinterest",
            platform_account_id=str(identity.get("id")),
            account_name=str(identity.get("name") or "Pinterest user")[:255],
            account_type="user",
            access_token=access_token,
            refresh_token=refresh,
            token_expires_at=session.token_expires_at,
            scopes=list(session.scopes or []),
            extra_metadata=parent_meta,
        )
        parent_id = parent.id
    for dest_id in destination_ids:
        item = by_id[dest_id]
        token_for_dest = item.get("access_token") or access_token
        dest_platform = str(item.get("platform") or session.platform).strip().lower()
        account = upsert_oauth_account(
            db,
            user_id,
            platform=dest_platform,
            platform_account_id=item["id"],
            account_name=item["name"],
            account_type=item.get("account_type") or default_account_type(dest_platform),
            parent_account_id=parent_id if dest_platform == session.platform else None,
            access_token=token_for_dest,
            refresh_token=refresh,
            token_expires_at=session.token_expires_at,
            scopes=list(session.scopes or []),
            extra_metadata={
                key: value
                for key, value in item.items()
                if key not in {"id", "name", "account_type", "access_token", "platform"}
            },
        )
        saved.append(account)
    delete_pick_session(db, session)
    return saved


def _ig_item(ig: dict, token: str, page_id: str | None = None) -> dict:
    ig_name = str(ig.get("name") or ig.get("username") or "Instagram")[:255]
    item = {
        "id": str(ig["id"]),
        "name": ig_name if not ig.get("username") else f"{ig_name} (@{ig.get('username')})"[:255],
        "account_type": "business",
        "platform": "instagram",
        "access_token": token,
    }
    if ig.get("username"):
        item["username"] = str(ig["username"])
    if page_id:
        item["linked_facebook_page_id"] = page_id
    avatar = ig.get("profile_picture_url")
    if isinstance(avatar, str) and avatar.startswith(("http://", "https://")):
        item["avatar_url"] = avatar
    return item


def _instagram_destinations(access_token: str) -> list[dict]:
    """Instagram business accounts reachable through Facebook Login for Business."""
    version = config.INSTAGRAM_GRAPH_API_VERSION or "v24.0"
    base = f"https://graph.facebook.com/{version}"
    headers = {"Authorization": f"Bearer {access_token}"}
    ig_fields = "id,username,name,profile_picture_url"
    found: dict[str, dict] = {}
    try:
        pages = httpx.get(
            f"{base}/me/accounts",
            params={"fields": f"id,name,access_token,instagram_business_account{{{ig_fields}}}", "limit": 100},
            headers=headers,
            timeout=30.0,
        )
        if not pages.is_error:
            for page in pages.json().get("data") or []:
                ig = page.get("instagram_business_account") if isinstance(page, dict) else None
                if isinstance(ig, dict) and ig.get("id") and str(ig["id"]) not in found:
                    found[str(ig["id"])] = _ig_item(ig, page.get("access_token") or access_token, str(page.get("id")))
    except httpx.HTTPError:
        pass
    if found:
        return list(found.values())
    # Fallback: business-owned Instagram accounts (system users / Business Manager assets).
    try:
        biz = httpx.get(
            f"{base}/me",
            params={
                "fields": f"businesses{{id,name,owned_instagram_accounts{{{ig_fields}}},instagram_accounts{{{ig_fields}}}}}"
            },
            headers=headers,
            timeout=30.0,
        )
        if not biz.is_error:
            businesses = (biz.json().get("businesses") or {}).get("data") or []
            for business in businesses:
                if not isinstance(business, dict):
                    continue
                for key in ("owned_instagram_accounts", "instagram_accounts"):
                    for ig in (business.get(key) or {}).get("data") or []:
                        if isinstance(ig, dict) and ig.get("id") and str(ig["id"]) not in found:
                            found[str(ig["id"])] = _ig_item(ig, access_token)
    except httpx.HTTPError:
        pass
    return list(found.values())


def _notes_for(platform: str) -> str:
    if platform == "instagram":
        return "Choose the Instagram professional accounts (linked to Facebook Pages you manage) to publish to."
    if platform == "facebook":
        return "Personal Facebook profiles are not publishable. Choose Pages, Groups (when Meta returns them), and linked Instagram Business accounts."
    if platform == "linkedin":
        return "Choose your personal profile and/or Company/Organization Pages you administer."
    if platform == "youtube":
        return "Choose YouTube Channel / Brand channel destinations."
    if platform == "pinterest":
        return "Choose Boards to pin to. The Pinterest user is saved as a parent identity."
    return ""


def _facebook_destinations(access_token: str) -> list[dict]:
    version = config.FACEBOOK_GRAPH_API_VERSION or "v21.0"
    destinations: list[dict] = []
    try:
        pages = httpx.get(
            f"https://graph.facebook.com/{version}/me/accounts",
            params={
                "fields": "id,name,access_token,category,tasks,picture.type(large),instagram_business_account{id,username,name,profile_picture_url}",
                "limit": 100,
            },
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=30.0,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Could not reach Facebook to list Pages.") from exc
    if pages.is_error:
        raise HTTPException(status_code=502, detail="Facebook refused to list Pages for this login.")
    seen_ig: set[str] = set()
    for page in pages.json().get("data") or []:
        if not isinstance(page, dict) or not page.get("id"):
            continue
        item = {
            "id": str(page["id"]),
            "name": str(page.get("name") or "Facebook Page")[:255],
            "account_type": "page",
            "platform": "facebook",
            "access_token": page.get("access_token"),
            "category": page.get("category"),
        }
        picture = page.get("picture")
        if isinstance(picture, dict):
            data = picture.get("data") if isinstance(picture.get("data"), dict) else picture
            url = data.get("url") if isinstance(data, dict) else None
            if isinstance(url, str) and url.startswith(("http://", "https://")):
                item["avatar_url"] = url
        destinations.append(item)

        ig = page.get("instagram_business_account")
        if isinstance(ig, dict) and ig.get("id"):
            ig_id = str(ig["id"])
            if ig_id not in seen_ig:
                seen_ig.add(ig_id)
                ig_name = str(ig.get("name") or ig.get("username") or "Instagram")[:255]
                ig_item = {
                    "id": ig_id,
                    "name": ig_name if not ig.get("username") else f"{ig_name} (@{ig.get('username')})"[:255],
                    "account_type": "business",
                    "platform": "instagram",
                    "access_token": page.get("access_token") or access_token,
                    "linked_facebook_page_id": str(page["id"]),
                }
                avatar = ig.get("profile_picture_url")
                if isinstance(avatar, str) and avatar.startswith(("http://", "https://")):
                    ig_item["avatar_url"] = avatar
                destinations.append(ig_item)

    # Groups: only include when the Groups API returns manageable groups (often empty without extra app review).
    try:
        groups = httpx.get(
            f"https://graph.facebook.com/{version}/me/groups",
            params={"fields": "id,name,administrator", "limit": 50},
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=30.0,
        )
        if not groups.is_error:
            for group in groups.json().get("data") or []:
                if not isinstance(group, dict) or not group.get("id"):
                    continue
                if group.get("administrator") is False:
                    continue
                destinations.append(
                    {
                        "id": str(group["id"]),
                        "name": str(group.get("name") or "Facebook Group")[:255],
                        "account_type": "group",
                        "platform": "facebook",
                    }
                )
    except httpx.HTTPError:
        pass
    if not destinations:
        raise HTTPException(
            status_code=404,
            detail="No Facebook Pages (or linked Instagram Business accounts) were returned for this login. Personal profiles are not publishable.",
        )
    return destinations


def _linkedin_destinations(access_token: str, identity: dict) -> list[dict]:
    personal = {
        "id": str(identity.get("id")),
        "name": str(identity.get("name") or "LinkedIn personal profile")[:255],
        "account_type": "personal",
        "platform": "linkedin",
    }
    if identity.get("avatar_url"):
        personal["avatar_url"] = identity["avatar_url"]
    destinations = [personal]
    headers = {
        "Authorization": f"Bearer {access_token}",
        "LinkedIn-Version": config.LINKEDIN_VERSION or "202610",
        "X-Restli-Protocol-Version": "2.0.0",
    }
    try:
        response = httpx.get(
            "https://api.linkedin.com/rest/organizationAcls",
            params={"q": "roleAssignee", "role": "ADMINISTRATOR", "state": "APPROVED", "count": 50},
            headers=headers,
            timeout=30.0,
        )
    except httpx.HTTPError:
        return destinations
    if response.is_error:
        # Fall back to older endpoint shape when Rest.li ACL fails (scope/version).
        try:
            legacy = httpx.get(
                "https://api.linkedin.com/v2/organizationalEntityAcls",
                params={"q": "roleAssignee", "role": "ADMINISTRATOR", "state": "APPROVED"},
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=30.0,
            )
            body = legacy.json() if not legacy.is_error else {}
        except httpx.HTTPError:
            body = {}
    else:
        body = response.json()
    for element in body.get("elements") or []:
        if not isinstance(element, dict):
            continue
        org = element.get("organization") or element.get("organizationalTarget")
        if not org:
            continue
        org_id = str(org).split(":")[-1]
        urn = org if str(org).startswith("urn:") else f"urn:li:organization:{org_id}"
        name = _linkedin_org_name(access_token, urn, headers) or f"LinkedIn organization {org_id}"
        destinations.append({"id": urn, "name": name[:255], "account_type": "organization", "platform": "linkedin"})
    return destinations


def _linkedin_org_name(access_token: str, urn: str, headers: dict) -> str | None:
    org_id = urn.split(":")[-1]
    try:
        response = httpx.get(
            f"https://api.linkedin.com/rest/organizations/{org_id}",
            headers=headers,
            timeout=20.0,
        )
        if response.is_error:
            return None
        body = response.json()
        localized = body.get("localizedName") or body.get("vanityName")
        return str(localized) if localized else None
    except httpx.HTTPError:
        return None


def _youtube_destinations(access_token: str) -> list[dict]:
    try:
        response = httpx.get(
            "https://www.googleapis.com/youtube/v3/channels",
            params={"part": "snippet,status", "mine": "true", "maxResults": 50},
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=30.0,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Could not reach YouTube to list channels.") from exc
    if response.is_error:
        raise HTTPException(status_code=502, detail="YouTube refused to list channels for this Google account.")
    destinations: list[dict] = []
    for item in response.json().get("items") or []:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        snippet = item.get("snippet") if isinstance(item.get("snippet"), dict) else {}
        status = item.get("status") if isinstance(item.get("status"), dict) else {}
        is_brand = bool(status.get("isLinked")) and snippet.get("customUrl")
        entry = {
            "id": str(item["id"]),
            "name": str(snippet.get("title") or "YouTube channel")[:255],
            "account_type": "brand_channel" if is_brand else "channel",
            "platform": "youtube",
            "custom_url": snippet.get("customUrl"),
        }
        thumbs = snippet.get("thumbnails") if isinstance(snippet.get("thumbnails"), dict) else {}
        for size in ("high", "medium", "default"):
            thumb = thumbs.get(size) if isinstance(thumbs.get(size), dict) else None
            url = thumb.get("url") if thumb else None
            if isinstance(url, str) and url.startswith(("http://", "https://")):
                entry["avatar_url"] = url
                break
        destinations.append(entry)
    if not destinations:
        raise HTTPException(status_code=422, detail="No YouTube channels were returned for this Google account.")
    return destinations


def _pinterest_destinations(access_token: str, identity: dict) -> list[dict]:
    destinations: list[dict] = []
    try:
        response = httpx.get(
            "https://api.pinterest.com/v5/boards",
            params={"page_size": 100},
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=30.0,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Could not reach Pinterest to list boards.") from exc
    if response.is_error:
        raise HTTPException(status_code=502, detail="Pinterest refused to list boards.")
    for board in response.json().get("items") or []:
        if not isinstance(board, dict) or not board.get("id"):
            continue
        destinations.append(
            {
                "id": str(board["id"]),
                "name": str(board.get("name") or "Pinterest board")[:255],
                "account_type": "board",
                "platform": "pinterest",
                "parent_user": identity.get("id"),
                "description": board.get("description"),
            }
        )
    if not destinations:
        raise HTTPException(status_code=422, detail="No Pinterest boards were returned. Create a board, then reconnect.")
    return destinations
