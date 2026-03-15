import pytest
from unittest.mock import AsyncMock, Mock

from app.services.rate_limiter import RateLimiter


@pytest.mark.asyncio
async def test_allows_when_under_limit():
    redis_mock = Mock()
    pipe_read = Mock()
    pipe_read.get = Mock()
    pipe_read.execute = AsyncMock(return_value=[0, 0, 0, 0])
    pipe_write = Mock()
    pipe_write.incr = Mock()
    pipe_write.expire = Mock()
    pipe_write.execute = AsyncMock(return_value=[None] * 8)
    redis_mock.pipeline = Mock(side_effect=[pipe_read, pipe_write])

    limiter = RateLimiter(redis_mock)
    allowed, remaining = await limiter.check("inst-1", "1.2.3.4")

    assert allowed is True
    assert remaining["per_minute_remaining"] >= 0
    assert remaining["per_day_remaining"] >= 0
    assert pipe_write.incr.call_count == 4


@pytest.mark.asyncio
async def test_blocks_when_minute_limit_exceeded():
    redis_mock = Mock()
    pipe_mock = Mock()
    pipe_mock.get = Mock()
    pipe_mock.execute = AsyncMock(return_value=[10, 5, 10, 5])
    redis_mock.pipeline = Mock(return_value=pipe_mock)

    limiter = RateLimiter(redis_mock)
    allowed, remaining = await limiter.check("inst-1", "1.2.3.4")

    assert allowed is False
    assert remaining["per_minute_remaining"] == 0


@pytest.mark.asyncio
async def test_blocks_when_day_limit_exceeded():
    redis_mock = Mock()
    pipe_mock = Mock()
    pipe_mock.get = Mock()
    pipe_mock.execute = AsyncMock(return_value=[5, 50, 5, 50])
    redis_mock.pipeline = Mock(return_value=pipe_mock)

    limiter = RateLimiter(redis_mock)
    allowed, remaining = await limiter.check("inst-1", "1.2.3.4")

    assert allowed is False
    assert remaining["per_day_remaining"] == 0


@pytest.mark.asyncio
async def test_get_remaining_does_not_increment():
    redis_mock = Mock()
    pipe_mock = Mock()
    pipe_mock.get = Mock()
    pipe_mock.execute = AsyncMock(return_value=[1, 2, 1, 2])
    pipe_mock.incr = Mock()
    pipe_mock.expire = Mock()
    redis_mock.pipeline = Mock(return_value=pipe_mock)

    limiter = RateLimiter(redis_mock)
    allowed, remaining = await limiter.get_remaining("inst-1", "1.2.3.4")

    assert allowed is True
    assert remaining["per_minute_remaining"] >= 0
    assert remaining["per_day_remaining"] >= 0
    pipe_mock.incr.assert_not_called()
    pipe_mock.expire.assert_not_called()
