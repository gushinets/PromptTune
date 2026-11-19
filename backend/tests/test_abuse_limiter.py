import os
import uuid

import pytest
import redis.asyncio as aioredis
from fastapi import HTTPException


async def test_minute_allowance_reports_consumption_and_rejects_eleventh_request():
    url = os.getenv("ABUSE_TEST_REDIS_URL")
    if not url:
        pytest.skip("ABUSE_TEST_REDIS_URL required for Redis integration test")
    from app.services.abuse_limiter import allowance, throttle

    async with aioredis.from_url(url) as redis:
        identity = str(uuid.uuid4())
        assert await allowance(redis, "test", identity, 10) == 10
        for index in range(10):
            assert await throttle(redis, "test", identity, 10, 60) == 9 - index
        assert await allowance(redis, "test", identity, 10) == 0
        with pytest.raises(HTTPException) as error:
            await throttle(redis, "test", identity, 10, 60)
        assert error.value.status_code == 429
