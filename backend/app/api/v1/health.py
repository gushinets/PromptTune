import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from app.config import settings
from app.db.session import async_session_factory
from app.dependencies import get_redis

router = APIRouter()


@router.get("/healthz")
async def healthz():
    return {"status": "ok"}


@router.get("/readyz")
async def readyz(redis: aioredis.Redis = Depends(get_redis)):
    provider_config_error = settings.provider_config_error()
    if provider_config_error:
        raise HTTPException(status_code=503, detail=provider_config_error)

    # Check DB connectivity
    try:
        async with async_session_factory() as session:
            await session.execute(text("SELECT 1"))
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=503, detail="DB not ready") from exc

    # Check Redis connectivity
    try:
        await redis.ping()
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=503, detail="Redis not ready") from exc

    return {"status": "ok"}
