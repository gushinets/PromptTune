from collections.abc import AsyncGenerator

import redis.asyncio as aioredis
from fastapi import HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.session import async_session_factory

_redis_pool: aioredis.Redis | None = None


async def get_db() -> AsyncGenerator[AsyncSession]:
    async with async_session_factory() as session:
        yield session


async def get_redis() -> aioredis.Redis:
    global _redis_pool
    if _redis_pool is None:
        _redis_pool = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis_pool


async def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def ensure_installation_id_when_ip_present(client_ip: str, installation_id: str | None) -> None:
    """Raise 403 when request has a detectable IP but no valid installation_id."""
    if client_ip == "unknown" or client_ip is None:
        return
    if not installation_id or not installation_id.strip():
        raise HTTPException(status_code=403, detail="Your login is invalid")
