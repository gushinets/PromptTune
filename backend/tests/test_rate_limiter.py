import pytest
from unittest.mock import AsyncMock, Mock

from app.services.rate_limiter import RateLimiter


def make_redis_mock(inst_bucket=None, ip_bucket=None, day_count=None, min_count=None):
    """Build a redis mock for the bucket-based schema.

    resolve_bucket calls: redis.get(inst_key), redis.get(ip_key), redis.set x2 (or expire)
    check calls: redis.mget(day_key, min_key), then pipeline for incr/expire
    get_remaining calls: redis.pipeline() for two GETs
    """
    redis_mock = Mock()

    # resolve_bucket: first GET returns inst_bucket, second GET returns ip_bucket
    redis_mock.get = AsyncMock(side_effect=[inst_bucket, ip_bucket])
    redis_mock.set = AsyncMock(return_value=True)
    redis_mock.expire = AsyncMock(return_value=True)

    # check: mget returns [day_count, min_count]
    redis_mock.mget = AsyncMock(return_value=[day_count, min_count])

    return redis_mock


@pytest.mark.asyncio
async def test_allows_when_under_limit():
    redis_mock = make_redis_mock(day_count=None, min_count=None)

    pipe_write = Mock()
    pipe_write.incr = Mock()
    pipe_write.expire = Mock()
    pipe_write.execute = AsyncMock(return_value=[1, True, 1, True])
    redis_mock.pipeline = Mock(return_value=pipe_write)

    limiter = RateLimiter(redis_mock)
    allowed, remaining = await limiter.check("inst-1", "1.2.3.4")

    assert allowed is True
    assert remaining["per_minute_remaining"] >= 0
    assert remaining["per_day_remaining"] >= 0
    assert pipe_write.incr.call_count == 2


@pytest.mark.asyncio
async def test_blocks_when_minute_limit_exceeded():
    from app.config import settings

    redis_mock = make_redis_mock(day_count=b"0", min_count=str(settings.free_req_per_min).encode())
    redis_mock.pipeline = Mock()  # should not be called

    limiter = RateLimiter(redis_mock)
    allowed, remaining = await limiter.check("inst-1", "1.2.3.4")

    assert allowed is False
    assert remaining["per_minute_remaining"] == 0


@pytest.mark.asyncio
async def test_blocks_when_day_limit_exceeded():
    from app.config import settings

    redis_mock = make_redis_mock(day_count=str(settings.free_req_per_day).encode(), min_count=b"0")
    redis_mock.pipeline = Mock()  # should not be called

    limiter = RateLimiter(redis_mock)
    allowed, remaining = await limiter.check("inst-1", "1.2.3.4")

    assert allowed is False
    assert remaining["per_day_remaining"] == 0


@pytest.mark.asyncio
async def test_get_remaining_does_not_increment():
    redis_mock = Mock()
    redis_mock.get = AsyncMock(side_effect=[None, None])
    redis_mock.set = AsyncMock(return_value=True)
    redis_mock.expire = AsyncMock(return_value=True)

    pipe_mock = Mock()
    pipe_mock.get = Mock()
    pipe_mock.incr = Mock()
    pipe_mock.expire = Mock()
    pipe_mock.execute = AsyncMock(return_value=[b"1", b"2"])
    redis_mock.pipeline = Mock(return_value=pipe_mock)

    limiter = RateLimiter(redis_mock)
    allowed, remaining = await limiter.get_remaining("inst-1", "1.2.3.4")

    assert allowed is True
    assert remaining["per_minute_remaining"] >= 0
    assert remaining["per_day_remaining"] >= 0
    pipe_mock.incr.assert_not_called()
    pipe_mock.expire.assert_not_called()
