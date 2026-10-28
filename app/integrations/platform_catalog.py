"""Connectable vs publishable platforms and honest account-type labels."""

from __future__ import annotations

from typing import Any

# Platforms that can complete a real OAuth connect (or clear 503 for missing env).
CONNECTABLE_PLATFORMS: frozenset[str] = frozenset(
    {
        "x",
        "linkedin",
        "instagram",
        "facebook",
        "youtube",
        "tiktok",
        "pinterest",
        "threads",
    }
)

# Platforms with a working publisher adapter today (Phase A/B keep these publishing).
PUBLISHABLE_PLATFORMS: frozenset[str] = frozenset(
    {"x", "linkedin", "instagram", "facebook", "youtube", "tiktok", "pinterest", "threads"}
)

# Honest Buffer/Later-style account types. Personal Facebook profiles are NOT publishable.
ACCOUNT_TYPE_CATALOG: dict[str, dict[str, Any]] = {
    "facebook": {
        "label": "Facebook",
        "types": {
            "page": {"label": "Page", "publishable_when_ready": True, "primary": True},
            "group": {
                "label": "Group",
                "publishable_when_ready": True,
                "primary": False,
                "note": "Only groups the Meta API returns for posting are listed.",
            },
            "login": {
                "label": "Login identity",
                "publishable_when_ready": False,
                "primary": False,
                "note": "Personal profiles cannot be published to via the Pages API.",
            },
        },
        "needs_destination_pick": True,
        "notes": "Connect selects Facebook Pages (and Groups when the API returns them). Personal profiles are not postable destinations.",
    },
    "instagram": {
        "label": "Instagram",
        "types": {
            "business": {"label": "Business", "publishable_when_ready": True, "primary": True},
            "creator": {"label": "Creator", "publishable_when_ready": True, "primary": True},
        },
        "needs_destination_pick": False,
        "notes": "Business/Creator accounts via Instagram Login. Personal profiles are not supported.",
    },
    "x": {
        "label": "X",
        "types": {
            "user": {"label": "User account", "publishable_when_ready": True, "primary": True},
        },
        "needs_destination_pick": False,
        "notes": "X user account.",
    },
    "linkedin": {
        "label": "LinkedIn",
        "types": {
            "personal": {"label": "Personal profile", "publishable_when_ready": True, "primary": True},
            "organization": {
                "label": "Company / Organization Page",
                "publishable_when_ready": True,
                "primary": True,
            },
        },
        "needs_destination_pick": True,
        "notes": "Personal profile plus Company/Organization Pages the member can administer.",
    },
    "youtube": {
        "label": "YouTube",
        "types": {
            "channel": {"label": "Channel", "publishable_when_ready": True, "primary": True},
            "brand_channel": {"label": "Brand channel", "publishable_when_ready": True, "primary": True},
        },
        "needs_destination_pick": True,
        "notes": "YouTube Channel / Brand channel from Google OAuth.",
    },
    "tiktok": {
        "label": "TikTok",
        "types": {
            "creator": {"label": "Creator", "publishable_when_ready": True, "primary": True},
            "business": {"label": "Business", "publishable_when_ready": True, "primary": True},
        },
        "needs_destination_pick": False,
        "notes": "Creator/Business account for the Content Posting API.",
    },
    "pinterest": {
        "label": "Pinterest",
        "types": {
            "user": {"label": "User", "publishable_when_ready": False, "primary": False},
            "board": {"label": "Board", "publishable_when_ready": True, "primary": True},
        },
        "needs_destination_pick": True,
        "notes": "Pinterest user plus Boards as pin destinations.",
    },
    "threads": {
        "label": "Threads",
        "types": {
            "profile": {"label": "Threads profile", "publishable_when_ready": True, "primary": True},
        },
        "needs_destination_pick": False,
        "notes": "Threads profile via the Meta Threads API.",
    },
}


def connectable_platform_names() -> frozenset[str]:
    return CONNECTABLE_PLATFORMS


def publishable_platform_names() -> frozenset[str]:
    return PUBLISHABLE_PLATFORMS


def platform_needs_destination_pick(platform: str) -> bool:
    meta = ACCOUNT_TYPE_CATALOG.get(platform.strip().lower())
    return bool(meta and meta.get("needs_destination_pick"))


def default_account_type(platform: str) -> str:
    meta = ACCOUNT_TYPE_CATALOG.get(platform.strip().lower()) or {}
    types = meta.get("types") or {}
    for type_id, info in types.items():
        if info.get("primary"):
            return type_id
    return next(iter(types), "user")


def account_type_label(platform: str, account_type: str | None) -> str:
    meta = ACCOUNT_TYPE_CATALOG.get((platform or "").strip().lower()) or {}
    types = meta.get("types") or {}
    info = types.get((account_type or "").strip().lower()) or {}
    return str(info.get("label") or account_type or "Account")


def catalog_public() -> list[dict[str, Any]]:
    """Public shape for the Manage Accounts UI."""
    rows: list[dict[str, Any]] = []
    for platform in sorted(CONNECTABLE_PLATFORMS):
        meta = ACCOUNT_TYPE_CATALOG[platform]
        rows.append(
            {
                "id": platform,
                "label": meta["label"],
                "connectable": True,
                "publishable": platform in PUBLISHABLE_PLATFORMS,
                "needs_destination_pick": bool(meta.get("needs_destination_pick")),
                "notes": meta.get("notes") or "",
                "account_types": [
                    {
                        "id": type_id,
                        "label": info["label"],
                        "primary": bool(info.get("primary")),
                        "publishable_when_ready": bool(info.get("publishable_when_ready")),
                        "note": info.get("note") or "",
                    }
                    for type_id, info in meta["types"].items()
                ],
            }
        )
    return rows
