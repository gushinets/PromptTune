from unittest.mock import AsyncMock, Mock

import pytest
from httpx import AsyncClient

from app.dependencies import get_redis
from app.main import app


@pytest.mark.asyncio
async def test_limits_returns_remaining_without_incrementing(client: AsyncClient):
    redis_mock = Mock()
    # resolve_bucket: both GETs return None → new bucket created
    redis_mock.get = AsyncMock(return_value=None)
    redis_mock.set = AsyncMock(return_value=True)
    redis_mock.expire = AsyncMock(return_value=True)

    # get_remaining uses a pipeline to read day and minute counters
    # day_count=1, min_count=2 → per_day_remaining=49, per_minute_remaining=8
    pipe_mock = Mock()
    pipe_mock.get = Mock()
    pipe_mock.incr = Mock()
    pipe_mock.expire = Mock()
    pipe_mock.execute = AsyncMock(return_value=[b"1", b"2"])
    redis_mock.pipeline = Mock(return_value=pipe_mock)

    async def override_get_redis():
        return redis_mock

    app.dependency_overrides[get_redis] = override_get_redis
    response = await client.get("/v1/limits", params={"installation_id": "test-inst-1"})

    assert response.status_code == 200
    assert response.json() == {
        "per_minute_remaining": 8,
        "per_day_remaining": 49,
    }
    pipe_mock.incr.assert_not_called()
    pipe_mock.expire.assert_not_called()
