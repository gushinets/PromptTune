from fastapi import APIRouter, Depends, HTTPException, Query
import redis.asyncio as aioredis

from app.api.schemas import RateLimitInfo
from app.dependencies import get_redis
from app.services.rate_limiter import RateLimiter


router = APIRouter()


@router.get("/limits", response_model=RateLimitInfo)
async def get_limits(
    installation_id: str = Query(..., max_length=64),
    redis: aioredis.Redis = Depends(get_redis),
):
    limiter = RateLimiter(redis)
    allowed, remaining = await limiter.get_remaining(
        installation_id=installation_id, ip="0.0.0.0"
    )
    if remaining is None:
        raise HTTPException(status_code=400, detail="Unable to compute limits")
    return RateLimitInfo(**remaining)
