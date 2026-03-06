import pytest
from unittest.mock import AsyncMock

from app.services.rate_limiter import RateLimiter


@pytest.mark.asyncio
async def test_allows_when_under_limit():
    redis_mock = AsyncMock()
    pipe_mock = AsyncMock()
    # All counters at 0
    pipe_mock.execute = AsyncMock(return_value=[0, 0, 0, 0])
    redis_mock.pipeline.return_value = pipe_mock

    limiter = RateLimiter(redis_mock)
    allowed, remaining = await limiter.check("inst-1", "1.2.3.4")

    assert allowed is True
    assert remaining["per_minute_remaining"] >= 0
    assert remaining["per_day_remaining"] >= 0


@pytest.mark.asyncio
async def test_blocks_when_minute_limit_exceeded():
    redis_mock = AsyncMock()
    pipe_mock = AsyncMock()
    # Minute limit exceeded (10 for inst, 10 for ip)
    pipe_mock.execute = AsyncMock(return_value=[10, 5, 10, 5])
    redis_mock.pipeline.return_value = pipe_mock

    limiter = RateLimiter(redis_mock)
    allowed, remaining = await limiter.check("inst-1", "1.2.3.4")

    assert allowed is False
    assert remaining["per_minute_remaining"] == 0


@pytest.mark.asyncio
async def test_blocks_when_day_limit_exceeded():
    redis_mock = AsyncMock()
    pipe_mock = AsyncMock()
    # Day limit exceeded (5 min, 50 day)
    pipe_mock.execute = AsyncMock(return_value=[5, 50, 5, 50])
    redis_mock.pipeline.return_value = pipe_mock

    limiter = RateLimiter(redis_mock)
    allowed, remaining = await limiter.check("inst-1", "1.2.3.4")

    assert allowed is False
    assert remaining["per_day_remaining"] == 0
