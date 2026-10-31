"""Meta (Facebook / Instagram / Threads) deauthorize and data-deletion callbacks.

Meta POSTs a ``signed_request`` form field. We verify it with the matching app
secret when one is configured and answer in the format Meta expects.
"""

import base64
import hashlib
import hmac
import json
import logging
import os
import secrets

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from app.core import config

logger = logging.getLogger(__name__)
router = APIRouter()

_SECRET_ENV = {"facebook": "FACEBOOK_CLIENT_SECRET", "instagram": "INSTAGRAM_CLIENT_SECRET", "threads": "THREADS_CLIENT_SECRET"}

_INFO = """<!doctype html><meta charset=utf-8><title>Data deletion - SocialCastly</title>
<body style="font-family:system-ui;max-width:640px;margin:40px auto;line-height:1.5">
<h1>Data deletion</h1><p>To delete your data, disconnect the account in SocialCastly (Channels &rarr; Disconnect),
or remove the app from your Facebook, Instagram or Threads settings. Stored tokens and account data for that
account are deleted. Questions: contact the app owner listed in the privacy policy.</p>{extra}</body>"""


def _b64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def parse_signed_request(signed_request: str, secret: str) -> dict | None:
    try:
        sig, payload = signed_request.split(".", 1)
        data = json.loads(_b64(payload))
    except Exception:
        return None
    if secret:
        expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _b64(sig)):
            return None
    return data


async def _handle(platform: str, kind: str, request: Request) -> dict:
    form = {}
    try:
        form = dict(await request.form())
    except Exception:
        pass
    data = parse_signed_request(str(form.get("signed_request", "")), os.getenv(_SECRET_ENV[platform], ""))
    logger.info("meta %s %s callback received (valid=%s)", platform, kind, data is not None)
    code = secrets.token_hex(8)
    if kind == "delete":
        status_url = f"{config.PUBLIC_BASE_URL.rstrip('/')}/api/v1/accounts/{platform}/data-deletion?code={code}"
        return {"url": status_url, "confirmation_code": code}
    return {"ok": True}


for _platform in ("facebook", "instagram", "threads"):
    def _make(platform: str):
        async def uninstall(request: Request):
            return await _handle(platform, "uninstall", request)

        async def delete(request: Request):
            return await _handle(platform, "delete", request)

        async def info(code: str | None = None):
            extra = f"<p>Deletion request <b>{code[:32]}</b> received.</p>" if code else ""
            return HTMLResponse(_INFO.format(extra=extra))

        router.add_api_route(f"/{platform}/uninstall", uninstall, methods=["POST"], name=f"{platform}_uninstall")
        router.add_api_route(f"/{platform}/deauthorize", uninstall, methods=["POST"], name=f"{platform}_deauthorize")
        router.add_api_route(f"/{platform}/delete", delete, methods=["POST"], name=f"{platform}_delete")
        router.add_api_route(f"/{platform}/data-deletion", delete, methods=["POST"], name=f"{platform}_data_deletion")
        router.add_api_route(f"/{platform}/data-deletion", info, methods=["GET"], name=f"{platform}_data_deletion_info")

    _make(_platform)
