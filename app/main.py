"""FastAPI application setup, lifecycle hooks, and frontend mounting."""

import logging
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import SQLAlchemyError
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.api.gate import ProductionGateMiddleware
from app.api.v1.router import router as v1_router
from app.api_docs import install_branded_docs
from app.core.config import (
    ALLOWED_HOSTS,
    APP_NAME,
    CORS_ALLOWED_ORIGINS,
    FORWARDED_ALLOW_IPS,
)
from app.core.logging import configure_logging
from app.db.bootstrap import ensure_database_schema
from app.db.session import engine
from app.integrations.media_urls import hosted_media_filename
from app.services.engagement.base import CreditsRequired

PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_ROOT = PROJECT_ROOT / "frontend"
FRONTEND_STATIC = FRONTEND_ROOT / "static"
FRONTEND_UPLOADS = FRONTEND_STATIC / "uploads"
FRONTEND_BUILD = FRONTEND_STATIC / "build"
FRONTEND_INDEX = FRONTEND_BUILD / "index.html"
LEGAL_DIR = PROJECT_ROOT / "docs"
FRONTEND_UPLOADS.mkdir(parents=True, exist_ok=True)
logger = logging.getLogger(__name__)
_MEDIA_NAME = re.compile(r"^[A-Za-z0-9._-]{1,200}$")
_INDEX_CACHE = {"Cache-Control": "no-cache, no-store, must-revalidate"}


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Create tables missing from the shared application model metadata."""
    ensure_database_schema(engine)
    import asyncio

    from app.tasks.inprocess_scheduler import scheduler_loop, scheduler_mode

    stop = asyncio.Event()
    task = (
        asyncio.create_task(scheduler_loop(stop)) if scheduler_mode() != "off" else None
    )
    try:
        yield
    finally:
        stop.set()
        if task is not None:
            try:
                await asyncio.wait_for(task, timeout=5)
            except (asyncio.TimeoutError, Exception):
                task.cancel()


configure_logging()

app = FastAPI(
    title=APP_NAME,
    version="0.1.0",
    lifespan=lifespan,
    docs_url=None,  # branded Swagger UI is registered by install_branded_docs
    redoc_url=None,
    openapi_url=None,
)

install_branded_docs(app)

# Last added runs first: trust the tunnel's forwarded proto, then the Host header,
# then CORS, then the auth/docs gate.
app.add_middleware(ProductionGateMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=ALLOWED_HOSTS,
    www_redirect=False,
)
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=FORWARDED_ALLOW_IPS)

app.mount("/static", StaticFiles(directory=str(FRONTEND_STATIC)), name="static")


def _frontend_index() -> FileResponse:
    """Serve the SPA shell. Signed-in pages stay behind the client session gate."""
    if not FRONTEND_INDEX.is_file():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The frontend has not been built. Run `npm install` and `npm run build` from the project root, then restart the API.",
        )
    # index.html must never be cached so a rebuilt bundle is picked up without Ctrl+F5.
    return FileResponse(FRONTEND_INDEX, headers=_INDEX_CACHE)


def _legal_page(name: str) -> FileResponse:
    path = (LEGAL_DIR / name).resolve()
    if path.parent != LEGAL_DIR.resolve() or not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return FileResponse(path)


@app.get("/", include_in_schema=False)
def serve_frontend() -> FileResponse:
    """Serve the single-page frontend entry point (landing, login, and signup)."""
    return _frontend_index()


@app.get("/privacy", include_in_schema=False)
@app.get("/privacy.html", include_in_schema=False)
def serve_privacy() -> FileResponse:
    """Public privacy policy, including the data-deletion instructions Meta links to."""
    return _legal_page("privacy.html")


@app.get("/terms", include_in_schema=False)
@app.get("/terms.html", include_in_schema=False)
def serve_terms() -> FileResponse:
    """Public terms of service."""
    return _legal_page("terms.html")


@app.get("/media/{filename}", include_in_schema=False)
def serve_uploaded_media(filename: str) -> FileResponse:
    """Public media file. Instagram, Threads, and TikTok fetch this URL with no session."""
    if (
        not _MEDIA_NAME.fullmatch(filename)
        or hosted_media_filename(f"/media/{filename}") is None
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    path = (FRONTEND_UPLOADS / filename).resolve()
    if path.parent != FRONTEND_UPLOADS.resolve() or not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return FileResponse(path)


@app.get("/openapi.json", include_in_schema=False)
def openapi_schema() -> JSONResponse:
    """OpenAPI schema. Hidden in production unless DEBUG is on (see the docs gate)."""
    return JSONResponse(app.openapi())


@app.get("/redoc", include_in_schema=False)
def redoc_placeholder():
    """ReDoc is not shipped separately. /docs is the branded reference, when enabled."""
    # The production gate returns 404 before this runs when docs are disabled.
    # A 200 here keeps local and test clients on the same URL they already use.
    from fastapi.responses import HTMLResponse

    return HTMLResponse(
        "<!doctype html><title>SocialCastly API</title>"
        '<p>API reference: <a href="/docs">/docs</a></p>'
    )


app.include_router(v1_router, prefix="/api/v1")


@app.get("/{full_path:path}", include_in_schema=False)
def serve_frontend_paths(full_path: str) -> FileResponse:
    """SPA fallback for client routes. API, media, docs, and static files are not rewritten."""
    if full_path.startswith(
        ("api/", "static/", "media/", "docs", "openapi.json", "privacy", "terms")
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return _frontend_index()


@app.exception_handler(CreditsRequired)
async def handle_x_unavailable(_request: Request, exc: CreditsRequired) -> JSONResponse:
    """Plain sentence for the product. The provider's credits text stays in the log."""
    return JSONResponse(
        status_code=402,
        content={"detail": exc.message, "code": "x_unavailable"},
    )


@app.exception_handler(SQLAlchemyError)
async def handle_database_error(
    _request: Request, exc: SQLAlchemyError
) -> JSONResponse:
    """Log database failures and return a consistent, non-sensitive API error."""
    logger.exception("Database operation failed", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "A database operation failed. Please try again."},
    )
