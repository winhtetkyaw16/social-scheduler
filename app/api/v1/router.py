"""Version-one API router composition."""

from fastapi import APIRouter

from app.api.v1.endpoints import accounts, auth, health, posts, publish, upload

router = APIRouter()
router.include_router(health.router, tags=["health"])
router.include_router(auth.router, prefix="/auth", tags=["auth"])
router.include_router(accounts.router, prefix="/accounts", tags=["accounts"])
router.include_router(posts.router, prefix="/posts", tags=["posts"])
router.include_router(upload.router, prefix="/upload", tags=["upload"])
router.include_router(publish.router, prefix="/publish", tags=["publish"])
