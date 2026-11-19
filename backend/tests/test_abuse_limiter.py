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


async def test_improve_ip_throttle_rejects_rotating_installations_before_llm(
    client,
    mock_db,
    mock_litellm,
    monkeypatch,
):
    url = os.getenv("ABUSE_TEST_REDIS_URL")
    if not url:
        pytest.skip("ABUSE_TEST_REDIS_URL required for Redis integration test")
    from app.config import settings
    from app.dependencies import get_redis
    from app.main import app

    # Each run has its own IP bucket and low test limit; distinct installs still share it.
    identity = uuid.uuid4().int
    shared_ip = f"2001:db8::{identity & 0xFFFF:x}:{(identity >> 16) & 0xFFFF:x}"
    monkeypatch.setattr(settings, "free_req_per_ip_min", 2)
    async with aioredis.from_url(url) as redis:
        app.dependency_overrides[get_redis] = lambda: redis
        for _ in range(2):
            response = await client.post(
                "/v1/improve",
                headers={"X-Real-IP": shared_ip},
                json={"text": "Improve this", "installation_id": str(uuid.uuid4())},
            )
            assert response.status_code == 200
        rejected = await client.post(
            "/v1/improve",
            headers={"X-Real-IP": shared_ip},
            json={"text": "Improve this", "installation_id": str(uuid.uuid4())},
        )
        assert rejected.status_code == 429
        assert mock_litellm.await_count == 2
        assert mock_db.quota_reserve.await_count == 2
        other_ip = await client.post(
            "/v1/improve",
            headers={
                "X-Real-IP": f"2001:db8:1::{identity & 0xFFFF:x}:{(identity >> 16) & 0xFFFF:x}"
            },
            json={"text": "Improve this", "installation_id": str(uuid.uuid4())},
        )
        assert other_ip.status_code == 200
        assert mock_litellm.await_count == 3
        app.dependency_overrides.pop(get_redis, None)
