"""Liveness and database readiness routes."""

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db

router = APIRouter()


@router.get("/health", summary="Health and database status")
def health(db: Session = Depends(get_db)) -> dict[str, str]:
    """Check that the API process and its database connection are available."""
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "ok"}
