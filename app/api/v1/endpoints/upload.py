"""Authenticated media upload endpoint with bounded, chunked file writes."""

import logging
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models import MediaAsset, User
from app.schemas.publish import MediaUploadResponse

router = APIRouter()
logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[4]
UPLOADS_DIR = PROJECT_ROOT / "frontend" / "static" / "uploads"
MAX_UPLOAD_BYTES = 500 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024
ALLOWED_MEDIA_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/avif": ".avif",
    "image/bmp": ".bmp",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "video/x-m4v": ".m4v",
    "video/ogg": ".ogv",
}


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=MediaUploadResponse,
    summary="Upload post media",
)
async def upload_media(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MediaUploadResponse:
    """Stream a supported image or video to disk and return its public URL."""
    extension = ALLOWED_MEDIA_TYPES.get(file.content_type or "")
    if extension is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only supported image and video files can be uploaded.",
        )

    filename = f"{uuid4().hex}{extension}"
    destination = UPLOADS_DIR / filename
    temporary = UPLOADS_DIR / f".{filename}.part"
    size = 0

    try:
        UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        with temporary.open("wb") as output:
            while chunk := await file.read(CHUNK_SIZE):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail="Media files must be 500 MB or smaller.",
                    )
                output.write(chunk)

        if size == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The uploaded file is empty.",
            )

        temporary.replace(destination)
    except HTTPException:
        temporary.unlink(missing_ok=True)
        raise
    except OSError as exc:
        temporary.unlink(missing_ok=True)
        logger.exception("Failed to write uploaded media for user %s", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="The media file could not be saved.",
        ) from exc
    except Exception as exc:
        temporary.unlink(missing_ok=True)
        logger.exception("Unexpected error while receiving media for user %s", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="The media upload could not be processed.",
        ) from exc
    finally:
        await file.close()

    public_url = f"/static/uploads/{filename}"
    asset = MediaAsset(
        owner_id=current_user.id,
        filename=Path(file.filename or filename).name,
        storage_key=filename,
        media_type=file.content_type or "application/octet-stream",
        size_bytes=size,
        public_url=public_url,
    )
    try:
        db.add(asset)
        db.commit()
    except Exception as exc:
        db.rollback()
        destination.unlink(missing_ok=True)
        logger.exception("Failed to save media metadata for user %s", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="The media library record could not be saved.",
        ) from exc
    return MediaUploadResponse(
        id=asset.id,
        url=public_url,
        filename=asset.filename,
        media_type=asset.media_type,
        size_bytes=size,
    )
