"""Reject anonymous calls to non-public API routes, and hide docs in production."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi.responses import JSONResponse

from app.api.access import is_dev_docs_path, is_public_api
from app.core.config import docs_enabled

Scope = dict
Receive = Callable[[], Awaitable[dict]]
Send = Callable[[dict], Awaitable[None]]


def _header(scope: Scope, name: str) -> str:
    target = name.lower().encode()
    for key, value in scope.get("headers") or []:
        if key.lower() == target:
            return value.decode("latin-1")
    return ""


class ProductionGateMiddleware:
    """401 for non-public /api routes without a bearer token; 404 for docs in production."""

    def __init__(self, app: Callable) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        method = scope.get("method", "GET").upper()
        path = scope.get("path") or "/"
        if method != "OPTIONS" and is_dev_docs_path(path) and not docs_enabled():
            response = JSONResponse(status_code=404, content={"detail": "Not found"})
            await response(scope, receive, send)
            return
        if (
            method != "OPTIONS"
            and path.startswith("/api/")
            and not is_public_api(method, path)
            and not _has_bearer(_header(scope, "authorization"))
        ):
            response = JSONResponse(
                status_code=401,
                content={"detail": "Not authenticated"},
                headers={"WWW-Authenticate": "Bearer"},
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


def _has_bearer(header: str) -> bool:
    scheme, _, token = header.partition(" ")
    return scheme.lower() == "bearer" and bool(token.strip())
