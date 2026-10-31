"""FastAPI application setup, lifecycle hooks, and frontend mounting."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import SQLAlchemyError

from app.api.v1.router import router as v1_router
from app.api_docs import install_branded_docs
from app.core.config import ALLOWED_ORIGINS, APP_ENV, APP_NAME
from app.core.logging import configure_logging
from app.db.bootstrap import ensure_database_schema
from app.db.session import engine

PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_ROOT = PROJECT_ROOT / "frontend"
FRONTEND_STATIC = FRONTEND_ROOT / "static"
FRONTEND_UPLOADS = FRONTEND_STATIC / "uploads"
FRONTEND_BUILD = FRONTEND_STATIC / "build"
FRONTEND_INDEX = FRONTEND_BUILD / "index.html"
FRONTEND_UPLOADS.mkdir(parents=True, exist_ok=True)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Create tables missing from the shared application model metadata."""
    ensure_database_schema(engine)
    yield


configure_logging()

app = FastAPI(
    title=APP_NAME,
    version="0.1.0",
    lifespan=lifespan,
    docs_url=None,  # branded Swagger UI is registered by install_branded_docs
)

install_branded_docs(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS
    or (
        [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:5500",
            "http://127.0.0.1:5500",
        ]
        if APP_ENV != "production"
        else []
    ),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=str(FRONTEND_STATIC)), name="static")


@app.get("/", include_in_schema=False)
def serve_frontend() -> FileResponse:
    """Serve the single-page frontend entry point."""
    if not FRONTEND_INDEX.is_file():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The frontend has not been built. Run `npm install` and `npm run build` from the project root, then restart the API.",
        )
    return FileResponse(FRONTEND_INDEX)


app.include_router(v1_router, prefix="/api/v1")


@app.exception_handler(SQLAlchemyError)
async def handle_database_error(_request: Request, exc: SQLAlchemyError) -> JSONResponse:
    """Log database failures and return a consistent, non-sensitive API error."""
    logger.exception("Database operation failed", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "A database operation failed. Please try again."},
    )
