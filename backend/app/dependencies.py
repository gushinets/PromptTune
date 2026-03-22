from collections.abc import AsyncGenerator
from hashlib import sha256

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
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else "unknown"


MISSING_INSTALLATION_MARKER_TTL = 2_592_000  # 30 days


def _hash_ip(ip: str) -> str:
    payload = f"{ip}{settings.ip_salt}"
    return sha256(payload.encode()).hexdigest()


async def ensure_installation_id_when_ip_present(
    client_ip: str,
    installation_id: str | None,
    redis: aioredis.Redis | None = None,
) -> None:
    """Raise 403 when request has a detectable IP but no valid installation_id."""
    if client_ip == "unknown" or client_ip is None:
        return
    if not installation_id or not installation_id.strip():
        if redis is not None:
            marker_key = f"flag:missing_inst:{_hash_ip(client_ip)}"
            await redis.set(marker_key, "1", ex=MISSING_INSTALLATION_MARKER_TTL)
        raise HTTPException(status_code=403, detail="Your login is invalid")
